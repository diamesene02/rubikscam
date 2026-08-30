import { describe, it, expect } from 'vitest';
import { FaceDetector } from '../src/media/detector';
import { sampleLattice } from '../src/media/sampler';
import { colorCost, toLinear, channelMask } from '../src/core/color';

/**
 * Personne ne tient son cube parfaitement de face. Ce test rend des faces
 * TOURNEES et vues EN PERSPECTIVE — le cas qui faisait echouer la detection en
 * usage reel — et verifie qu'on les trouve et qu'on lit les bonnes couleurs.
 */

const W = 320;
const H = 240;

const PALETTE: [number, number, number][] = [
  [236, 234, 228],
  [252, 214, 38],
  [198, 28, 44],
  [238, 118, 22],
  [0, 160, 74],
  [0, 68, 174],
];

let seed = 99;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296);

/** Homographie envoyant le carre unite sur 4 points image. */
function homographie(pts: [number, number][]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = pts;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sy = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
  }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}

function inverse3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

interface Scene {
  data: Uint8ClampedArray;
  coins: [number, number][];
  couleurs: number[];
}

function scene(rotationDeg: number, perspective: number, taille: number): Scene {
  const data = new Uint8ClampedArray(W * H * 4);
  // fond encombre
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const base = 150 + (x / W) * 40 - (y / H) * 25;
      data[i] = base + 25 + (rnd() - 0.5) * 10;
      data[i + 1] = base + 5 + (rnd() - 0.5) * 10;
      data[i + 2] = base - 15 + (rnd() - 0.5) * 10;
      data[i + 3] = 255;
    }
  }
  for (const t of [
    { x: 0, y: 150, w: 120, h: 90, c: [120, 130, 160] },
    { x: 210, y: 20, w: 105, h: 120, c: [176, 132, 104] },
  ]) {
    for (let y = t.y; y < Math.min(H, t.y + t.h); y++) {
      for (let x = t.x; x < Math.min(W, t.x + t.w); x++) {
        const i = (y * W + x) * 4;
        data[i] = t.c[0];
        data[i + 1] = t.c[1];
        data[i + 2] = t.c[2];
      }
    }
  }

  const cx = W / 2 + (rnd() - 0.5) * 40;
  const cy = H / 2 + (rnd() - 0.5) * 30;
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const s = taille / 2;
  const brut: [number, number][] = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ];
  // perspective : on rapproche les deux coins de droite
  const coins = brut.map(([x, y], k) => {
    const k2 = k === 1 || k === 2 ? 1 - perspective : 1;
    const px = x * k2;
    const py = y * k2;
    return [cx + px * cos - py * sin, cy + px * sin + py * cos] as [number, number];
  });

  const couleurs = Array.from({ length: 9 }, () => Math.floor(rnd() * 6));
  const Hm = homographie(coins);
  const Hi = inverse3(Hm);
  const minX = Math.max(0, Math.floor(Math.min(...coins.map((p) => p[0]))) - 2);
  const maxX = Math.min(W, Math.ceil(Math.max(...coins.map((p) => p[0]))) + 2);
  const minY = Math.max(0, Math.floor(Math.min(...coins.map((p) => p[1]))) - 2);
  const maxY = Math.min(H, Math.ceil(Math.max(...coins.map((p) => p[1]))) + 2);

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const w = Hi[6] * x + Hi[7] * y + Hi[8];
      const u = (Hi[0] * x + Hi[1] * y + Hi[2]) / w;
      const v = (Hi[3] * x + Hi[4] * y + Hi[5]) / w;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const col = Math.min(2, Math.floor(u * 3));
      const row = Math.min(2, Math.floor(v * 3));
      const fu = u * 3 - col;
      const fv = v * 3 - row;
      const gap = 0.09;
      const i = (y * W + x) * 4;
      if (fu < gap || fu > 1 - gap || fv < gap || fv > 1 - gap) {
        data[i] = 20;
        data[i + 1] = 20;
        data[i + 2] = 22;
      } else {
        const c = PALETTE[couleurs[row * 3 + col]];
        const ombre = 0.88 + u * 0.2;
        data[i] = Math.min(255, c[0] * ombre);
        data[i + 1] = Math.min(255, c[1] * ombre);
        data[i + 2] = Math.min(255, c[2] * ombre);
      }
    }
  }
  return { data, coins, couleurs };
}

/**
 * Centre reel de la face : image de (0,5 ; 0,5) par l'homographie. Pour un
 * quadrilatere en perspective ce n'est PAS la moyenne des 4 coins.
 */
function centreDe(coins: [number, number][]): [number, number] {
  const m = homographie(coins);
  const w = m[6] * 0.5 + m[7] * 0.5 + m[8];
  return [(m[0] * 0.5 + m[1] * 0.5 + m[2]) / w, (m[3] * 0.5 + m[4] * 0.5 + m[5]) / w];
}

describe('cube tenu de biais', () => {
  it('trouve la face malgre une rotation dans le plan', () => {
    const d = new FaceDetector();
    for (const angle of [0, 8, 15, 25, 35, 45]) {
      let ok = 0;
      const essais = 20;
      for (let t = 0; t < essais; t++) {
        const s = scene(angle, 0, 90 + rnd() * 50);
        const r = d.detect(s.data, W, H);
        if (!r) continue;
        const [cx, cy] = centreDe(s.coins);
        if (Math.hypot(r.cx - cx, r.cy - cy) < 12) ok++;
      }
      console.log(`  rotation ${String(angle).padStart(2)}° : ${ok}/${essais}`);
      expect(ok / essais, `rotation ${angle}°`).toBeGreaterThanOrEqual(0.8);
    }
  }, 30000);

  it('trouve la face malgre la perspective (cube incline)', () => {
    const d = new FaceDetector();
    for (const p of [0, 0.1, 0.2]) {
      const erreurs: number[] = [];
      let trouves = 0;
      const essais = 25;
      for (let t = 0; t < essais; t++) {
        const s = scene(10 + rnd() * 20, p, 100 + rnd() * 40);
        const r = d.detect(s.data, W, H);
        if (!r) continue;
        trouves++;
        const [cx, cy] = centreDe(s.coins);
        const cote = Math.hypot(r.ux, r.uy);
        erreurs.push(Math.hypot(r.cx - cx, r.cy - cy) / cote);
      }
      erreurs.sort((a, b) => a - b);
      const median = erreurs.length ? erreurs[erreurs.length >> 1] : NaN;
      console.log(
        `  perspective ${(p * 100).toFixed(0).padStart(2)} % : ${trouves}/${essais} trouves, ` +
          `erreur de centre mediane ${(median * 100).toFixed(1)} % d'une case`,
      );
      // Limite assumee : au-dela de ~20 % de perspective (cube franchement
      // incline), le reseau n'est plus affine et l'accrochage devient
      // aleatoire. L'application demande alors de presenter la face a plat,
      // plutot que de lire n'importe quoi.
      expect(trouves / essais, `perspective ${p}`).toBeGreaterThanOrEqual(p >= 0.2 ? 0.55 : 0.85);
      // un decalage sous 20 % d'une case ne perturbe pas l'echantillonnage,
      // qui ne lit que les 62 % centraux de chaque case
      expect(median, `perspective ${p}`).toBeLessThan(0.2);
    }
  }, 30000);

  it('lit les bonnes couleurs sur une face tournee ou inclinee', () => {
    const d = new FaceDetector();
    const refs = PALETTE.map((c) => toLinear({ r: c[0], g: c[1], b: c[2] }));

    for (const [nom, rot, persp] of [
      ['rotation seule    ', 40, 0],
      ['perspective seule ', 4, 0.12],
      ['rotation + persp  ', 35, 0.1],
    ] as const) {
      let justes = 0;
      let total = 0;
      for (let t = 0; t < 30; t++) {
        const s = scene(rnd() * rot, rnd() * persp, 100 + rnd() * 40);
        const r = d.detect(s.data, W, H);
        if (!r) continue;
        const lues = sampleLattice(s.data, W, H, r.cells, { x: r.ux, y: r.uy }, { x: r.vx, y: r.vy });
        for (let i = 0; i < 9; i++) {
          // metrique de l'application : chromaticite, insensible a l'ombrage
          const lin = toLinear(lues[i].rgb);
          const masque = channelMask(lues[i].rgb);
          let best = 0;
          for (let k = 1; k < 6; k++) {
            if (colorCost(lin, masque, refs[k]) < colorCost(lin, masque, refs[best])) best = k;
          }
          total++;
          if (best === s.couleurs[i]) justes++;
        }
      }
      console.log(`  ${nom} : ${((justes / total) * 100).toFixed(1)} % de couleurs justes`);
      // Mesure volontairement severe : plus proche couleur de la palette, sans
      // AUCUNE des aides du vrai classifieur (contrainte des 9 stickers par
      // couleur, illuminant estime par face, reparation, relecture). Elle
      // mesure la qualite du RESEAU, pas la fiabilite de l'application : ce
      // chiffre-la est dans pipeline.test.ts, et il est bien meilleur.
      expect(justes / total, nom).toBeGreaterThanOrEqual(0.95);
    }
  }, 30000);
});

describe('stabilite du reseau', () => {
  /**
   * Regression : le reseau ne doit pas changer de forme d'une image a l'autre
   * quand le cube ne bouge presque pas. Un reseau qui "danse" signale qu'il
   * s'accroche au decor et non au cube, et rend la lecture inexploitable.
   */
  it('garde la meme forme sur des images successives', () => {
    const d = new FaceDetector();
    for (const [nom, rot, persp] of [
      ['droit  ', 0, 0],
      ['incline', 18, 0.06],
    ] as const) {
      const us: number[] = [];
      const vs: number[] = [];
      const angles: number[] = [];
      let perdus = 0;
      for (let f = 0; f < 25; f++) {
        // meme scene, uniquement le tremblement de la main
        const s = scene(rot + (rnd() - 0.5) * 1.5, persp, 120 + (rnd() - 0.5) * 3);
        const r = d.detect(s.data, W, H);
        if (!r) {
          perdus++;
          continue;
        }
        us.push(Math.hypot(r.ux, r.uy));
        vs.push(Math.hypot(r.vx, r.vy));
        angles.push((Math.atan2(r.uy, r.ux) * 180) / Math.PI);
      }
      const ecartType = (a: number[]) => {
        const m = a.reduce((x, y) => x + y, 0) / a.length;
        return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
      };
      const moy = us.reduce((a, b) => a + b, 0) / us.length;
      console.log(
        `  ${nom} : ${perdus} images perdues, taille de case ${moy.toFixed(1)} px ` +
          `±${ecartType(us).toFixed(2)}, angle ±${ecartType(angles).toFixed(2)}°`,
      );
      expect(perdus, nom).toBeLessThanOrEqual(3);
      // la taille de case ne doit pas varier de plus de 5 % d'une image a l'autre
      expect(ecartType(us) / moy, nom).toBeLessThan(0.05);
      expect(ecartType(vs) / moy, nom).toBeLessThan(0.05);
      expect(ecartType(angles), nom).toBeLessThan(3);
    }
  }, 30000);
});
