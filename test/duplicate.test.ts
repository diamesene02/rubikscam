import { describe, it, expect } from 'vitest';
import { maxCellDelta, maxCellDeltaNormalise, type CellSample } from '../src/media/sampler';
import { SOLVED_FACELETS, applyAlg, randomScramble } from '../src/core/cube';
import { SCAN_PLAN } from '../src/core/scanPlan';
import { visibleFace } from '../src/core/tracking';
import { linearToSrgb, sameStickerColor, toLinear, type RGB } from '../src/core/color';

/**
 * Verrou anti-doublon : l'application ne doit accepter une nouvelle face que
 * si l'image a vraiment change. Sans ce verrou elle enregistre plusieurs fois
 * la meme face, car une capture prend moins d'une seconde et l'utilisateur n'a
 * pas encore tourne le cube.
 */

const COULEURS: Record<string, RGB> = {
  U: { r: 240, g: 240, b: 236 },
  R: { r: 196, g: 32, b: 42 },
  F: { r: 22, g: 152, b: 78 },
  D: { r: 250, g: 208, b: 45 },
  L: { r: 236, g: 106, b: 26 },
  B: { r: 24, g: 74, b: 178 },
};

const SEUIL = 20;

function lire(etat: string, etape: number, eclairage = 1, bruit = 0): CellSample[] {
  const face = visibleFace(etat, SCAN_PLAN[etape].orientation);
  return face.split('').map((ch) => {
    const c = COULEURS[ch];
    const j = () => (Math.random() - 0.5) * bruit;
    return {
      rgb: {
        r: Math.min(255, c.r * eclairage + j()),
        g: Math.min(255, c.g * eclairage + j()),
        b: Math.min(255, c.b * eclairage + j()),
      },
      spread: 0.1,
      clipped: 0,
    };
  });
}

describe('verrou anti-doublon', () => {
  it('deux faces differentes sont toujours vues comme differentes', () => {
    for (let t = 0; t < 60; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      for (let a = 0; a < 6; a++) {
        for (let b = a + 1; b < 6; b++) {
          const d = maxCellDeltaNormalise(lire(etat, a), lire(etat, b));
          expect(d, `etapes ${a} et ${b}`).toBeGreaterThan(SEUIL);
        }
      }
    }
  });

  it('la meme face est reconnue comme deja vue, meme avec du bruit', () => {
    for (let t = 0; t < 60; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      for (let a = 0; a < 6; a++) {
        const d = maxCellDeltaNormalise(lire(etat, a, 1, 12), lire(etat, a, 1, 12));
        expect(d, `etape ${a}`).toBeLessThan(SEUIL);
      }
    }
  });

  it("la meme face reste reconnue meme si la lumiere a change entre-temps", () => {
    // C'est le cas qui piegeait la comparaison brute : l'utilisateur allume une
    // lampe ou se rapproche de la fenetre entre deux captures.
    let brutRate = 0;
    for (let t = 0; t < 60; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      for (let a = 0; a < 6; a++) {
        const sombre = lire(etat, a, 0.55, 6);
        const clair = lire(etat, a, 1.15, 6);
        expect(maxCellDeltaNormalise(sombre, clair), `etape ${a}`).toBeLessThan(SEUIL);
        if (maxCellDelta(sombre, clair) >= SEUIL) brutRate++;
      }
    }
    // et on verifie au passage que la comparaison brute, elle, se ferait piéger
    expect(brutRate).toBeGreaterThan(0);
  });
});

describe('centres en double (sameStickerColor)', () => {
  /**
   * Filet independant de toute la chaine de vision : il n'existe qu'un centre
   * de chaque couleur sur un cube. Une face dont le centre est deja enregistre
   * est refusee AVANT d'etre enregistree.
   */
  function eclairer(c: RGB, k: number): RGB {
    const l = toLinear(c);
    return linearToSrgb([l[0] * k, l[1] * k, l[2] * k]);
  }

  it('reconnait le meme centre sous une autre lumiere (plage realiste)', () => {
    for (const c of Object.values(COULEURS)) {
      for (const k of [0.35, 0.6, 0.85, 1.2]) {
        const vu = eclairer(c, k);
        // abstention legitime des qu'un canal sature, d'un cote ou de l'autre
        const sature = [c, vu].some((x) => x.r >= 249 || x.g >= 249 || x.b >= 249);
        if (!sature) expect(sameStickerColor(c, vu), JSON.stringify({ c, k })).toBe(true);
      }
    }
  });

  it('ne confond jamais deux couleurs differentes, meme eclairees differemment', () => {
    const noms = Object.keys(COULEURS);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        if (i === j) continue;
        for (const k of [0.4, 0.7, 1, 1.4]) {
          const a = COULEURS[noms[i]];
          const vu = eclairer(COULEURS[noms[j]], k);
          expect(sameStickerColor(a, vu), `${noms[i]} vs ${noms[j]} x${k}`).toBe(false);
        }
      }
    }
  });

  it("s'abstient quand un canal est sature : on ne peut rien affirmer", () => {
    // jaune canonique au canal rouge sature : compatible avec orange dans UN
    // sens seulement — la fonction doit s'abstenir, pas trancher
    const jauneSature: RGB = { r: 252, g: 208, b: 45 };
    const orange: RGB = { r: 236, g: 106, b: 26 };
    expect(sameStickerColor(jauneSature, orange)).toBe(false);
    expect(sameStickerColor(jauneSature, jauneSature)).toBe(false); // abstention aussi
  });
});

describe('rouge et orange en lumiere faible', () => {
  /**
   * Mesures relevees sur de vraies captures dans une piece mal eclairee. Elles
   * disent pourquoi le test des centres ne peut pas etre BLOQUANT : la marge
   * entre "meme couleur, deux eclairages" et "orange contre rouge" est mince,
   * et un faux positif empeche l'utilisateur d'enregistrer une face nouvelle.
   */
  const ORANGE_SOMBRE: RGB = { r: 109, g: 43, b: 9 };
  const ROUGE_SOMBRE: RGB = { r: 86, g: 14, b: 14 };
  const ORANGE_CLAIR: RGB = { r: 190, g: 75, b: 16 };
  const ROUGE_CLAIR: RGB = { r: 150, g: 25, b: 25 };
  const BLANC_SOMBRE: RGB = { r: 109, g: 97, b: 81 };
  const BLANC_CLAIR: RGB = { r: 200, g: 180, b: 150 };

  it('ne confond plus orange sombre et rouge sombre', () => {
    expect(sameStickerColor(ORANGE_SOMBRE, ROUGE_SOMBRE)).toBe(false);
    expect(sameStickerColor(ORANGE_CLAIR, ROUGE_CLAIR)).toBe(false);
  });

  it('reconnait toujours la meme couleur sous deux eclairages', () => {
    expect(sameStickerColor(ORANGE_SOMBRE, ORANGE_CLAIR)).toBe(true);
    expect(sameStickerColor(ROUGE_SOMBRE, ROUGE_CLAIR)).toBe(true);
    expect(sameStickerColor(BLANC_SOMBRE, BLANC_CLAIR)).toBe(true);
  });
});
