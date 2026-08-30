import { describe, expect, it } from 'vitest';
import Cube from 'cubejs';
import { SOLVED_FACELETS, applyAlg, validate } from '../src/core/cube';
import { CORNER_COLORS, CORNER_FACELETS } from '../src/core/geometry';
import { findValidArrangement } from '../src/core/arrange';
import { SCAN_PLAN } from '../src/core/scanPlan';
import { FACES } from '../src/core/geometry';

/**
 * Un coin MIROIR : les trois bonnes couleurs, montees dans l'autre sens.
 *
 * `validate()` identifiait un coin par l'ENSEMBLE TRIE de ses couleurs, jamais
 * par leur ORDRE CYCLIQUE. Elle acceptait donc des cubes physiquement
 * impossibles — un coin ne peut pas exister dans les deux chiralites.
 *
 * Consequence mesuree, et vecue : le solveur part chercher une solution qui
 * n'existe pas, n'en trouve aucune en 22 secondes, abandonne au bout de 15 —
 * et l'utilisateur rescanne indefiniment sans jamais comprendre pourquoi.
 */
let graine = 424242;
const tirage = () => ((graine = (graine * 1664525 + 1013904223) % 4294967296), graine / 4294967296);
const MOUVEMENTS = ['U',"U'",'U2','R',"R'",'R2','F',"F'",'F2','D',"D'",'D2','L',"L'",'L2','B',"B'",'B2'];
const tourner = (f: string[], n: number) => {
  let r = f;
  for (let i = 0; i < n; i++) r = [6, 3, 0, 7, 4, 1, 8, 5, 2].map((j) => r[j]);
  return r;
};

/** Les trois couleurs d'un coin sont-elles une rotation cyclique du modele ? */
function chiraliteJuste(cols: readonly string[], modele: readonly string[]): boolean {
  for (let d = 0; d < 3; d++) {
    if (cols.every((c, i) => c === modele[(i + d) % 3])) return true;
  }
  return false;
}

/** Fabrique un coin miroir en echangeant deux facettes d'un coin. */
function coinMiroir(etat: string, slot: number): string {
  const [a, , c] = CORNER_FACELETS[slot];
  const t = [...etat];
  [t[a], t[c]] = [t[c], t[a]];
  return t.join('');
}

describe('chiralite des coins', () => {
  it('un coin monte a l envers est REFUSE', () => {
    const vrai = applyAlg(SOLVED_FACELETS, ['R', "U'", 'F2', 'L', 'D']);
    expect(validate(vrai).ok).toBe(true);
    for (let slot = 0; slot < 8; slot++) {
      const casse = coinMiroir(vrai, slot);
      const v = validate(casse);
      expect(`coin ${slot} : ${v.ok ? 'ACCEPTE' : 'refuse'}`).toBe(`coin ${slot} : refuse`);
    }
  });

  it('aucun cube reellement melange n est rejete', () => {
    // Le controle ne doit jamais couter un seul faux refus.
    for (let n = 0; n < 600; n++) {
      const etat = applyAlg(
        SOLVED_FACELETS,
        Array.from({ length: 15 }, () => MOUVEMENTS[Math.floor(tirage() * 18)]),
      );
      expect(validate(etat).ok).toBe(true);
    }
  });

  it('le placement ne rend plus jamais un cube a coin miroir', () => {
    let rendus = 0;
    for (let n = 0; n < 120; n++) {
      const vrai = applyAlg(
        SOLVED_FACELETS,
        Array.from({ length: 12 }, () => MOUVEMENTS[Math.floor(tirage() * 18)]),
      );
      let faces = SCAN_PLAN.map((s) => {
        const b = FACES.indexOf(s.face) * 9;
        return tourner(vrai.slice(b, b + 9).split(''), Math.floor(tirage() * 4));
      });
      const i = Math.floor(tirage() * 6);
      let j = Math.floor(tirage() * 6);
      if (j === i) j = (j + 1) % 6;
      faces = faces.slice();
      [faces[i], faces[j]] = [faces[j], faces[i]];

      const r = findValidArrangement(faces);
      if (!r) continue;
      rendus++;
      for (const [slot, fl] of CORNER_FACELETS.entries()) {
        const cols = fl.map((k) => r.facelets[k]);
        const modele = CORNER_COLORS.find((m) =>
          [...m].sort().join('') === [...cols].sort().join(''),
        );
        expect(modele).toBeDefined();
        expect(`coin ${slot} de l arrangement`).toBe(
          chiraliteJuste(cols, modele!) ? `coin ${slot} de l arrangement` : `coin ${slot} MIROIR`,
        );
      }
    }
    expect(rendus).toBeGreaterThan(80);
  });

  it('tout etat rendu est relu a l identique par le solveur', () => {
    // Le garde le moins cher et le plus sensible : si cubejs relit autre chose,
    // il resoudra un cube qui n'est pas celui qu'on lui a donne.
    for (let n = 0; n < 40; n++) {
      const vrai = applyAlg(
        SOLVED_FACELETS,
        Array.from({ length: 12 }, () => MOUVEMENTS[Math.floor(tirage() * 18)]),
      );
      const faces = SCAN_PLAN.map((s) => {
        const b = FACES.indexOf(s.face) * 9;
        return tourner(vrai.slice(b, b + 9).split(''), Math.floor(tirage() * 4));
      });
      const r = findValidArrangement(faces);
      if (!r) continue;
      expect(Cube.fromString(r.facelets).asString()).toBe(r.facelets);
    }
  });
});
