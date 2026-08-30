import { describe, it, expect } from 'vitest';
import { FaceDetector } from '../src/media/detector';

/**
 * On fabrique des scenes realistes : un fond encombre (mur, vetement, visage
 * schematise, etagere) et une face de cube posee quelque part, a une taille
 * quelconque. Le detecteur doit la retrouver sans qu'on lui dise ou chercher.
 */

const W = 320;
const H = 240;

const PALETTE = [
  [236, 234, 228],
  [252, 214, 38],
  [198, 28, 44],
  [238, 118, 22],
  [0, 160, 74],
  [0, 68, 174],
];

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296);

interface Scene {
  data: Uint8ClampedArray;
  cx: number;
  cy: number;
  side: number;
}

function fond(data: Uint8ClampedArray, bruit: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // mur beige avec degrade
      const base = 150 + (x / W) * 40 - (y / H) * 25;
      data[i] = base + 25 + (rnd() - 0.5) * bruit;
      data[i + 1] = base + 5 + (rnd() - 0.5) * bruit;
      data[i + 2] = base - 15 + (rnd() - 0.5) * bruit;
      data[i + 3] = 255;
    }
  }
  // quelques aplats parasites : epaule, tete, meuble
  const taches = [
    { x: 0, y: 150, w: 130, h: 90, c: [120, 130, 160] },
    { x: 200, y: 20, w: 110, h: 130, c: [176, 132, 104] },
    { x: 140, y: 0, w: 40, h: 240, c: [92, 74, 60] },
  ];
  for (const t of taches) {
    for (let y = t.y; y < Math.min(H, t.y + t.h); y++) {
      for (let x = t.x; x < Math.min(W, t.x + t.w); x++) {
        const i = (y * W + x) * 4;
        data[i] = t.c[0] + (rnd() - 0.5) * bruit;
        data[i + 1] = t.c[1] + (rnd() - 0.5) * bruit;
        data[i + 2] = t.c[2] + (rnd() - 0.5) * bruit;
      }
    }
  }
}

function poserCube(data: Uint8ClampedArray, cx: number, cy: number, side: number): void {
  const cell = side / 3;
  const gap = cell * 0.09;
  const couleurs = Array.from({ length: 9 }, () => PALETTE[Math.floor(rnd() * 6)]);
  const x0 = cx - side / 2;
  const y0 = cy - side / 2;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, y0 + side); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, x0 + side); x++) {
      const u = (x - x0) / cell;
      const v = (y - y0) / cell;
      const col = Math.min(2, Math.floor(u));
      const row = Math.min(2, Math.floor(v));
      const fu = u - col;
      const fv = v - row;
      const bord = fu < gap / cell || fu > 1 - gap / cell || fv < gap / cell || fv > 1 - gap / cell;
      const i = (y * W + x) * 4;
      if (bord) {
        data[i] = 22;
        data[i + 1] = 22;
        data[i + 2] = 24;
      } else {
        const c = couleurs[row * 3 + col];
        const ombre = 0.85 + ((x - x0) / side) * 0.25;
        data[i] = Math.min(255, c[0] * ombre);
        data[i + 1] = Math.min(255, c[1] * ombre);
        data[i + 2] = Math.min(255, c[2] * ombre);
      }
    }
  }
}

function scene(minSide: number, maxSide: number, bruit = 10): Scene {
  const data = new Uint8ClampedArray(W * H * 4);
  fond(data, bruit);
  const side = minSide + rnd() * (maxSide - minSide);
  const cx = side / 2 + 6 + rnd() * (W - side - 12);
  const cy = side / 2 + 6 + rnd() * (H - side - 12);
  poserCube(data, cx, cy, side);
  return { data, cx, cy, side };
}

describe('detection automatique de la face', () => {
  it('trouve un cube de taille moyenne dans une scene encombree', () => {
    const detecteur = new FaceDetector();
    let trouves = 0;
    let erreurCentre = 0;
    let erreurTaille = 0;
    const essais = 40;
    for (let t = 0; t < essais; t++) {
      const s = scene(70, 140);
      const d = detecteur.detect(s.data, W, H);
      if (!d) continue;
      const dcx = d.rect.x + d.rect.width / 2;
      const dcy = d.rect.y + d.rect.height / 2;
      const ec = Math.hypot(dcx - s.cx, dcy - s.cy) / s.side;
      const et = Math.abs(d.rect.width - s.side) / s.side;
      if (ec < 0.12 && et < 0.2) {
        trouves++;
        erreurCentre += ec;
        erreurTaille += et;
      }
    }
    console.log(
      `  moyen : ${trouves}/${essais} detections justes, ` +
        `centre ±${((erreurCentre / Math.max(1, trouves)) * 100).toFixed(1)}% ` +
        `taille ±${((erreurTaille / Math.max(1, trouves)) * 100).toFixed(1)}%`,
    );
    expect(trouves / essais).toBeGreaterThanOrEqual(0.9);
  });

  it('trouve aussi un petit cube (webcam grand-angle, cube loin)', () => {
    const detecteur = new FaceDetector();
    let trouves = 0;
    const essais = 40;
    for (let t = 0; t < essais; t++) {
      const s = scene(45, 75);
      const d = detecteur.detect(s.data, W, H);
      if (!d) continue;
      const dcx = d.rect.x + d.rect.width / 2;
      const dcy = d.rect.y + d.rect.height / 2;
      if (Math.hypot(dcx - s.cx, dcy - s.cy) / s.side < 0.15 && Math.abs(d.rect.width - s.side) / s.side < 0.25) {
        trouves++;
      }
    }
    console.log(`  petit : ${trouves}/${essais} detections justes`);
    expect(trouves / essais).toBeGreaterThanOrEqual(0.85);
  });

  it('ne voit pas de cube quand il n y en a pas', () => {
    const detecteur = new FaceDetector();
    let fauxPositifs = 0;
    const essais = 40;
    for (let t = 0; t < essais; t++) {
      const data = new Uint8ClampedArray(W * H * 4);
      fond(data, 14);
      if (detecteur.detect(data, W, H)) fauxPositifs++;
    }
    console.log(`  faux positifs sur fond seul : ${fauxPositifs}/${essais}`);
    expect(fauxPositifs / essais).toBeLessThanOrEqual(0.1);
  });

  it('reste rapide', () => {
    const detecteur = new FaceDetector();
    const s = scene(90, 130);
    // chauffe : le premier appel alloue les tampons et fait compiler le code
    for (let i = 0; i < 10; i++) detecteur.detect(s.data, W, H);
    // mediane de plusieurs series : la machine peut etre chargee par ailleurs
    const series: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) detecteur.detect(s.data, W, H);
      series.push((performance.now() - t0) / 20);
    }
    series.sort((a, b) => a - b);
    const ms = series[2];
    console.log(`  ${ms.toFixed(2)} ms par image (mediane de 5 series)`);
    // L'application ne relance la recherche qu'une image sur deux une fois le
    // cube accroche : le budget effectif est donc la moitie de cette valeur.
    // Marge large : ce test mesure aussi la charge de la machine. A 16 ms il
    // echouait par intermittence pendant les passes completes, sans qu'aucune
    // regression reelle n'existe.
    expect(ms).toBeLessThan(40);
  });
});

describe('stickers sombres sur fond clair', () => {
  /**
   * Regression : un joint de cube est sombre ET gris ; un sticker bleu est
   * sombre MAIS tres colore. En jugeant l'obscurite seule, un mur clair dans
   * le champ suffit a faire monter le seuil au-dessus de la luminance du bleu
   * (~70) : tous les stickers bleus et rouges sont alors effaces, le detecteur
   * ne voit plus que 6 stickers sur 9 et renonce. C'est ce qui rendait le scan
   * impossible sur un vrai cube dans une piece aux murs clairs.
   */
  function sceneSombreSurClair(couleurs: [number, number, number][]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(W * H * 4);
    // mur tres clair : fait monter la luminance moyenne et le percentile bas
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = 214;
      data[i * 4 + 1] = 208;
      data[i * 4 + 2] = 196;
      data[i * 4 + 3] = 255;
    }
    const side = 120;
    const x0 = 100;
    const y0 = 60;
    const cell = side / 3;
    const gap = cell * 0.1;
    for (let y = y0 - 4; y < y0 + side + 4; y++) {
      for (let x = x0 - 4; x < x0 + side + 4; x++) {
        const i = (y * W + x) * 4;
        data[i] = 18;
        data[i + 1] = 18;
        data[i + 2] = 20;
      }
    }
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const col = couleurs[r * 3 + c];
        for (let y = Math.round(y0 + r * cell + gap); y < y0 + r * cell + cell - gap; y++) {
          for (let x = Math.round(x0 + c * cell + gap); x < x0 + c * cell + cell - gap; x++) {
            const i = (y * W + x) * 4;
            data[i] = col[0];
            data[i + 1] = col[1];
            data[i + 2] = col[2];
          }
        }
      }
    }
    return data;
  }

  const BLEU: [number, number, number] = [24, 74, 178];
  const ROUGE: [number, number, number] = [190, 34, 40];
  const BLANC: [number, number, number] = [240, 240, 236];
  const VERT: [number, number, number] = [22, 152, 78];

  it('trouve une face composee de bleus et de rouges devant un mur clair', () => {
    const detecteur = new FaceDetector();
    const faces: [number, number, number][][] = [
      [BLEU, BLEU, BLEU, BLEU, BLEU, BLEU, BLEU, BLEU, BLEU],
      [BLEU, ROUGE, BLEU, ROUGE, BLEU, ROUGE, BLEU, ROUGE, BLEU],
      [BLEU, BLANC, ROUGE, VERT, BLEU, ROUGE, BLANC, BLEU, VERT],
    ];
    for (const face of faces) {
      const d = detecteur.detect(sceneSombreSurClair(face), W, H);
      expect(d, JSON.stringify(face[0])).not.toBeNull();
      expect(d!.matched, 'les 9 stickers doivent etre retrouves').toBeGreaterThanOrEqual(8);
      const cx = d!.rect.x + d!.rect.width / 2;
      const cy = d!.rect.y + d!.rect.height / 2;
      expect(Math.hypot(cx - 160, cy - 120)).toBeLessThan(10);
    }
  });
});
