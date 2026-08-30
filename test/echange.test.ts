import { describe, expect, it } from 'vitest';
import {
  SOLVED_FACELETS,
  applyAlg,
  echangerFaces,
  tournerFace,
  validate,
} from '../src/core/cube';
import { FACES } from '../src/core/geometry';

/**
 * Quand une face a ete rangee au mauvais endroit pendant le scan, l'utilisateur
 * doit pouvoir la remettre. Changer la COULEUR d'un centre creerait deux
 * centres identiques — un cube impossible, et une impasse. L'echange de deux
 * faces, lui, preserve toujours ce qui doit l'etre.
 */
describe('echanger deux faces dans une lecture', () => {
  const melange = applyAlg(SOLVED_FACELETS, ['R', "U'", 'F2', 'L', 'D', "B'"]);

  it('remet exactement en place une lecture dont deux faces sont interverties', () => {
    for (let a = 0; a < 6; a++) {
      for (let b = a + 1; b < 6; b++) {
        const casse = echangerFaces(melange, a, b);
        expect(echangerFaces(casse, a, b)).toBe(melange);
      }
    }
  });

  it('laisse toujours six centres distincts', () => {
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        const centres = new Set(
          Array.from({ length: 6 }, (_, f) => echangerFaces(melange, a, b)[f * 9 + 4]),
        );
        expect(centres.size).toBe(6);
      }
    }
  });

  it('ne cree ni ne detruit aucun sticker', () => {
    const compter = (s: string) =>
      FACES.map((f) => [...s].filter((c) => c === f).length).join(',');
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) {
        expect(compter(echangerFaces(melange, a, b))).toBe(compter(melange));
      }
    }
  });

  it('un echange qui remet le cube en ordre le rend valide', () => {
    const casse = echangerFaces(melange, 1, 4);
    expect(validate(casse).ok).toBe(false);
    expect(validate(echangerFaces(casse, 1, 4)).ok).toBe(true);
  });
});

describe('tourner une face de la lecture', () => {
  const melange = applyAlg(SOLVED_FACELETS, ['R', "U'", 'F2', 'L', 'D', "B'"]);

  it('quatre quarts de tour ramenent la face a son etat initial', () => {
    for (let f = 0; f < 6; f++) {
      let etat = melange;
      for (let i = 0; i < 4; i++) etat = tournerFace(etat, f);
      expect(etat).toBe(melange);
    }
  });

  it('ne touche QUE la face concernee', () => {
    for (let f = 0; f < 6; f++) {
      const tourne = tournerFace(melange, f);
      for (let g = 0; g < 6; g++) {
        const avant = melange.slice(g * 9, g * 9 + 9);
        const apres = tourne.slice(g * 9, g * 9 + 9);
        if (g === f) continue;
        expect(`face ${g} : ${apres}`).toBe(`face ${g} : ${avant}`);
      }
    }
  });

  it('laisse le centre en place et conserve les neuf couleurs', () => {
    for (let f = 0; f < 6; f++) {
      const tourne = tournerFace(melange, f);
      expect(tourne[f * 9 + 4]).toBe(melange[f * 9 + 4]);
      const trier = (s: string) => [...s].sort().join('');
      expect(trier(tourne.slice(f * 9, f * 9 + 9))).toBe(trier(melange.slice(f * 9, f * 9 + 9)));
    }
  });

  it('redresse une face enregistree de travers', () => {
    // Le cas reel : le scan a enregistre une face pivotee d'un quart de tour.
    const deTravers = tournerFace(melange, 2, 1);
    expect(deTravers).not.toBe(melange);
    expect(tournerFace(deTravers, 2, 3)).toBe(melange);
  });
});
