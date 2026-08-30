import { describe, it, expect } from 'vitest';
import { findValidArrangement } from '../src/core/arrange';
import { validate } from '../src/core/cube';
import { FACES_PHOTOGRAPHIEES } from './donnees/cube-reel';

/**
 * Verite terrain etablie sur le cube physique de l'utilisateur, photographie
 * face par face sous bonne lumiere. Ce test la valide : les six faces doivent
 * compter neuf stickers de chaque couleur ET former un cube geometriquement
 * possible. Une lecture erronee des photos n'aurait quasi aucune chance de
 * satisfaire les deux.
 *
 * C'est cette verite qui sert de reference pour juger ce que la camera lit.
 */
describe('cube reel photographie', () => {
  it('compte neuf stickers de chaque couleur', () => {
    const tout = FACES_PHOTOGRAPHIEES.flat();
    expect(tout.length).toBe(54);
    for (const c of ['N', 'J', 'R', 'O', 'V', 'B']) {
      expect(tout.filter((x) => x === c).length, c).toBe(9);
    }
  });

  it('forme un cube geometriquement possible', () => {
    const r = findValidArrangement(FACES_PHOTOGRAPHIEES);
    expect(r, 'aucun placement valide : la lecture des photos serait fausse').not.toBeNull();
    expect(validate(r!.facelets).ok).toBe(true);
  });
});
