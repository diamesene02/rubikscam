import { describe, expect, it } from 'vitest';
import { classifyCube, type RGB } from '../src/core/color';
import { MESURES_SCAN_REUSSI } from './donnees/scan-reussi';

/**
 * Deuxieme scan reel, celui-la valide par l'utilisateur comme conforme a son
 * cube. Il complete `scanReel.test.ts` : l'un est une capture surexposee ou les
 * neuf blancs etaient brules, l'autre une capture normale. Les deux doivent
 * rester lues sans erreur.
 */

/** Etiquetage certain : sur ces mesures, les familles ne se recouvrent pas. */
function famille([r, g, b]: [number, number, number]): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 35) return 'blanc';
  if (b > r && b > g) return 'bleu';
  if (g > r) return 'vert';
  if (g > 170) return 'jaune';
  return g / r > 0.45 ? 'orange' : 'rouge';
}

describe('scan reel abouti', () => {
  const echantillons: RGB[] = MESURES_SCAN_REUSSI.map(([r, g, b]) => ({ r, g, b }));

  it('contient bien des blancs brules par l auto-exposition', () => {
    const brules = MESURES_SCAN_REUSSI.filter(
      ([r, g, b]) => r >= 249 && g >= 249 && b >= 249,
    );
    expect(brules.length).toBeGreaterThanOrEqual(5);
    for (const m of brules) expect(famille(m)).toBe('blanc');
  });

  it('classe les 54 stickers en six groupes d une seule couleur', () => {
    const resultat = classifyCube(echantillons);

    const composition = new Map<string, Set<string>>();
    for (const [i, etiquette] of resultat.labels.entries()) {
      const vues = composition.get(etiquette) ?? new Set<string>();
      vues.add(famille(MESURES_SCAN_REUSSI[i]));
      composition.set(etiquette, vues);
    }

    expect(composition.size).toBe(6);
    for (const [etiquette, couleurs] of composition) {
      expect(`${etiquette}: ${[...couleurs].join(',')}`).toBe(
        `${etiquette}: ${[...couleurs][0]}`,
      );
    }

    // Les six couleurs sont toutes representees, neuf fois chacune.
    const familles = MESURES_SCAN_REUSSI.map(famille);
    for (const c of ['blanc', 'bleu', 'vert', 'jaune', 'orange', 'rouge']) {
      expect(familles.filter((f) => f === c)).toHaveLength(9);
    }
  });
});
