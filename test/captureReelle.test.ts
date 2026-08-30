import { describe, it, expect } from 'vitest';
import { classifyCube, type RGB } from '../src/core/color';
import { CAPTURE_REELLE, VERITE_REELLE } from './donnees/capture-reelle';
import { FACES } from '../src/core/geometry';

const echantillons: RGB[] = CAPTURE_REELLE.map(([r, g, b]) => ({ r, g, b }));

describe('capture reelle (webcam, piece sombre, canal rouge sature)', () => {
  it('la verite terrain compte bien 9 stickers de chaque couleur', () => {
    for (const c of ['B', 'V', 'R', 'O', 'J', 'N']) {
      expect(VERITE_REELLE.filter((x) => x === c).length, c).toBe(9);
    }
  });

  it('le classifieur retrouve la partition des couleurs', () => {
    const res = classifyCube(echantillons);
    // partition correcte = chaque lettre du classifieur correspond a une seule
    // couleur reelle, et reciproquement
    const versReel = new Map<string, string>();
    const erreurs: number[] = [];
    for (let i = 0; i < 54; i++) {
      const l = res.labels[i];
      if (!versReel.has(l)) versReel.set(l, VERITE_REELLE[i]);
      else if (versReel.get(l) !== VERITE_REELLE[i]) erreurs.push(i);
    }
    if (erreurs.length) {
      const detail = erreurs
        .slice(0, 12)
        .map((i) => `#${i} ${CAPTURE_REELLE[i].join(',')} vrai=${VERITE_REELLE[i]} lu=${res.labels[i]}`);
      console.log(`  ${erreurs.length} erreurs :\n   ` + detail.join('\n   '));
      console.log(
        '  references apprises : ' +
          FACES.map((f) => {
            const c = res.referenceRgb[f];
            return `${f}=${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)}`;
          }).join('  '),
      );
    }
    expect(erreurs.length, 'stickers mal groupes').toBe(0);
  });
});
