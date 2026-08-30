import { describe, it, expect } from 'vitest';
import {
  classifyCube,
  classifyFace,
  colorCost,
  channelMask,
  toLinear,
  linearToSrgb,
  CANONICAL_PALETTE,
  type RGB,
  type Lin,
} from '../src/core/color';
import { SOLVED_FACELETS, applyAlg, randomScramble } from '../src/core/cube';
import { FACES, type Face } from '../src/core/geometry';

/**
 * Tests unitaires de la mesure de couleur. Les chiffres de fiabilite bout en
 * bout (image -> etat du cube) sont dans pipeline.test.ts, qui fait tourner le
 * vrai echantillonneur sur de vraies images.
 */

const STICKERS: Record<string, RGB> = {
  blanc: { r: 236, g: 234, b: 228 },
  jaune: { r: 252, g: 214, b: 38 },
  rouge: { r: 198, g: 28, b: 44 },
  orange: { r: 238, g: 118, b: 22 },
  vert: { r: 0, g: 160, b: 74 },
  bleu: { r: 0, g: 68, b: 174 },
};
const NOMS = Object.keys(STICKERS);
const PLEIN: [boolean, boolean, boolean] = [true, true, true];

let seed = 24;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296);
function shuffle<T>(a: T[]): T[] {
  const o = a.slice();
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

describe('mesure de couleur', () => {
  it('le cout est nul pour la couleur identique et borne partout', () => {
    for (const a of NOMS) {
      const la = toLinear(STICKERS[a]);
      expect(colorCost(la, PLEIN, la)).toBeLessThan(1e-6);
      for (const b of NOMS) {
        const c = colorCost(la, PLEIN, toLinear(STICKERS[b]));
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(4); // borne : indispensable pour l'affectation globale
      }
    }
  });

  it('chaque couleur est plus proche d elle-meme que de toute autre', () => {
    for (const a of NOMS) {
      const la = toLinear(STICKERS[a]);
      const couts = NOMS.map((b) => colorCost(la, PLEIN, toLinear(STICKERS[b])));
      const meilleur = couts.indexOf(Math.min(...couts));
      expect(NOMS[meilleur], `${a}`).toBe(a);
    }
  });

  it('la mesure est insensible a la luminosite (ombre ou pleine lumiere)', () => {
    for (const nom of NOMS) {
      const base = toLinear(STICKERS[nom]);
      for (const k of [0.35, 0.6, 1.4]) {
        const sombre: Lin = [base[0] * k, base[1] * k, base[2] * k];
        const couts = NOMS.map((b) => colorCost(sombre, PLEIN, toLinear(STICKERS[b])));
        expect(NOMS[couts.indexOf(Math.min(...couts))], `${nom} x${k}`).toBe(nom);
      }
    }
  });

  it('un canal sature reste exploite comme une inegalite, pas jete', () => {
    // rouge sur-expose : le canal rouge sature, le vert et le bleu restent bas
    const rouge = { r: 255, g: 40, b: 58 };
    const couts = NOMS.map((b) => colorCost(toLinear(rouge), channelMask(rouge), toLinear(STICKERS[b])));
    const gagnant = NOMS[couts.indexOf(Math.min(...couts))];
    expect(['rouge', 'orange']).toContain(gagnant);
    // une reference sombre sur le canal sature doit etre fortement penalisee
    const coutBleu = colorCost(toLinear(rouge), channelMask(rouge), toLinear(STICKERS.bleu));
    expect(coutBleu).toBeGreaterThan(Math.min(...couts) * 5);
  });

  it('un voile blanc (reflet) ne transforme pas un rouge en orange', () => {
    const base = toLinear(STICKERS.rouge);
    const voile = 0.16;
    const avecReflet: Lin = [base[0] + voile, base[1] + voile, base[2] + voile];
    const couts = NOMS.map((b) => colorCost(avecReflet, PLEIN, toLinear(STICKERS[b])));
    expect(NOMS[couts.indexOf(Math.min(...couts))]).toBe('rouge');
  });

  it('la palette canonique est bien composee de 6 couleurs distinctes', () => {
    expect(CANONICAL_PALETTE.length).toBe(6);
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const c = colorCost(toLinear(CANONICAL_PALETTE[i]), PLEIN, toLinear(CANONICAL_PALETTE[j]));
        expect(c).toBeGreaterThan(0.02);
      }
    }
  });

  it('aller-retour lineaire / sRGB', () => {
    for (const nom of NOMS) {
      const r = linearToSrgb(toLinear(STICKERS[nom]));
      expect(Math.abs(r.r - STICKERS[nom].r)).toBeLessThan(1.5);
      expect(Math.abs(r.g - STICKERS[nom].g)).toBeLessThan(1.5);
      expect(Math.abs(r.b - STICKERS[nom].b)).toBeLessThan(1.5);
    }
  });
});

describe('classification des 54 stickers', () => {
  /** Capture propre : eclairage regulier, leger bruit, exposition par face. */
  function capturer(etat: string): { echantillons: RGB[]; verite: Face[] } {
    const schema = shuffle(NOMS);
    const parFace: Record<string, RGB> = {};
    FACES.forEach((f, i) => (parFace[f] = STICKERS[schema[i]]));
    const echantillons: RGB[] = [];
    for (let f = 0; f < 6; f++) {
      const tR = 0.96 + rnd() * 0.08;
      const tB = 0.96 + rnd() * 0.08;
      const brut: RGB[] = [];
      for (let i = 0; i < 9; i++) {
        const c = parFace[etat[f * 9 + i]];
        const ombre = 0.94 + ((i % 3) / 3) * 0.1;
        brut.push({ r: c.r * tR * ombre, g: c.g * ombre, b: c.b * tB * ombre });
      }
      // auto-exposition, comme une vraie camera — et comme le garantit la porte
      // anti-saturation de l'application, qui refuse les images brulees
      const pic = Math.max(...brut.flatMap((c) => [c.r, c.g, c.b]), 1);
      const k = (235 / pic) * (0.94 + rnd() * 0.12);
      for (const c of brut) {
        echantillons.push({
          r: Math.min(255, c.r * k + (rnd() - 0.5) * 4),
          g: Math.min(255, c.g * k + (rnd() - 0.5) * 4),
          b: Math.min(255, c.b * k + (rnd() - 0.5) * 4),
        });
      }
    }
    return { echantillons, verite: etat.split('') as Face[] };
  }

  it('lit sans erreur 100 cubes en conditions propres, quel que soit le schema de couleurs', () => {
    let exacts = 0;
    for (let t = 0; t < 100; t++) {
      const etat = t === 0 ? SOLVED_FACELETS : applyAlg(SOLVED_FACELETS, randomScramble(22));
      const { echantillons, verite } = capturer(etat);
      const res = classifyCube(echantillons);
      if (res.labels.every((l, i) => l === verite[i])) exacts++;
    }
    expect(exacts).toBe(100);
  });

  it('les centres servent d ancres : ils ne sont jamais reaffectes', () => {
    const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
    const { echantillons } = capturer(etat);
    const res = classifyCube(echantillons);
    for (let f = 0; f < 6; f++) expect(res.labels[f * 9 + 4]).toBe(FACES[f]);
  });

  it('exactement 9 stickers par couleur, par construction', () => {
    const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
    const { echantillons } = capturer(etat);
    const res = classifyCube(echantillons);
    for (const f of FACES) {
      expect(res.labels.filter((l) => l === f).length, f).toBe(9);
    }
  });

  it('la lecture image par image retrouve les faces avec les references apprises', () => {
    // classifyFace est un estimateur IMAGE PAR IMAGE : il n'a ni la contrainte
    // globale "9 par couleur" ni les 6 faces pour caler l'eclairage. On exige
    // donc une tres haute exactitude au sticker, pas la perfection absolue —
    // le suivi temps reel, lui, tolere un sticker faux sur neuf (voir
    // tracking.test.ts, "tolere une lecture bruitee").
    let total = 0;
    let justes = 0;
    for (let t = 0; t < 20; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      const { echantillons, verite } = capturer(etat);
      const res = classifyCube(echantillons);
      expect(res.labels.every((l, i) => l === verite[i])).toBe(true);
      for (let f = 0; f < 6; f++) {
        const face = echantillons.slice(f * 9, f * 9 + 9);
        const live = classifyFace(face, res.referenceLin);
        for (let i = 0; i < 9; i++) {
          total++;
          if (live.labels[i] === verite[f * 9 + i]) justes++;
        }
      }
    }
    expect(justes / total).toBeGreaterThanOrEqual(0.99);
  });
});

describe('lecture image par image pendant la resolution', () => {
  /** La face vue pendant la resolution n'est pas eclairee comme au scan. */
  function relire(couleurs: RGB[], gainR: number, gainB: number, expo: number): RGB[] {
    return couleurs.map((c) => ({
      r: Math.min(255, c.r * expo * gainR),
      g: Math.min(255, c.g * expo),
      b: Math.min(255, c.b * expo * gainB),
    }));
  }

  it('retrouve la face malgre un eclairage different de celui du scan', () => {
    const schema = shuffle(NOMS);
    const parFace: Record<string, RGB> = {};
    FACES.forEach((f, i) => (parFace[f] = STICKERS[schema[i]]));
    const references = {} as Record<Face, Lin>;
    FACES.forEach((f) => (references[f] = toLinear(parFace[f])));

    let total = 0;
    let justes = 0;
    for (let t = 0; t < 60; t++) {
      const face: Face[] = [];
      const couleurs: RGB[] = [];
      for (let i = 0; i < 9; i++) {
        const f = FACES[Math.floor(rnd() * 6)];
        face.push(f);
        couleurs.push(parFace[f]);
      }
      const vu = relire(
        couleurs,
        0.85 + rnd() * 0.3,
        0.85 + rnd() * 0.3,
        0.6 + rnd() * 0.7,
      );
      const lu = classifyFace(vu, references);
      total += 9;
      justes += lu.labels.filter((l, i) => l === face[i]).length;
    }
    const taux = justes / total;
    console.log(`  stickers justes en lecture directe : ${(taux * 100).toFixed(1)} %`);
    expect(taux).toBeGreaterThanOrEqual(0.97);
  });
});

describe('couleurs affichees', () => {
  /**
   * Le patron de verification doit montrer des couleurs FRANCHES. Dans une
   * lumiere faible, les mesures sortent delavees (vert sauge, mint pale,
   * saumon) et l'utilisateur ne peut plus verifier son cube a l'oeil : il voit
   * de la boue et conclut, a juste titre, que la lecture est fausse.
   */
  it('associe a chaque groupe une vraie couleur de cube, meme en lumiere faible', () => {
    const canoniques = CANONICAL_PALETTE.map((c) => `${c.r},${c.g},${c.b}`);

    for (let t = 0; t < 40; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(22));
      const { echantillons } = capturerSombre(etat);
      const res = classifyCube(echantillons);
      const affichees = FACES.map((f) => res.paletteRgb[f]);
      // six couleurs de cube distinctes, toutes franches
      const uniques = new Set(affichees.map((c) => `${c.r},${c.g},${c.b}`));
      expect(uniques.size, 'six couleurs distinctes').toBe(6);
      for (const c of affichees) {
        // chaque couleur affichee est EXACTEMENT une couleur de cube
        expect(canoniques).toContain(`${c.r},${c.g},${c.b}`);
      }
    }
  });
});

/** Capture volontairement sombre et chaude : la lumiere d'un salon le soir. */
function capturerSombre(etat: string): { echantillons: RGB[] } {
  const schema = shuffle(NOMS);
  const parFace: Record<string, RGB> = {};
  FACES.forEach((f, i) => (parFace[f] = STICKERS[schema[i]]));
  const echantillons: RGB[] = [];
  for (let f = 0; f < 6; f++) {
    const k = 0.28 + rnd() * 0.2; // tres sombre
    const chaud = 1.12;
    const froid = 0.85;
    for (let i = 0; i < 9; i++) {
      const c = parFace[etat[f * 9 + i]];
      echantillons.push({
        r: Math.min(255, c.r * k * chaud + (rnd() - 0.5) * 6),
        g: Math.min(255, c.g * k + (rnd() - 0.5) * 6),
        b: Math.min(255, c.b * k * froid + (rnd() - 0.5) * 6),
      });
    }
  }
  return { echantillons };
}
