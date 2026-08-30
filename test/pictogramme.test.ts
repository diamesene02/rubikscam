import { describe, expect, it } from 'vitest';
import { SENS_COUCHE, type SensCouche } from '../src/core/consigne';
import { pictogramme } from '../src/ui/pictogramme';

/**
 * Le dessin porte la moitie de la consigne. S'il cessait de distinguer les
 * sens, l'utilisateur tournerait dans le mauvais sens sans qu'aucun test de
 * texte ne bronche.
 */
describe('le dessin de la consigne', () => {
  const SENS: SensCouche[] = ['gauche', 'droite', 'demi'];

  it('produit un dessin different pour chaque sens', () => {
    const dessins = SENS.map((s) => pictogramme(s, '#c8321f'));
    expect(new Set(dessins).size).toBe(3);
  });

  it('peint l etage du haut de la couleur demandee', () => {
    for (const s of SENS) {
      expect(pictogramme(s, '#149c4e')).toContain('fill="#149c4e"');
    }
  });

  it('dessine TROIS etages : c est ce qui dit que le reste ne bouge pas', () => {
    const svg = pictogramme('gauche', '#149c4e');
    // Trois etages de trois faces visibles chacun.
    expect((svg.match(/<polygon /g) ?? []).length).toBe(9);
    // Et seul celui du haut porte la couleur de la consigne.
    expect((svg.match(/fill="#149c4e"/g) ?? []).length).toBe(1);
  });

  it('le demi-tour a deux pointes, les quarts de tour une seule', () => {
    const pointes = (svg: string) => (svg.match(/stroke-linejoin="round"/g) ?? []).length;
    expect(pointes(pictogramme('demi', '#fff'))).toBe(2);
    expect(pointes(pictogramme('gauche', '#fff'))).toBe(1);
    expect(pointes(pictogramme('droite', '#fff'))).toBe(1);
  });

  it('gauche et droite sont bien des images miroir, pas le meme dessin', () => {
    const g = pictogramme('gauche', '#fff');
    const d = pictogramme('droite', '#fff');
    expect(g).not.toBe(d);
    // Le sens de parcours de l'arc differe : c'est LUI qui porte l'information.
    // Le sens de parcours de l'arc differe : c'est LUI qui porte l'information.
    expect(g).toMatch(/A \d+ \d+ 0 0 1/);
    expect(d).toMatch(/A \d+ \d+ 0 0 0/);
  });

  it('chaque sens de la table a son dessin', () => {
    for (const suffixe of Object.keys(SENS_COUCHE)) {
      const svg = pictogramme(SENS_COUCHE[suffixe].sens, '#888');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
    }
  });
});
