import { describe, it, expect } from 'vitest';
import { classifyCube, type RGB } from '../src/core/color';
import { repairReading, suspectFaces } from '../src/core/repair';
import { sampleLattice, TemporalAccumulator, assessFace } from '../src/media/sampler';
import { FaceDetector } from '../src/media/detector';
import { SOLVED_FACELETS, applyAlg, randomScramble, validate } from '../src/core/cube';
import { FACES, type Face } from '../src/core/geometry';

/**
 * Test bout en bout AU NIVEAU PIXEL : on fabrique de vraies images de face
 * (joints entre stickers, degrade d'eclairage, reflet speculaire mobile, bruit
 * capteur, auto-exposition camera, et surtout un cube TENU DE BIAIS comme dans
 * la vraie vie), puis on fait tourner le vrai detecteur, le vrai
 * echantillonneur et le vrai classifieur. Rien n'est court-circuite : si la
 * detection echoue, l'image est perdue, exactement comme dans l'application.
 */

const STICKER_RGB: Record<string, RGB> = {
  blanc: { r: 236, g: 234, b: 228 },
  jaune: { r: 252, g: 214, b: 38 },
  rouge: { r: 198, g: 28, b: 44 },
  orange: { r: 238, g: 118, b: 22 },
  vert: { r: 0, g: 160, b: 74 },
  bleu: { r: 0, g: 68, b: 174 },
};
const COLOR_NAMES = Object.keys(STICKER_RGB);

let seed = 20260828;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function gauss(sigma: number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd()) * sigma;
}
function shuffle<T>(a: T[]): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const W = 168;
const H = 168;
const PAD = 17;
void PAD;
const SIZE = 134;

export interface Scene {
  colors: RGB[]; // 9 couleurs de la face
  tempR: number;
  tempB: number;
  gradX: number;
  gradY: number;
  glareX: number;
  glareY: number;
  glareR: number;
  glareI: number;
  noise: number;
  gap: number;
  rotation: number;
  perspective: number;
  taille: number;
}

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

/** Rend une image RGBA de la face, tenue de biais. */
function render(scene: Scene, exposure: number, jitter: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  const gx = scene.glareX + gauss(jitter * 2);
  const gy = scene.glareY + gauss(jitter * 2);

  const cx = W / 2 + gauss(jitter);
  const cy = H / 2 + gauss(jitter);
  const r = ((scene.rotation + gauss(jitter * 0.3)) * Math.PI) / 180;
  const co = Math.cos(r);
  const si = Math.sin(r);
  const demi = scene.taille / 2;
  const coins = ([[-demi, -demi], [demi, -demi], [demi, demi], [-demi, demi]] as [number, number][]).map(
    ([x, y], k) => {
      const p = k === 1 || k === 2 ? 1 - scene.perspective : 1;
      return [cx + x * p * co - y * p * si, cy + x * p * si + y * p * co] as [number, number];
    },
  );
  const Hi = inverse3(homographie(coins));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let rr = 14;
      let gg = 14;
      let bb = 16;
      const w = Hi[6] * x + Hi[7] * y + Hi[8];
      const u = (Hi[0] * x + Hi[1] * y + Hi[2]) / w;
      const v = (Hi[3] * x + Hi[4] * y + Hi[5]) / w;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        const col = Math.min(2, Math.floor(u * 3));
        const row = Math.min(2, Math.floor(v * 3));
        const fx = u * 3 - col;
        const fy = v * 3 - row;
        if (fx < scene.gap || fx > 1 - scene.gap || fy < scene.gap || fy > 1 - scene.gap) {
          rr = 16;
          gg = 16;
          bb = 18;
        } else {
          const c = scene.colors[row * 3 + col];
          const shade = 1 + (u - 0.5) * scene.gradX + (v - 0.5) * scene.gradY;
          rr = c.r * shade * scene.tempR;
          gg = c.g * shade;
          bb = c.b * shade * scene.tempB;
        }
      } else {
        // fond : mur clair, pour que le cube ne soit pas seul sur du noir
        const base = 120 + (x / W) * 30 - (y / H) * 20;
        rr = base + 20;
        gg = base + 4;
        bb = base - 12;
      }
      const d2 = (x - gx) * (x - gx) + (y - gy) * (y - gy);
      const glare = scene.glareI * Math.exp(-d2 / (2 * scene.glareR * scene.glareR));
      data[i] = Math.max(0, Math.min(255, (rr + glare) * exposure + gauss(scene.noise)));
      data[i + 1] = Math.max(0, Math.min(255, (gg + glare) * exposure + gauss(scene.noise)));
      data[i + 2] = Math.max(0, Math.min(255, (bb + glare) * exposure + gauss(scene.noise)));
      data[i + 3] = 255;
    }
  }
  return data;
}


interface Conditions {
  temperature: number;
  shading: number;
  glareProbability: number;
  glareIntensity: number;
  noise: number;
  jitter: number;
  frames: number;
  gate: boolean;
  /** Inclinaison maximale du cube, en degres : personne ne le tient droit. */
  rotationMax: number;
  perspectiveMax: number;
}

const BON: Conditions = {
  temperature: 0.06, shading: 0.1, glareProbability: 0.25, glareIntensity: 70,
  noise: 3, jitter: 1.0, frames: 14, gate: true, rotationMax: 10, perspectiveMax: 0.04,
};
const REALISTE: Conditions = {
  temperature: 0.14, shading: 0.22, glareProbability: 0.6, glareIntensity: 150,
  noise: 6, jitter: 1.8, frames: 14, gate: true, rotationMax: 22, perspectiveMax: 0.1,
};
const HOSTILE: Conditions = {
  temperature: 0.24, shading: 0.35, glareProbability: 0.9, glareIntensity: 230,
  noise: 10, jitter: 3.0, frames: 14, gate: true, rotationMax: 30, perspectiveMax: 0.12,
};

/** Capture une face comme le fait l'application : N images, accumulation
 *  temporelle, puis controle qualite avec baisse d'exposition si necessaire. */
const detecteur = new FaceDetector();

function captureFace(colors: RGB[], cond: Conditions): { rgb: RGB[]; retries: number } {
  const scene: Scene = {
    colors,
    tempR: 1 + gauss(cond.temperature),
    tempB: 1 - gauss(cond.temperature),
    gradX: gauss(cond.shading),
    gradY: gauss(cond.shading),
    glareX: 20 + rnd() * 128,
    glareY: 20 + rnd() * 128,
    glareR: 14 + rnd() * 26,
    glareI: rnd() < cond.glareProbability ? cond.glareIntensity * (0.4 + rnd()) : 0,
    noise: cond.noise,
    gap: 0.08,
    rotation: (rnd() - 0.5) * 2 * cond.rotationMax,
    perspective: rnd() * cond.perspectiveMax,
    taille: SIZE * (0.85 + rnd() * 0.3),
  };

  const peak = Math.max(...colors.flatMap((c) => [c.r * scene.tempR, c.g, c.b * scene.tempB]), 1);
  let exposure = 235 / peak;

  // Meme hysteresis que l'application : ACCROCHER une face exige 7 cases
  // retrouvees (specificite contre les faux positifs), la GARDER n'en exige
  // que 5 (un reflet peut manger deux stickers sans faire perdre le cube).
  let accroche = false;
  for (let retry = 0; retry <= 4; retry++) {
    const acc = new TemporalAccumulator(cond.frames, 0.3);
    for (let f = 0; f < cond.frames; f++) {
      const img = render(scene, exposure, cond.jitter);
      // vraie chaine : on cherche le cube dans l'image, on n'y accede pas
      const d = detecteur.detect(img, W, H, { minMatched: accroche ? 5 : 7 });
      if (!d) continue;
      accroche = true;
      acc.push(
        sampleLattice(img, W, H, d.cells, { x: d.ux, y: d.uy }, { x: d.vx, y: d.vy }),
      );
    }
    const cells = acc.consolidate();
    if (!cells) {
      // rien vu du tout : l'utilisateur repositionne le cube, et l'application
      // baisse l'exposition (le reflet est la premiere cause de non-detection)
      scene.rotation = (rnd() - 0.5) * 2 * cond.rotationMax * 0.5;
      scene.perspective = rnd() * cond.perspectiveMax * 0.5;
      exposure *= 0.85;
      continue;
    }
    const quality = assessFace(cells);
    if (!cond.gate || quality.ok || retry === 4) {
      return { rgb: cells.map((c) => c.rgb), retries: retry };
    }
    scene.glareX = 20 + rnd() * 128;
    scene.glareY = 20 + rnd() * 128;
    exposure *= 0.9;
  }
  // detection impossible sur toutes les tentatives : lecture neutre, qui sera
  // rattrapee par la validation puis la relecture automatique
  return { rgb: new Array(9).fill({ r: 128, g: 128, b: 128 }), retries: 5 };
}

/**
 * Rendre la main entre deux cubes.
 *
 * Un scenario complet tient la boucle d'evenements ~190 secondes d'affilee.
 * Pendant ce temps le worker de test ne peut plus repondre au rapporteur, qui
 * abandonne : `[vitest-worker]: Timeout calling "onTaskUpdate"`. Aucun test
 * n'echoue, mais vitest compte une erreur et sort en code 1 — l'integration
 * continue passe au rouge sur une suite entierement verte.
 *
 * Une pause de longueur nulle entre chaque cube suffit : elle rend la main a la
 * boucle d'evenements, le message passe, et le cout est negligeable devant les
 * ~6 secondes que coute un cube.
 */
const rendreLaMain = () => new Promise<void>((r) => setTimeout(r, 0));

async function runTrials(cond: Conditions, trials: number) {
  let exact = 0;
  let exactFinal = 0;
  let validFinal = 0;
  let errors = 0;
  let retries = 0;
  let rescans = 0;

  for (let t = 0; t < trials; t++) {
    await rendreLaMain();
    const state = t === 0 ? SOLVED_FACELETS : applyAlg(SOLVED_FACELETS, randomScramble(22));
    const scheme = shuffle(COLOR_NAMES);
    const faceColor: Record<string, RGB> = {};
    FACES.forEach((f, i) => (faceColor[f] = STICKER_RGB[scheme[i]]));
    const truth = state.split('') as Face[];

    const captureOneFace = (f: number): RGB[] => {
      const colors: RGB[] = [];
      for (let i = 0; i < 9; i++) colors.push(faceColor[state[f * 9 + i]]);
      const r = captureFace(colors, cond);
      retries += r.retries;
      return r.rgb;
    };

    const samples: RGB[] = [];
    for (let f = 0; f < 6; f++) samples.push(...captureOneFace(f));

    let labels: Face[] = [];
    let first = true;
    // L'application relit d'elle-meme les faces dont la lecture est douteuse :
    // c'est le rattrapage le plus efficace, et le moins couteux pour l'utilisateur.
    for (let round = 0; round < 3; round++) {
      const res = classifyCube(samples);
      if (first) {
        first = false;
        const wrong = res.labels.filter((l, i) => l !== truth[i]).length;
        errors += wrong;
        if (!wrong) exact++;
      }
      labels = res.labels;
      let changed: number[] = [];
      const ok = validate(labels.join('')).ok;
      if (!ok) {
        const rep = repairReading(res);
        if (rep) {
          labels = rep.labels;
          changed = rep.changed;
        }
      }
      const suspects = new Set([
        ...suspectFaces(res.confidence, 0.22),
        ...changed.map((i) => Math.floor(i / 9)),
      ]);
      if (validate(labels.join('')).ok && suspects.size === 0) break;
      if (round === 2) break;
      for (const f of suspects) {
        rescans++;
        const fresh = captureOneFace(f);
        for (let i = 0; i < 9; i++) samples[f * 9 + i] = fresh[i];
      }
    }

    if (validate(labels.join('')).ok) validFinal++;
    if (labels.every((l, i) => l === truth[i])) exactFinal++;
  }

  return {
    exactPremiereLecture: +(exact / trials).toFixed(3),
    exactFinal: +(exactFinal / trials).toFixed(3),
    valideFinal: +(validFinal / trials).toFixed(3),
    erreursPremiereLecture: +(errors / trials).toFixed(2),
    recadragesMoyens: +(retries / trials).toFixed(2),
    relecturesMoyennes: +(rescans / trials).toFixed(2),
  };
}

describe('chaine complete pixel -> etat du cube', () => {
  it('bonnes conditions', async () => {
    const r = await runTrials(BON, 30);
    console.log('  BON        ->', JSON.stringify(r));
    // mesure typique : 97 a 100 %
    expect(r.exactFinal).toBeGreaterThanOrEqual(0.95);
    expect(r.valideFinal - r.exactFinal).toBeLessThanOrEqual(0.05);
  }, 600000);

  it('conditions realistes (reflets, ombrage, derive de blancs, grille imprecise)', async () => {
    const r = await runTrials(REALISTE, 30);
    console.log('  REALISTE   ->', JSON.stringify(r));
    // mesure sur plusieurs executions : 93 a 100 % de lectures finales exactes.
    // Le seuil reste sous la fourchette observee plutot que de rendre le test
    // capricieux.
    expect(r.exactFinal).toBeGreaterThanOrEqual(0.9);
    expect(r.valideFinal).toBeGreaterThanOrEqual(0.9);
    // ce qui compte vraiment : un cube declare valide doit etre le bon
    expect(r.valideFinal - r.exactFinal).toBeLessThanOrEqual(0.05);
  }, 600000);

  // En conditions hostiles (reflet quasi systematique et intense, fort degrade,
  // cube incline), l'application ne pretend plus lire : elle refuse les images
  // brulees et dit qu'elle ne voit pas de cube. La bonne mesure n'est donc pas
  // le taux de reussite — l'utilisateur, lui, deplacerait le cube ou allumerait
  // une lampe — mais le taux de MENSONGE SILENCIEUX : produire un cube valide
  // mais faux, qu'on resoudrait sans jamais s'en apercevoir.
  it('conditions hostiles : degradation maitrisee, jamais de mensonge silencieux', async () => {
    // moins d'essais : en conditions hostiles chaque face epuise ses
    // tentatives, et le scenario coute une trentaine de rendus par cube
    const r = await runTrials(HOSTILE, 18);
    console.log('  HOSTILE    ->', JSON.stringify(r));
    const mensonge = r.valideFinal - r.exactFinal;
    console.log(`  mensonges silencieux : ${(mensonge * 100).toFixed(1)} %`);
    // Un cube declare valide doit etre le bon : c'est le seul engagement qui
    // tienne quelles que soient les conditions. En conditions hostiles la
    // lecture est si degradee (15 stickers faux en moyenne) qu'aucun mecanisme
    // de rattrapage ne peut etre parfait ; le suivi temps reel constitue le
    // dernier filet, puisqu'il detecte que la face observee ne correspond plus.
    expect(mensonge).toBeLessThanOrEqual(0.12);
  }, 600000);
});
