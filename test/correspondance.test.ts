import { describe, expect, it } from 'vitest';
import { SOLVED_FACELETS, applyAlg } from '../src/core/cube';
import { meilleureCorrespondanceFace } from '../src/core/tracking';

/**
 * Ce diagnostic separe les deux causes d'un « cube non reconnu » : une face
 * mal situee (angle, lumiere) et un etat memorise qui ne decrit pas ce cube du
 * tout. Sans lui, l'application accuse la lumiere alors que le scan etait faux
 * — et l'utilisateur suit 22 mouvements pour rien.
 */
describe('la face lue existe-t-elle dans l etat memorise ?', () => {
  const melange = applyAlg(SOLVED_FACELETS, ["R", "U2", "F'", "L", "D", "B'", "R2", "U"]);

  it('reconnait chaque face du cube, dans ses quatre rotations', () => {
    for (let f = 0; f < 6; f++) {
      const face = melange.slice(f * 9, f * 9 + 9).split('');
      const rotations = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8],
        [2, 5, 8, 1, 4, 7, 0, 3, 6],
        [8, 7, 6, 5, 4, 3, 2, 1, 0],
        [6, 3, 0, 7, 4, 1, 8, 5, 2],
      ];
      for (const r of rotations) {
        const tournee = r.map((i) => face[i]);
        expect(meilleureCorrespondanceFace(tournee, melange).score).toBe(9);
      }
    }
  });

  it('tolere une lecture avec un sticker faux', () => {
    const face = melange.slice(0, 9).split('');
    face[3] = face[3] === 'U' ? 'D' : 'U';
    expect(meilleureCorrespondanceFace(face, melange).score).toBeGreaterThanOrEqual(8);
  });

  it('rejette franchement une face qui n appartient pas au cube', () => {
    // Une face impossible : neuf stickers d'une couleur absente de toute face.
    const impossible = ['U', 'U', 'U', 'R', 'R', 'R', 'F', 'F', 'F'];
    const m = meilleureCorrespondanceFace(impossible, melange);
    expect(m.score).toBeLessThanOrEqual(6);
  });

  it('un cube memorise FAUX ne reconnait pas une vraie face', () => {
    // L'etat memorise decrit un autre cube : aucune face ne concorde bien.
    const autre = applyAlg(SOLVED_FACELETS, ['L2', 'D', 'B', "R'", 'U2', 'F']);
    let pire = 9;
    for (let f = 0; f < 6; f++) {
      const vraie = melange.slice(f * 9, f * 9 + 9).split('');
      pire = Math.min(pire, meilleureCorrespondanceFace(vraie, autre).score);
    }
    expect(pire).toBeLessThanOrEqual(6);
  });
});
