/**
 * Detection automatique de la face du cube dans l'image.
 *
 * Pourquoi c'est indispensable : demander a l'utilisateur de faire coincider
 * son cube avec un cadre fixe ne marche pas. Avec une webcam grand-angle, le
 * cube occupe une petite partie de l'image, et le cadre echantillonne alors le
 * visage et le mur. Il faut trouver la face, pas la reclamer.
 *
 * Principe, sans bibliotheque de vision :
 *   1. les stickers sont des zones UNIFORMES separees par des joints SOMBRES :
 *      on marque comme "bord" les forts gradients et les pixels sombres, et
 *      les composantes connexes de ce qui reste sont des stickers candidats ;
 *   2. on ne garde que les composantes assez carrees et assez pleines ;
 *   3. on cherche le meilleur RESEAU 3x3 parmi ces candidats. Le reseau est
 *      AFFINE (deux vecteurs de base quelconques), pas un carre aligne sur
 *      l'image : personne ne tient son cube parfaitement de face, et un cube
 *      incline projette un parallelogramme ;
 *   4. on verifie que les joints entre cases sont bien plus sombres que les
 *      cases — ce controle elimine les faux positifs (motif de vetement,
 *      carrelage, etagere, ecran eteint).
 */

import type { GridRect } from './sampler';

export interface Detection {
  /** Centre du reseau, en pixels de l'image d'entree. */
  cx: number;
  cy: number;
  /** Vecteur d'une case vers sa voisine de droite. */
  ux: number;
  uy: number;
  /** Vecteur d'une case vers sa voisine du dessous. */
  vx: number;
  vy: number;
  /** Centres des 9 cases, en lecture ligne par ligne. */
  cells: { x: number; y: number }[];
  /** Boite englobante, pour l'affichage et le cadrage. */
  rect: GridRect;
  /** Nombre de cases retrouvees sur 9. */
  matched: number;
  /** Confiance globale [0..1]. */
  score: number;
}

export interface DetectOptions {
  /** Largeur de travail interne. Plus petit = plus rapide, moins precis. */
  workWidth?: number;
  /** Taille minimale d'une face, en fraction de la plus petite dimension. */
  minFaceRatio?: number;
  maxFaceRatio?: number;
  /**
   * Cases retrouvees exigees. On demande plus pour accrocher une face que pour
   * la garder : c'est ce qui evite d'accrocher un faux positif tout en
   * continuant a suivre un cube partiellement masque par les doigts.
   */
  minMatched?: number;
}

interface Blob {
  cx: number;
  cy: number;
  w: number;
  h: number;
  area: number;
}

/**
 * 224 px de large : en dessous, un cube filme de loin (webcam grand-angle)
 * n'a plus de joints assez marques et les stickers fusionnent — la detection
 * tombe de 95 % a 28 %. Au-dessus, on ne gagne plus rien et on paie le calcul.
 */
/**
 * Saturation en dessous de laquelle un pixel est considere comme gris. Les
 * joints d'un cube sont noirs (saturation quasi nulle) ; les stickers, meme
 * sombres, sont franchement colores : un bleu de cube depasse 150.
 */
const SEUIL_GRIS = 45;

const DEFAULTS: Required<DetectOptions> = {
  workWidth: 224,
  minFaceRatio: 0.13,
  maxFaceRatio: 0.8,
  minMatched: 7,
};

export class FaceDetector {
  private lum = new Float32Array(0);
  private chroma = new Float32Array(0);
  private edge = new Uint8Array(0);
  private labels = new Int32Array(0);
  private stack = new Int32Array(0);
  private w = 0;
  private h = 0;

  detect(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options: DetectOptions = {},
  ): Detection | null {
    const o = { ...DEFAULTS, ...options };
    const step = Math.max(1, Math.round(width / o.workWidth));
    const w = Math.floor(width / step);
    const h = Math.floor(height / step);
    if (w < 40 || h < 30) return null;
    this.ensure(w, h);

    // --- 1. luminance ET saturation a la resolution de travail ---
    const lum = this.lum;
    const chroma = this.chroma;
    for (let y = 0; y < h; y++) {
      const sy = y * step;
      for (let x = 0; x < w; x++) {
        const i = (sy * width + x * step) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const j = y * w + x;
        lum[j] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        chroma[j] = Math.max(r, g, b) - Math.min(r, g, b);
      }
    }

    // --- 2. carte des bords : gradient fort OU pixel sombre (les joints) ---
    const edge = this.edge;
    edge.fill(1); // les bordures de l'image comptent comme bord
    let sumGrad = 0;
    let sumLum = 0;
    // une seule passe : sommes ET histogramme de luminance
    const hist = new Int32Array(32);
    for (let y = 1; y < h - 1; y++) {
      const base = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = base + x;
        const v = lum[i];
        sumGrad += Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
        sumLum += v;
        const b = (v * 0.125) | 0;
        hist[b > 31 ? 31 : b < 0 ? 0 : b]++;
      }
    }
    const n = (w - 2) * (h - 2);
    const seuilGrad = Math.max(14, (sumGrad / n) * 1.5);
    // Seuil "pixel sombre" cale sur un BAS percentile, pas sur la moyenne :
    // avec un mur clair derriere le cube, la moyenne monte, le seuil monte
    // avec elle et les stickers fonces (bleu, rouge) sont avales comme s'ils
    // etaient des joints. Le percentile bas, lui, suit les vraies ombres.
    let cumul = 0;
    let p15 = 0;
    for (let b = 0; b < 32; b++) {
      cumul += hist[b];
      if (cumul >= n * 0.15) {
        p15 = (b + 1) * 8;
        break;
      }
    }
    const seuilSombre = Math.min((sumLum / n) * 0.42, Math.max(14, p15 * 1.35));
    for (let y = 1; y < h - 1; y++) {
      const base = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = base + x;
        const g = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
        // Un JOINT est sombre ET gris. Un sticker BLEU est sombre mais tres
        // colore : sa luminance (~70) passe sous le seuil d'obscurite des qu'il
        // y a un mur clair dans le champ, et sans le test de saturation on
        // efface purement et simplement tous les stickers bleus et rouges — le
        // detecteur ne voit alors que 6 stickers sur 9 et renonce.
        const sombre = lum[i] < seuilSombre && chroma[i] < SEUIL_GRIS;
        edge[i] = g > seuilGrad || sombre ? 1 : 0;
      }
    }

    // --- 3. composantes connexes des zones non-bord = stickers candidats ---
    const minSide = Math.min(w, h);
    const minCell = (minSide * o.minFaceRatio) / 3;
    const maxCell = (minSide * o.maxFaceRatio) / 3;
    const candidats = this.components(w, h).filter((b) => {
      const side = Math.max(b.w, b.h);
      if (side < Math.max(3, minCell * 0.55) || side > maxCell) return false;
      const ratio = b.w / b.h;
      if (ratio < 0.5 || ratio > 2) return false;
      // Un carre TOURNE remplit moins sa boite englobante : 1/(cos+sin)^2,
      // soit 0,515 a 35 degres et 0,5 a 45. Un seuil a 0,52 rejetait donc
      // silencieusement tous les cubes tenus de biais.
      return b.area / (b.w * b.h) > 0.44;
    });
    if (candidats.length < 4) return null;

    candidats.sort((a, b) => b.area - a.area);
    const blobs = candidats.slice(0, 40);

    // --- 4. vecteurs du reseau, puis meilleure position ---
    const bases = this.latticeBasis(blobs, minCell, maxCell);
    if (!bases.length) return null;

    let best: { cx: number; cy: number; matched: number } | null = null;
    const base = { u: { x: 0, y: 0 }, v: { x: 0, y: 0 } };
    for (const candidate of bases) {
      // On n'essaie les bases suivantes que si la premiere n'explique pas deja
      // tout le cube : la recherche coute cher, et le premier vote est bon dans
      // la grande majorite des cas.
      if (best && best.matched >= 9) break;
      let essai = this.bestLattice(blobs, candidate.u, candidate.v);
      if (!essai) continue;
      // --- ajustement du reseau aux moindres carres ---
      // Un cube incline se projette avec une legere perspective : l'espacement
      // n'est pas tout a fait constant. Recaler le reseau sur les stickers
      // trouves absorbe cet ecart et affine nettement le cadrage.
      let u = candidate.u;
      let v = candidate.v;
      for (let iter = 0; iter < 2; iter++) {
        const ajuste = this.refine(blobs, essai.cx, essai.cy, u, v);
        if (!ajuste) break;
        u = ajuste.u;
        v = ajuste.v;
        essai = { cx: ajuste.cx, cy: ajuste.cy, matched: ajuste.matched };
      }
      if (!best || essai.matched > best.matched) {
        best = essai;
        base.u = u;
        base.v = v;
      }
    }
    if (!best || best.matched < o.minMatched) return null;

    // Apres recalage, la maille doit toujours ressembler a une face de cube.
    const lu2 = Math.hypot(base.u.x, base.u.y);
    const lv2 = Math.hypot(base.v.x, base.v.y);
    const rapport = lu2 / lv2;
    const cosUV = (base.u.x * base.v.x + base.u.y * base.v.y) / (lu2 * lv2);
    const degUV = (Math.acos(Math.max(-1, Math.min(1, cosUV))) * 180) / Math.PI;
    if (rapport < 0.68 || rapport > 1.45 || degUV < 60 || degUV > 120) return null;

    // --- 5. controle des joints : plus sombres que les cases ---
    const jointure = this.gapContrast(lum, w, h, best.cx, best.cy, base.u, base.v);
    if (jointure < 0.4) return null;

    const cells: { x: number; y: number }[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const x = (best.cx + di * base.u.x + dj * base.v.x) * step;
        const y = (best.cy + di * base.u.y + dj * base.v.y) * step;
        cells.push({ x, y });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const demiU = (Math.hypot(base.u.x, base.u.y) * step) / 2;
    const demiV = (Math.hypot(base.v.x, base.v.y) * step) / 2;
    const marge = Math.max(demiU, demiV);
    const rect: GridRect = {
      x: minX - marge,
      y: minY - marge,
      width: maxX - minX + marge * 2,
      height: maxY - minY + marge * 2,
    };
    if (
      rect.x < -rect.width * 0.2 ||
      rect.y < -rect.height * 0.2 ||
      rect.x + rect.width > width * 1.2 ||
      rect.y + rect.height > height * 1.2
    ) {
      return null;
    }

    return {
      cx: best.cx * step,
      cy: best.cy * step,
      ux: base.u.x * step,
      uy: base.u.y * step,
      vx: base.v.x * step,
      vy: base.v.y * step,
      cells,
      rect,
      matched: best.matched,
      score: Math.min(1, (best.matched / 9) * 0.65 + jointure * 0.35),
    };
  }

  private ensure(w: number, h: number): void {
    if (this.w === w && this.h === h) return;
    this.w = w;
    this.h = h;
    this.lum = new Float32Array(w * h);
    this.chroma = new Float32Array(w * h);
    this.edge = new Uint8Array(w * h);
    this.labels = new Int32Array(w * h);
    this.stack = new Int32Array(w * h);
  }

  private components(w: number, h: number): Blob[] {
    const { edge, labels, stack } = this;
    labels.fill(0);
    const blobs: Blob[] = [];
    let label = 0;
    for (let start = 0; start < w * h; start++) {
      if (edge[start] || labels[start]) continue;
      label++;
      let top = 0;
      stack[top++] = start;
      labels[start] = label;
      let count = 0;
      let minX = w;
      let maxX = 0;
      let minY = h;
      let maxY = 0;
      let sx = 0;
      let sy = 0;
      while (top > 0) {
        const p = stack[--top];
        const x = p % w;
        const y = (p - x) / w;
        count++;
        sx += x;
        sy += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && !edge[p - 1] && !labels[p - 1]) {
          labels[p - 1] = label;
          stack[top++] = p - 1;
        }
        if (x < w - 1 && !edge[p + 1] && !labels[p + 1]) {
          labels[p + 1] = label;
          stack[top++] = p + 1;
        }
        if (y > 0 && !edge[p - w] && !labels[p - w]) {
          labels[p - w] = label;
          stack[top++] = p - w;
        }
        if (y < h - 1 && !edge[p + w] && !labels[p + w]) {
          labels[p + w] = label;
          stack[top++] = p + w;
        }
      }
      if (count < 6) continue;
      blobs.push({
        cx: sx / count,
        cy: sy / count,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
        area: count,
      });
    }
    return blobs;
  }

  /**
   * Trouve les deux vecteurs du reseau par vote sur les ecarts entre stickers.
   * On ne suppose pas un carre aligne sur l'image : le cube est presque
   * toujours legerement tourne ou incline, et sa face se projette alors en
   * parallelogramme. Chercher un carre aligne, c'est ne rien trouver des que
   * l'utilisateur ne tient pas son cube parfaitement de face.
   */
  private latticeBasis(
    blobs: Blob[],
    minCell: number,
    maxCell: number,
  ): { u: { x: number; y: number }; v: { x: number; y: number } }[] {
    const min = minCell * 0.6;
    const max = maxCell * 1.8;
    const ecarts: { x: number; y: number; d: number }[] = [];
    for (let i = 0; i < blobs.length; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        let dx = blobs[j].cx - blobs[i].cx;
        let dy = blobs[j].cy - blobs[i].cy;
        const d = Math.hypot(dx, dy);
        if (d < min || d > max) continue;
        // un ecart et son oppose decrivent le meme vecteur de reseau
        if (dx < 0 || (dx === 0 && dy < 0)) {
          dx = -dx;
          dy = -dy;
        }
        ecarts.push({ x: dx, y: dy, d });
      }
    }
    if (ecarts.length < 3) return [];

    // Bacs volontairement larges : sous perspective, l'espacement varie d'une
    // case a l'autre et des bacs fins eparpilleraient les votes du meme
    // vecteur de reseau, jusqu'a ne plus rien elire.
    const q = Math.max(2, minCell * 0.32);
    const vote = (liste: typeof ecarts, combien: number) => {
      const bacs = new Map<string, { x: number; y: number; n: number }>();
      for (const e of liste) {
        const cle = `${Math.round(e.x / q)},${Math.round(e.y / q)}`;
        const b = bacs.get(cle) ?? { x: 0, y: 0, n: 0 };
        b.x += e.x;
        b.y += e.y;
        b.n++;
        bacs.set(cle, b);
      }
      return [...bacs.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, combien)
        .filter((b) => b.n >= 2)
        .map((b) => ({ x: b.x / b.n, y: b.y / b.n, n: b.n }));
    };

    const bases: { u: { x: number; y: number }; v: { x: number; y: number } }[] = [];
    for (const u of vote(ecarts, 2)) {
      const lu = Math.hypot(u.x, u.y);
      // le second vecteur doit etre franchement oblique par rapport au premier
      // et de longueur comparable : c'est la definition d'une maille de cube
      // Une face de cube se projette en quadrilatere PRESQUE carre : les deux
      // vecteurs sont quasi perpendiculaires et de longueurs voisines. Sans
      // cette contrainte, n'importe quel parallelogramme etire du decor (mur,
      // vetement, visage) devient un "reseau" valable.
      const restants = ecarts.filter((e) => {
        const cos = (e.x * u.x + e.y * u.y) / (e.d * lu);
        const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        return deg > 62 && deg < 118 && e.d > lu * 0.72 && e.d < lu * 1.4;
      });
      for (const v of vote(restants, 2)) {
        // orienter u vers la droite et v vers le bas, pour une lecture ligne
        // par ligne conforme a ce que voit l'utilisateur
        let ux = u.x;
        let uy = u.y;
        let vx = v.x;
        let vy = v.y;
        if (Math.abs(ux) < Math.abs(uy)) {
          [ux, uy, vx, vy] = [vx, vy, ux, uy];
        }
        if (ux < 0) {
          ux = -ux;
          uy = -uy;
        }
        if (vy < 0) {
          vx = -vx;
          vy = -vy;
        }
        bases.push({ u: { x: ux, y: uy }, v: { x: vx, y: vy } });
      }
    }
    return bases;
  }

  /** Index spatial des stickers, pour retrouver le plus proche en O(1). */
  private indexer(blobs: Blob[], maille: number): Map<string, number[]> {
    const grille = new Map<string, number[]>();
    for (let i = 0; i < blobs.length; i++) {
      const cle = `${Math.floor(blobs[i].cx / maille)},${Math.floor(blobs[i].cy / maille)}`;
      const l = grille.get(cle);
      if (l) l.push(i);
      else grille.set(cle, [i]);
    }
    return grille;
  }

  private plusProche(
    blobs: Blob[],
    grille: Map<string, number[]>,
    maille: number,
    x: number,
    y: number,
    tol: number,
  ): Blob | null {
    const gx = Math.floor(x / maille);
    const gy = Math.floor(y / maille);
    let meilleur: Blob | null = null;
    let distance = tol;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const l = grille.get(`${gx + dx},${gy + dy}`);
        if (!l) continue;
        for (const i of l) {
          const b = blobs[i];
          const dx = b.cx - x;
          const dy = b.cy - y;
          const d = Math.hypot(dx, dy);
          if (d < distance) {
            distance = d;
            meilleur = b;
          }
        }
      }
    }
    return meilleur;
  }

  /**
   * Cherche la position du reseau qui explique le plus de candidats. Chaque
   * candidat est essaye a chacune des 9 positions : le sticker central peut
   * tres bien ne pas avoir ete detecte.
   */
  private bestLattice(
    blobs: Blob[],
    u: { x: number; y: number },
    v: { x: number; y: number },
  ): { cx: number; cy: number; matched: number } | null {
    let best: { cx: number; cy: number; matched: number } | null = null;
    const pas = Math.min(Math.hypot(u.x, u.y), Math.hypot(v.x, v.y));
    const tol = pas * 0.45;
    // On ne garde que les stickers a la taille d'une case : la contrainte
    // devient gratuite (elle sort de l'index) au lieu d'etre reevaluee a
    // chaque consultation.
    const compat = blobs.filter((b) => {
      const cote = (b.w + b.h) / 2;
      return cote >= pas * 0.42 && cote <= pas * 1.25;
    });
    if (compat.length < 4) return null;
    const maille = Math.max(2, tol);
    const grille = this.indexer(compat, maille);
    for (const b of compat) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const cx = b.cx - di * u.x - dj * v.x;
          const cy = b.cy - di * u.y - dj * v.y;
          const r = this.countMatches(compat, grille, maille, cx, cy, u, v, tol);
          if (r.matched >= 4 && (!best || r.matched > best.matched)) {
            best = { cx: r.ex, cy: r.ey, matched: r.matched };
          }
        }
      }
    }
    return best;
  }

  /**
   * Recale centre et vecteurs du reseau sur les stickers retrouves, par
   * moindres carres. Modele : position = centre + di*u + dj*v.
   */
  private refine(
    blobs: Blob[],
    cx: number,
    cy: number,
    u: { x: number; y: number },
    v: { x: number; y: number },
  ): { cx: number; cy: number; u: { x: number; y: number }; v: { x: number; y: number }; matched: number } | null {
    const pas = Math.min(Math.hypot(u.x, u.y), Math.hypot(v.x, v.y));
    const tol = pas * 0.45;
    const compat = blobs.filter((b) => {
      const cote = (b.w + b.h) / 2;
      return cote >= pas * 0.42 && cote <= pas * 1.25;
    });
    if (compat.length < 4) return null;
    const maille = Math.max(2, tol);
    const grille = this.indexer(compat, maille);
    let n = 0;
    let Si = 0;
    let Sj = 0;
    let Sii = 0;
    let Sjj = 0;
    let Sij = 0;
    let Tx = 0;
    let Txi = 0;
    let Txj = 0;
    let Ty = 0;
    let Tyi = 0;
    let Tyj = 0;

    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const tx = cx + di * u.x + dj * v.x;
        const ty = cy + di * u.y + dj * v.y;
        const meilleur = this.plusProche(compat, grille, maille, tx, ty, tol);
        if (!meilleur) continue;
        n++;
        Si += di;
        Sj += dj;
        Sii += di * di;
        Sjj += dj * dj;
        Sij += di * dj;
        Tx += meilleur.cx;
        Txi += meilleur.cx * di;
        Txj += meilleur.cx * dj;
        Ty += meilleur.cy;
        Tyi += meilleur.cy * di;
        Tyj += meilleur.cy * dj;
      }
    }
    if (n < 4) return null;

    const resoudre = (t0: number, t1: number, t2: number): [number, number, number] | null => {
      const m = [
        [n, Si, Sj, t0],
        [Si, Sii, Sij, t1],
        [Sj, Sij, Sjj, t2],
      ];
      for (let col = 0; col < 3; col++) {
        let pivot = col;
        for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
        if (Math.abs(m[pivot][col]) < 1e-9) return null;
        [m[col], m[pivot]] = [m[pivot], m[col]];
        for (let r = 0; r < 3; r++) {
          if (r === col) continue;
          const f = m[r][col] / m[col][col];
          for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
        }
      }
      return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
    };

    const sx = resoudre(Tx, Txi, Txj);
    const sy = resoudre(Ty, Tyi, Tyj);
    if (!sx || !sy) return null;
    return {
      cx: sx[0],
      cy: sy[0],
      u: { x: sx[1], y: sy[1] },
      v: { x: sx[2], y: sy[2] },
      matched: n,
    };
  }

  private countMatches(
    blobs: Blob[],
    grille: Map<string, number[]>,
    maille: number,
    cx: number,
    cy: number,
    u: { x: number; y: number },
    v: { x: number; y: number },
    tol: number,
  ): { matched: number; ex: number; ey: number } {
    let matched = 0;
    let sumX = 0;
    let sumY = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const tx = cx + di * u.x + dj * v.x;
        const ty = cy + di * u.y + dj * v.y;
        const meilleur = this.plusProche(blobs, grille, maille, tx, ty, tol);
        if (meilleur) {
          matched++;
          sumX += meilleur.cx - di * u.x - dj * v.x;
          sumY += meilleur.cy - di * u.y - dj * v.y;
        }
      }
    }
    return matched
      ? { matched, ex: sumX / matched, ey: sumY / matched }
      : { matched: 0, ex: cx, ey: cy };
  }

  /**
   * Part des joints internes nettement plus sombres que les cases voisines.
   * C'est ce controle qui distingue un cube d'un motif regulier quelconque.
   */
  private gapContrast(
    lum: Float32Array,
    w: number,
    h: number,
    cx: number,
    cy: number,
    u: { x: number; y: number },
    v: { x: number; y: number },
  ): number {
    const lire = (x: number, y: number): number => {
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h) return NaN;
      return lum[yi * w + xi];
    };
    let bons = 0;
    let total = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const x = cx + di * u.x + dj * v.x;
        const y = cy + di * u.y + dj * v.y;
        const centre = lire(x, y);
        if (Number.isNaN(centre)) continue;
        const paires: Array<[number, number, number, number]> = [];
        if (di < 1) paires.push([x + u.x, y + u.y, x + u.x / 2, y + u.y / 2]);
        if (dj < 1) paires.push([x + v.x, y + v.y, x + v.x / 2, y + v.y / 2]);
        for (const [vx, vy, jx, jy] of paires) {
          const voisin = lire(vx, vy);
          const joint = lire(jx, jy);
          if (Number.isNaN(voisin) || Number.isNaN(joint)) continue;
          total++;
          if (joint < Math.min(centre, voisin) * 0.75) bons++;
        }
      }
    }
    return total ? bons / total : 0;
  }
}

/**
 * Lissage du reseau detecte : la detection est refaite a chaque image, on ne
 * veut pas que la grille tremble. On suit vite un vrai deplacement et on ignore
 * le bruit.
 */
export class LatticeSmoother {
  private courant: Detection | null = null;
  private manques = 0;

  constructor(
    private readonly force = 0.4,
    private readonly tolerance = 10,
  ) {}

  get valeur(): Detection | null {
    return this.courant;
  }

  get perdu(): number {
    return this.manques;
  }

  reset(): void {
    this.courant = null;
    this.manques = 0;
  }

  push(d: Detection | null): Detection | null {
    if (!d) {
      this.manques++;
      if (this.manques > 20) this.courant = null;
      return this.courant;
    }
    this.manques = 0;
    if (!this.courant) {
      this.courant = d;
      return this.courant;
    }
    const saut =
      Math.abs(d.cx - this.courant.cx) +
      Math.abs(d.cy - this.courant.cy) +
      Math.abs(d.ux - this.courant.ux) +
      Math.abs(d.vy - this.courant.vy);
    const k = saut > this.tolerance * 6 ? 1 : this.force;
    const mel = (a: number, b: number) => a + (b - a) * k;
    const cx = mel(this.courant.cx, d.cx);
    const cy = mel(this.courant.cy, d.cy);
    const ux = mel(this.courant.ux, d.ux);
    const uy = mel(this.courant.uy, d.uy);
    const vx = mel(this.courant.vx, d.vx);
    const vy = mel(this.courant.vy, d.vy);
    this.courant = { ...d, cx, cy, ux, uy, vx, vy, ...geometrie(cx, cy, ux, uy, vx, vy) };
    return this.courant;
  }
}

/** Recalcule les centres des cases et la boite englobante. */
function geometrie(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
): { cells: { x: number; y: number }[]; rect: GridRect } {
  const cells: { x: number; y: number }[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const x = cx + di * ux + dj * vx;
      const y = cy + di * uy + dj * vy;
      cells.push({ x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const marge = Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy)) / 2;
  return {
    cells,
    rect: {
      x: minX - marge,
      y: minY - marge,
      width: maxX - minX + marge * 2,
      height: maxY - minY + marge * 2,
    },
  };
}
