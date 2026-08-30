import { describe, expect, it } from 'vitest';
import { FACES_PHOTOGRAPHIEES } from './donnees/cube-reel';
import { SCAN_PAR_FACE } from './donnees/scan-reel';
import { classifyCube, type RGB } from '../src/core/color';

/**
 * Verite terrain reelle : le cube physique de l'utilisateur, photographie face
 * par face (cube-reel.ts), puis scanne par sa webcam dans une piece sombre
 * (scan-reel.ts). La correspondance photo <-> face scannee a ete etablie par
 * recherche exhaustive sur les 6 photos x 4 rotations : elle est bijective et
 * ne laisse aucune ambiguite.
 *
 * Ce scan est un cas limite precieux : l'auto-exposition de la webcam brule
 * les neuf stickers blancs a (255,255,255). Sans les deux regles qui suivent,
 * le classifieur faisait 19 erreurs sur 54.
 *   1. une mesure saturee sur les trois canaux ne peut etre que du blanc ;
 *   2. la moyenne d'un groupe compte les canaux valides SEPAREMENT, sinon un
 *      groupe entierement sature recoit la reference (0,0,0).
 */
const ROTATIONS = (() => {
  const identite = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const quart = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  const compose = (a: number[], b: number[]) => a.map((_, i) => a[b[i]]);
  const demi = compose(quart, quart);
  return [identite, quart, demi, compose(demi, quart)];
})();

const CORRESPONDANCE = [
  { photo: 4, rotation: 1 },
  { photo: 5, rotation: 3 },
  { photo: 1, rotation: 0 },
  { photo: 3, rotation: 3 },
  { photo: 0, rotation: 3 },
  { photo: 2, rotation: 3 },
];

const verite: string[] = [];
const mesures: RGB[] = [];
for (let face = 0; face < 6; face++) {
  const { photo, rotation } = CORRESPONDANCE[face];
  const couleurs = ROTATIONS[rotation].map((i) => FACES_PHOTOGRAPHIEES[photo][i]);
  for (let i = 0; i < 9; i++) {
    verite.push(couleurs[i]);
    const [r, g, b] = SCAN_PAR_FACE[face][i];
    mesures.push({ r, g, b });
  }
}

describe('scan reel de la webcam de l utilisateur', () => {
  it('la verite terrain contient bien neuf stickers par couleur', () => {
    for (const couleur of ['N', 'J', 'R', 'O', 'V', 'B']) {
      expect(verite.filter((c) => c === couleur)).toHaveLength(9);
    }
  });

  it('les neuf blancs sont bel et bien brules par la camera', () => {
    const brules = mesures.filter((m) => m.r >= 249 && m.g >= 249 && m.b >= 249);
    expect(brules).toHaveLength(9);
    for (const [i, m] of mesures.entries()) {
      if (m.r >= 249 && m.g >= 249 && m.b >= 249) expect(verite[i]).toBe('N');
    }
  });

  it('classe les 54 stickers sans une seule erreur', () => {
    const resultat = classifyCube(mesures);

    const composition = new Map<string, Set<string>>();
    for (const [i, etiquette] of resultat.labels.entries()) {
      const vues = composition.get(etiquette) ?? new Set<string>();
      vues.add(verite[i]);
      composition.set(etiquette, vues);
    }

    // Six groupes, chacun d'une seule couleur reelle : c'est exactement le
    // critere qui compte, l'etiquette U/R/F/D/L/B n'etant qu'un nom arbitraire.
    expect(composition.size).toBe(6);
    for (const [etiquette, couleurs] of composition) {
      expect(`${etiquette}: ${[...couleurs].join(',')}`).toBe(`${etiquette}: ${[...couleurs][0]}`);
    }
  });
});

describe('la marge doit rester informative', () => {
  it('ne sature pas comme la confiance', () => {
    const resultat = classifyCube(mesures);

    // La confiance sature : elle vaut 1 partout sur ce scan, donc elle ne peut
    // designer aucune lecture limite. C'est ce qui rendait muet l'encadrement
    // des lectures douteuses.
    expect(Math.min(...resultat.confidence)).toBe(1);

    // La marge, elle, s'etale : c'est la grandeur exploitable.
    const min = Math.min(...resultat.marge);
    expect(min).toBeLessThan(0.6);
    expect(Math.max(...resultat.marge)).toBeGreaterThan(0.95);
  });

  it('les lectures les plus limites sont bien les rouge / orange / jaune', () => {
    const resultat = classifyCube(mesures);
    const classe = new Map<string, string>();
    for (const [i, etiquette] of resultat.labels.entries()) {
      if (!classe.has(etiquette)) classe.set(etiquette, verite[i]);
    }
    const limites = resultat.marge
      .map((m, i) => ({ m, couleur: verite[i] }))
      .sort((a, b) => a.m - b.m)
      .slice(0, 8);
    for (const l of limites) {
      expect(`${l.m.toFixed(2)} ${l.couleur}`).toMatch(/ [ROJ]$/);
    }
  });
});
