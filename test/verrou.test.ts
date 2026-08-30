import { describe, expect, it } from 'vitest';
import { maxCellDeltaNormalise } from '../src/media/sampler';
import type { CellSample } from '../src/media/sampler';

/**
 * Le verrou anti-doublon repose sur une question simple : la vue a-t-elle
 * change depuis la derniere capture ? Ce test verifie que la mesure utilisee
 * separe franchement « meme face, un peu de bruit » de « face differente ».
 */
const SEUIL_LIBERATION = 34;

function face(couleurs: [number, number, number][], bruit = 0): CellSample[] {
  const borne = (v: number) => Math.max(0, Math.min(255, v));
  return couleurs.map(([r, g, b], i) => ({
    rgb: {
      r: borne(r + (i % 3) * bruit),
      g: borne(g + (i % 2) * bruit),
      b: borne(b - (i % 3) * bruit),
    },
    spread: 0,
    clipped: 0,
  }));
}

const BLANC: [number, number, number] = [235, 235, 232];
const ROUGE: [number, number, number] = [200, 60, 50];
const VERT: [number, number, number] = [40, 160, 90];
const BLEU: [number, number, number] = [40, 80, 200];

const FACE_A = face([BLANC, ROUGE, VERT, BLEU, BLANC, ROUGE, VERT, BLEU, BLANC]);
const FACE_B = face([VERT, VERT, BLEU, ROUGE, ROUGE, BLANC, BLEU, BLANC, ROUGE]);

describe('verrou : le cube doit avoir bouge entre deux captures', () => {
  it('la meme face, meme avec du bruit, ne libere pas le verrou', () => {
    for (const bruit of [0, 6, 12, 18]) {
      const bruitee = face([BLANC, ROUGE, VERT, BLEU, BLANC, ROUGE, VERT, BLEU, BLANC], bruit);
      expect(maxCellDeltaNormalise(FACE_A, bruitee)).toBeLessThan(SEUIL_LIBERATION);
    }
  });

  it('une face differente libere le verrou', () => {
    expect(maxCellDeltaNormalise(FACE_A, FACE_B)).toBeGreaterThanOrEqual(SEUIL_LIBERATION);
  });
});

/**
 * Le verrou exige DEUX preuves : un ecart de couleurs soutenu et de vraies
 * images de transition. Ce test rejoue la logique de liberation telle qu'elle
 * est ecrite dans l'application, y compris le cas ou le detecteur PERD la face
 * pendant la rotation — cas frequent, et seul chemin vers un blocage.
 */
const IMAGES_CHANGEMENT = 3;
const IMAGES_MOUVEMENT_REQUISES = 4;

function libere(images: { ecart: number; perdue?: boolean }[]): boolean {
  let changement = 0;
  let mouvement = 0;
  for (const img of images) {
    if (img.perdue) {
      mouvement++;
      continue;
    }
    if (img.ecart >= SEUIL_LIBERATION) changement++;
    else changement = 0;
    if (changement >= IMAGES_CHANGEMENT && mouvement >= IMAGES_MOUVEMENT_REQUISES) return true;
  }
  return false;
}

describe('liberation du verrou', () => {
  it('tenir la meme face immobile ne libere jamais', () => {
    expect(libere(Array.from({ length: 300 }, () => ({ ecart: 8 })))).toBe(false);
  });

  it('du bruit qui franchit le seuil, sans mouvement, ne libere pas', () => {
    expect(libere(Array.from({ length: 300 }, () => ({ ecart: 60 })))).toBe(false);
  });

  it('une rotation franche libere', () => {
    const rotation = [
      ...Array.from({ length: 8 }, () => ({ ecart: 90, perdue: false })),
      ...Array.from({ length: 5 }, () => ({ ecart: 90 })),
    ];
    // Les 8 premieres images de transition comptent comme mouvement.
    const avecMouvement = rotation.map((r, i) => (i < 8 ? { ecart: 0, perdue: true } : r));
    expect(libere(avecMouvement)).toBe(true);
  });

  it('une rotation pendant laquelle le detecteur PERD la face libere aussi', () => {
    expect(
      libere([
        ...Array.from({ length: 6 }, () => ({ ecart: 0, perdue: true })),
        ...Array.from({ length: 4 }, () => ({ ecart: 70 })),
      ]),
    ).toBe(true);
  });
});
