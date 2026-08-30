/**
 * Echantillonnage des 9 stickers dans une image.
 *
 * Deux robustesses essentielles, qui font plus pour la fiabilite que n'importe
 * quel raffinement du classifieur :
 *
 *  - SPATIALE : dans chaque case on trie les pixels par clarte et on ne garde
 *    qu'une bande basse-mediane. Le haut de la distribution, ce sont les
 *    reflets speculaires ; le bas, les joints noirs entre stickers et les
 *    ombres. On moyenne la bande retenue en gardant la correlation entre
 *    canaux (mediane par canal independante fabriquerait une couleur qui
 *    n'existe nulle part dans l'image).
 *
 *  - TEMPORELLE : un reflet se deplace quand la main bouge, la couleur du
 *    sticker non. En gardant plusieurs images et en retenant un percentile bas
 *    de clarte pour chaque case, les reflets disparaissent presque
 *    completement.
 */

import type { RGB } from '../core/color';

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CellSample {
  rgb: RGB;
  /** Dispersion robuste dans la case (elevee = grille mal placee ou flou). */
  spread: number;
  /** Fraction de pixels dont au moins un canal est sature. */
  clipped: number;
}

export interface SampleOptions {
  /** Part de la case reellement echantillonnee (0..1). */
  patch?: number;
  /** Pas d'echantillonnage en pixels. */
  stride?: number;
  /** Bande de clarte conservee, en percentiles. */
  lowPercentile?: number;
  highPercentile?: number;
  /**
   * Bande dediee a la case CENTRALE. Le centre d'une face porte souvent le
   * logo de la marque : un texte sombre sur le sticker. Avec la bande normale
   * (basse-mediane, concue pour rejeter les reflets), ce texte sombre tombe
   * pile dans la fenetre retenue et fausse la couleur du centre — la plus
   * importante de toutes, puisqu'elle sert d'ancre. On lit donc le centre dans
   * une bande MEDIANE-HAUTE : au-dessus du logo, en dessous des reflets.
   */
  centreLowPercentile?: number;
  centreHighPercentile?: number;
}

/**
 * Bande de clarte conservee dans chaque case.
 *
 * Centree sur la mediane, et non tiree vers le bas. Une bande basse rejette
 * bien les reflets, mais en lumiere faible elle retient surtout la partie
 * sombre du sticker et le bord du joint : les couleurs ressortent ternes et
 * delavees, et rouge/orange/jaune deviennent indiscernables. Le rejet des
 * reflets est deja assure par l'accumulation TEMPORELLE (percentile bas sur
 * plusieurs images) : la mediane spatiale est donc le bon estimateur ici.
 */
const DEFAULTS: Required<SampleOptions> = {
  patch: 0.62,
  stride: 2,
  lowPercentile: 0.3,
  highPercentile: 0.72,
  centreLowPercentile: 0.4,
  centreHighPercentile: 0.8,
};

interface Pixel {
  r: number;
  g: number;
  b: number;
  y: number;
}

/**
 * Extrait 9 echantillons le long d'un reseau AFFINE : `centres` donne les 9
 * centres de cases, `u` et `v` les vecteurs d'une case a sa voisine. Cette
 * forme accepte un cube tourne ou incline, dont la face se projette en
 * parallelogramme — c'est le cas normal quand on tient un cube a la main.
 */
export function sampleLattice(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  centres: readonly { x: number; y: number }[],
  u: { x: number; y: number },
  v: { x: number; y: number },
  options: SampleOptions = {},
): CellSample[] {
  const o = { ...DEFAULTS, ...options };
  const taille = Math.min(Math.hypot(u.x, u.y), Math.hypot(v.x, v.y));
  // nombre de points echantillonnes par cote de case
  const m = Math.max(5, Math.min(21, Math.round((taille * o.patch) / o.stride)));
  const out: CellSample[] = [];
  const buf: Pixel[] = [];

  for (let cellIndex = 0; cellIndex < centres.length; cellIndex++) {
    const centre = centres[cellIndex];
    const lo0 = cellIndex === 4 ? o.centreLowPercentile : o.lowPercentile;
    const hi0 = cellIndex === 4 ? o.centreHighPercentile : o.highPercentile;
    buf.length = 0;
    let clipped = 0;
    let total = 0;
    for (let i = 0; i < m; i++) {
      const a = (i / (m - 1) - 0.5) * o.patch;
      for (let j = 0; j < m; j++) {
        const b = (j / (m - 1) - 0.5) * o.patch;
        const x = Math.round(centre.x + a * u.x + b * v.x);
        const y = Math.round(centre.y + a * u.y + b * v.y);
        if (x < 0 || y < 0 || x >= imageWidth || y >= imageHeight) continue;
        const idx = (y * imageWidth + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const bl = data[idx + 2];
        total++;
        if (r >= 249 || g >= 249 || bl >= 249) clipped++;
        buf.push({ r, g, b: bl, y: 0.2126 * r + 0.7152 * g + 0.0722 * bl });
      }
    }

    if (!buf.length) {
      out.push({ rgb: { r: 0, g: 0, b: 0 }, spread: 999, clipped: 1 });
      continue;
    }

    buf.sort((p, q) => p.y - q.y);
    const lo = Math.floor(buf.length * lo0);
    const hi = Math.max(lo + 1, Math.ceil(buf.length * hi0));
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = lo; i < hi; i++) {
      r += buf[i].r;
      g += buf[i].g;
      b += buf[i].b;
    }
    const nb = hi - lo;
    const q1 = buf[Math.floor(buf.length * 0.25)].y;
    const q3 = buf[Math.floor(buf.length * 0.75)].y;
    const med = buf[buf.length >> 1].y;

    out.push({
      rgb: { r: r / nb, g: g / nb, b: b / nb },
      spread: (q3 - q1) / (med + 12),
      clipped: total ? clipped / total : 1,
    });
  }
  return out;
}

/**
 * Variante alignee sur l'image : `rect` est le carre englobant de la face.
 * Conservee pour les cas ou l'on connait deja un rectangle (tests, repli).
 */
export function sampleGrid(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  rect: GridRect,
  options: SampleOptions = {},
): CellSample[] {
  const cw = rect.width / 3;
  const ch = rect.height / 3;
  const centres: { x: number; y: number }[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      centres.push({ x: rect.x + (c + 0.5) * cw, y: rect.y + (r + 0.5) * ch });
    }
  }
  return sampleLattice(
    data,
    imageWidth,
    imageHeight,
    centres,
    { x: cw, y: 0 },
    { x: 0, y: ch },
    options,
  );
}

/**
 * Accumulateur temporel : conserve les dernieres lectures de chaque case et
 * renvoie un percentile bas de clarte. Un reflet ajoute toujours de la lumiere,
 * donc la lecture la plus sombre parmi des images stables est la bonne.
 */
export class TemporalAccumulator {
  private frames: CellSample[][] = [];

  constructor(
    private readonly capacity = 12,
    private readonly percentile = 0.3,
  ) {}

  get size(): number {
    return this.frames.length;
  }

  reset(): void {
    this.frames.length = 0;
  }

  push(frame: CellSample[]): void {
    this.frames.push(frame);
    if (this.frames.length > this.capacity) this.frames.shift();
  }

  /** Lecture consolidee des 9 cases (null si aucune image accumulee). */
  consolidate(): CellSample[] | null {
    if (!this.frames.length) return null;
    const cells = this.frames[0].length;
    const out: CellSample[] = [];
    for (let c = 0; c < cells; c++) {
      const series = this.frames.map((f) => f[c]);
      series.sort(
        (a, b) =>
          0.2126 * a.rgb.r +
          0.7152 * a.rgb.g +
          0.0722 * a.rgb.b -
          (0.2126 * b.rgb.r + 0.7152 * b.rgb.g + 0.0722 * b.rgb.b),
      );
      const pick = series[Math.min(series.length - 1, Math.floor(series.length * this.percentile))];
      const spread = series.reduce((a, s) => a + s.spread, 0) / series.length;
      const clipped = series.reduce((a, s) => Math.min(a, s.clipped), 1);
      out.push({ rgb: pick.rgb, spread, clipped });
    }
    return out;
  }
}

/** Qualite globale d'une lecture de face. */
export interface FaceQuality {
  /** Cases dont une part notable des pixels est saturee. */
  burnt: number;
  /** Cases dont la dispersion interne est anormale (grille mal placee, flou). */
  noisy: number;
  /** Clarte mediane des cases (0-255). */
  brightness: number;
  ok: boolean;
  reason: string;
}

/** Sous ce niveau, les couleurs sont delavees et le rouge/orange indiscernable. */
export const SEUIL_SOMBRE = 55;

export function assessFace(cells: CellSample[]): FaceQuality {
  let burnt = 0;
  let noisy = 0;
  const clartes: number[] = [];
  for (const c of cells) {
    if (c.clipped > 0.25) burnt++;
    if (c.spread > 0.5) noisy++;
    clartes.push(0.2126 * c.rgb.r + 0.7152 * c.rgb.g + 0.0722 * c.rgb.b);
  }
  clartes.sort((a, b) => a - b);
  const brightness = clartes[4];

  let reason = '';
  // Le manque de lumiere passe avant le reste : dans le noir, toutes les
  // couleurs convergent vers le gris et aucun traitement ne les separe.
  if (brightness < SEUIL_SOMBRE) {
    reason = "Il fait trop sombre : allume une lumiere ou rapproche le cube d'une fenetre.";
  } else if (burnt > 1) {
    reason = 'Trop de reflets : incline le cube ou eloigne la lumiere.';
  } else if (noisy > 1) {
    reason = "Cadre mieux le cube dans la grille (ou stabilise l'image).";
  }
  return {
    burnt,
    noisy,
    brightness,
    ok: brightness >= SEUIL_SOMBRE && burnt <= 1 && noisy <= 1,
    reason,
  };
}

/** Ecart maximal entre deux lectures, pour juger de la stabilite. */
export function maxCellDelta(a: CellSample[], b: CellSample[]): number {
  let worst = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const d =
      Math.abs(a[i].rgb.r - b[i].rgb.r) +
      Math.abs(a[i].rgb.g - b[i].rgb.g) +
      Math.abs(a[i].rgb.b - b[i].rgb.b);
    if (d > worst) worst = d;
  }
  return worst / 3;
}

function clarteMoyenne(cells: CellSample[]): number {
  let somme = 0;
  for (const c of cells) somme += 0.2126 * c.rgb.r + 0.7152 * c.rgb.g + 0.0722 * c.rgb.b;
  return cells.length ? somme / cells.length : 0;
}

/**
 * Meme mesure, mais apres avoir ramene les deux lectures a la meme clarte.
 * Indispensable pour reconnaitre qu'on remontre la MEME face : si la lumiere a
 * change entre-temps (l'utilisateur s'est deplace, a allume une lampe), une
 * comparaison brute conclurait a tort que la face est nouvelle.
 */
export function maxCellDeltaNormalise(a: CellSample[], b: CellSample[]): number {
  const ca = clarteMoyenne(a);
  const cb = clarteMoyenne(b);
  if (ca < 1 || cb < 1) return maxCellDelta(a, b);
  const k = ca / cb;
  let worst = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const d =
      Math.abs(a[i].rgb.r - b[i].rgb.r * k) +
      Math.abs(a[i].rgb.g - b[i].rgb.g * k) +
      Math.abs(a[i].rgb.b - b[i].rgb.b * k);
    if (d > worst) worst = d;
  }
  return worst / 3;
}
