import { describe, expect, it } from 'vitest';
import { assessFace, type CellSample } from '../src/media/sampler';
import { SOLVED_FACELETS, applyAlg } from '../src/core/cube';
import { SolveSession } from '../src/core/tracking';
import { IDENTITY_ORIENTATION, type Face } from '../src/core/geometry';

/**
 * Pendant la resolution, une image inexploitable ne doit pas alimenter le
 * suivi : elle produit des etiquettes quelconques, et le suivi peut les
 * interpreter comme un « mouvement different » — puis recalculer la solution,
 * detruisant un etat pourtant correct.
 */
function cellule(rgb: [number, number, number], spread = 0.1, clipped = 0): CellSample {
  return { rgb: { r: rgb[0], g: rgb[1], b: rgb[2] }, spread, clipped };
}

describe('qualite d image pendant la resolution', () => {
  it('accepte une face nette et bien eclairee', () => {
    const face = [
      [240, 240, 238], [190, 34, 40], [22, 152, 78],
      [250, 208, 45], [240, 106, 26], [24, 74, 178],
      [240, 240, 238], [190, 34, 40], [22, 152, 78],
    ].map((c) => cellule(c as [number, number, number]));
    expect(assessFace(face).ok).toBe(true);
  });

  it('refuse une image trop sombre, et le dit', () => {
    const face = Array.from({ length: 9 }, () => cellule([28, 30, 26]));
    const q = assessFace(face);
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/sombre/i);
  });

  it('refuse une grille posee sur autre chose que le cube', () => {
    // Cases non uniformes : c'est la signature d'une grille qui deborde sur la
    // main ou le fond, exactement le cas ou le suivi doit se taire.
    const face = Array.from({ length: 9 }, () => cellule([150, 120, 110], 0.8));
    const q = assessFace(face);
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/cadre/i);
  });

  it('une lecture quelconque PEUT declencher un recalcul : le garde-fou est justifie', () => {
    const cube = applyAlg(SOLVED_FACELETS, ['R', "U'", 'F2', 'L', 'D', "B'"]);
    let graine = 4242;
    const tirage = () => ((graine = (graine * 1664525 + 1013904223) % 4294967296), graine / 4294967296);
    const LETTRES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];

    let recalculs = 0;
    for (let n = 0; n < 400; n++) {
      const session = new SolveSession(cube, ['U', 'R', "F'"], IDENTITY_ORIENTATION);
      // Deux images identiques : c'est ce que demande le suivi pour conclure.
      const bruit = Array.from({ length: 9 }, () => LETTRES[Math.floor(tirage() * 6)]);
      const confiance = new Array(9).fill(0.9);
      session.observe({ labels: bruit, confidence: confiance });
      const e = session.observe({ labels: bruit, confidence: confiance });
      if (e.kind === 'ecart') recalculs++;
    }
    // Meme rare, le risque est reel : c'est pour cela qu'on ne nourrit pas le
    // suivi avec une image que la mesure de qualite a deja rejetee.
    expect(recalculs).toBeGreaterThan(0);
  });

  it('en LECTURE SEULE, aucune image ne peut plus reecrire l etat', () => {
    // Le meme deluge de lectures quelconques, avec la camera privee du droit
    // d'expliquer l'image par un mouvement imprevu. C'est le mode utilise par
    // l'application depuis que la mesure a montre que 13,4 % des etapes
    // produisaient un faux « ecart » avec une camera pourtant parfaite.
    const cube = applyAlg(SOLVED_FACELETS, ['R', "U'", 'F2', 'L', 'D', "B'"]);
    let graine = 4242;
    const tirage = () => ((graine = (graine * 1664525 + 1013904223) % 4294967296), graine / 4294967296);
    const LETTRES: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];

    let ecarts = 0;
    for (let n = 0; n < 400; n++) {
      const session = new SolveSession(cube, ['U', 'R', "F'"], IDENTITY_ORIENTATION, {
        allowDeviation: false,
      });
      const bruit = Array.from({ length: 9 }, () => LETTRES[Math.floor(tirage() * 6)]);
      const confiance = new Array(9).fill(0.9);
      session.observe({ labels: bruit, confidence: confiance });
      const e = session.observe({ labels: bruit, confidence: confiance });
      if (e.kind === 'ecart') ecarts++;
      // Et l'etat memorise n'a pas bouge d'un sticker.
      expect(session.cube).toBe(cube);
    }
    expect(ecarts).toBe(0);
  });
});
