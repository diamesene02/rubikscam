import { describe, expect, it } from 'vitest';
import { SOLVED_FACELETS } from '../src/core/cube';
import {
  MOVES,
  ORIENTATIONS,
  applyPermStr,
  invertAlg,
  permOf,
  permOfAlg,
} from '../src/core/geometry';
import {
  GESTES,
  NOMS_COULEUR,
  SENS_COUCHE,
  consignePour,
  motPosition,
  prochainePrise,
} from '../src/core/consigne';
import { CANONICAL_PALETTE } from '../src/core/color';

/**
 * La consigne donnee a l'utilisateur tient en deux temps :
 *
 *   1. « Mets le ROUGE en haut »
 *   2. « La rangee la plus proche de toi part vers ta GAUCHE »
 *
 * Toute sa valeur tient a une propriete : elle est vraie QUELLE QUE SOIT la
 * facon dont l'utilisateur tient son cube. Ce fichier le demontre plutot que
 * de l'affirmer — c'est precisement le genre de libelle qui, dans ce projet,
 * s'est deja revele faux a 180 degres.
 */
describe('la consigne en deux temps', () => {
  it('amener la couleur en haut puis tourner la couche du haut EST le mouvement', () => {
    let verifies = 0;
    for (const move of MOVES) {
      const suffixe = move.slice(1);
      // Les quatre prises qui amenent la face du mouvement en position haute.
      const prises = ORIENTATIONS.filter((o) => o.faceMapInv.U === move[0]);
      expect(prises).toHaveLength(4);
      for (const o of prises) {
        // On oriente, on tourne la couche du haut, on defait l'orientation.
        const conjugue = permOfAlg([...o.word, `U${suffixe}`, ...invertAlg(o.word)]);
        expect(`${move} via ${o.word.join(' ') || 'identite'}`).toBe(
          conjugue.join(',') === permOf(move).join(',')
            ? `${move} via ${o.word.join(' ') || 'identite'}`
            : `${move} — CONJUGAISON FAUSSE`,
        );
        verifies++;
      }
    }
    expect(verifies).toBe(72);
  });

  it("l'ordre de la conjugaison compte : l'ecrire a l'envers doit echouer", () => {
    // Garde-fou : sans lui, on pourrait inverser la conjugaison sans que le
    // test precedent ne bronche, et la consigne deviendrait fausse une fois
    // sur deux sans que rien ne le signale.
    let justes = 0;
    for (const move of MOVES) {
      const suffixe = move.slice(1);
      for (const o of ORIENTATIONS.filter((x) => x.faceMapInv.U === move[0])) {
        const envers = permOfAlg([...invertAlg(o.word), `U${suffixe}`, ...o.word]);
        if (envers.join(',') === permOf(move).join(',')) justes++;
      }
    }
    expect(justes).toBeLessThan(72);
  });

  it('« la rangee proche part vers la gauche » decrit bien un quart de tour horaire', () => {
    // Facettes de U : 0 1 2 / 3 4 5 / 6 7 8, l'utilisateur etant devant la
    // rangee 6 7 8. Apres U, cette rangee doit occuper la colonne de gauche.
    const apresU = applyPermStr(SOLVED_FACELETS, permOf('U'));
    const temoin = [...SOLVED_FACELETS];
    for (const [i, c] of [...'abcdefghi'].entries()) temoin[i] = c;
    const marque = applyPermStr(temoin.join(''), permOf('U'));
    expect([marque[0], marque[3], marque[6]].join('')).toBe('ghi');
    // ... et vers la droite pour le sens inverse. La colonne s'y lit a
    // l'envers : une rotation d'un quart de tour retourne la rangee. Ce qui
    // compte pour la consigne, c'est le COTE ou elle atterrit.
    const marqueInv = applyPermStr(temoin.join(''), permOf("U'"));
    expect([marqueInv[2], marqueInv[5], marqueInv[8]].join('')).toBe('ihg');
    // Et surtout : la rangee proche n'est plus du tout dans la colonne opposee.
    expect([marque[2], marque[5], marque[8]].join('')).not.toMatch(/[ghi]/);
    expect([marqueInv[0], marqueInv[3], marqueInv[6]].join('')).not.toMatch(/[ghi]/);
    expect(apresU).not.toBe(SOLVED_FACELETS);
  });

  it('un demi-tour ne parle JAMAIS de gauche ni de droite', () => {
    // Mesure sur des solutions reelles : 49,2 % des mouvements sont des
    // demi-tours. Leur donner un sens serait une information fausse.
    expect(SENS_COUCHE['2'].sens).toBe('demi');
    expect(SENS_COUCHE['2'].geste.toLowerCase()).not.toMatch(/gauche|droite/);
    for (const suffixe of ['', "'"]) {
      expect(SENS_COUCHE[suffixe].geste.toLowerCase()).toMatch(/gauche|droite/);
    }
  });

  it('nomme les couleurs dans l ordre de la palette canonique', () => {
    expect(NOMS_COULEUR).toHaveLength(CANONICAL_PALETTE.length);
    expect(NOMS_COULEUR).toEqual(['blanc', 'jaune', 'rouge', 'orange', 'vert', 'bleu']);
  });

  it('produit une consigne complete et coherente pour chaque mouvement', () => {
    const couleurs = { U: '#fff', R: '#f00', F: '#0f0', D: '#ff0', L: '#f80', B: '#00f' };
    const noms = { U: 'blanc', R: 'rouge', F: 'vert', D: 'jaune', L: 'orange', B: 'bleu' };
    for (const move of MOVES) {
      const c = consignePour(move, couleurs, noms);
      expect(c.face).toBe(move[0]);
      expect(c.notation).toBe(move);
      expect(c.couleur).toBe(couleurs[move[0] as keyof typeof couleurs]);
      // Le titre nomme la couleur, jamais la face.
      expect(c.titre.toLowerCase()).toContain(noms[move[0] as keyof typeof noms]);
      expect(c.titre.toLowerCase()).not.toMatch(/face (du|de|avant|arriere)/);
      expect(c.geste.length).toBeGreaterThan(10);
    }
  });
});

describe('le geste de la face DEVANT', () => {
  it('amener la couleur devant puis tourner cette face EST le mouvement', () => {
    // Meme theoreme que pour le dessus, pour les quatre prises qui amenent la
    // face du mouvement devant l'utilisateur.
    let verifies = 0;
    for (const move of MOVES) {
      const suffixe = move.slice(1);
      const prises = ORIENTATIONS.filter((o) => o.faceMapInv.F === move[0]);
      expect(prises).toHaveLength(4);
      for (const o of prises) {
        const conjugue = permOfAlg([...o.word, `F${suffixe}`, ...invertAlg(o.word)]);
        expect(`${move} via ${o.word.join(' ') || 'identite'}`).toBe(
          conjugue.join(',') === permOf(move).join(',')
            ? `${move} via ${o.word.join(' ') || 'identite'}`
            : `${move} — CONJUGAISON FAUSSE`,
        );
        verifies++;
      }
    }
    expect(verifies).toBe(72);
  });

  it('« la rangee du haut part a droite » decrit bien un quart de tour horaire', () => {
    // Facettes de F : 0 1 2 en haut. Apres F, cette rangee occupe la colonne
    // de droite ; apres F', celle de gauche.
    const temoin = [...SOLVED_FACELETS];
    for (const [i, c] of [...'abcdefghi'].entries()) temoin[18 + i] = c;
    const t = temoin.join('');
    const f = applyPermStr(t, permOf('F')).slice(18, 27);
    expect([f[2], f[5], f[8]].join('')).toMatch(/[abc]/);
    expect([f[0], f[3], f[6]].join('')).not.toMatch(/[abc]/);
    const fp = applyPermStr(t, permOf("F'")).slice(18, 27);
    expect([fp[0], fp[3], fp[6]].join('')).toMatch(/[abc]/);
    expect([fp[2], fp[5], fp[8]].join('')).not.toMatch(/[abc]/);
  });

  it('les deux positions nomment une rangee, jamais « tourne vers la gauche »', () => {
    for (const position of ['dessus', 'devant'] as const) {
      for (const suffixe of ['', "'"]) {
        const g = GESTES[position][suffixe].geste;
        expect(g.toLowerCase()).toMatch(/rang[ée]e/);
        expect(g.toLowerCase()).toMatch(/gauche|droite/);
      }
      // Et le demi-tour compte DEUX quarts, sans jamais donner de sens.
      const demi = GESTES[position]['2'].geste;
      expect(demi).toMatch(/DEUX quarts/);
      expect(demi.toLowerCase()).not.toMatch(/gauche|droite/);
    }
  });

  it('dessus et devant ne donnent PAS le meme sens pour le meme suffixe', () => {
    // Un quart horaire vu d'en haut et vu de face n'envoient pas la rangee du
    // meme cote : confondre les deux inverserait la moitie des mouvements.
    expect(GESTES.dessus[''].sens).not.toBe(GESTES.devant[''].sens);
    expect(GESTES.dessus["'"].sens).not.toBe(GESTES.devant["'"].sens);
  });
  /**
   * Le bandeau et le geste doivent designer la MEME face.
   *
   * Observe en direct : le bandeau annoncait « bleu face a toi » pendant que le
   * geste demandait deux quarts « a l'etage du haut ». Les deux phrases sortent
   * de la meme `Consigne`, donc la contradiction ne peut venir que d'un mot
   * ecrit en double. On les confronte ici pour toutes les prises et tous les
   * mouvements — 24 x 18 cas — au lieu de s'en remettre a une inspection.
   */
  it('le mot du bandeau et le geste designent la meme face', () => {
    // La couleur n'entre pas dans cette propriete : seuls les MOTS comptent.
    const couleurs: Record<string, string> = Object.fromEntries(
      ['U', 'R', 'F', 'D', 'L', 'B'].map((f) => [f, '#888888']),
    );
    const noms: Record<string, string> = Object.fromEntries(
      ['U', 'R', 'F', 'D', 'L', 'B'].map((f, i) => [f, NOMS_COULEUR[i]]),
    );
    let devant = 0;
    let dessus = 0;
    for (const prise of ORIENTATIONS) {
      for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
        for (const suffixe of ['', "'", '2']) {
          const move = face + suffixe;
          const { position } = prochainePrise(prise, move);
          const c = consignePour(move, couleurs, noms, position);
          const parleDuDevant = /face devant toi/i.test(c.geste);
          const parleDuDessus = /\u00e9tage du haut/i.test(c.geste);
          // Un geste designe une face et une seule.
          expect(parleDuDevant).not.toBe(parleDuDessus);
          expect(motPosition(c.position) === 'face a toi').toBe(parleDuDevant);
          if (parleDuDevant) devant++;
          else dessus++;
        }
      }
    }
    // Les deux cas existent vraiment : sans cela le test ne prouverait rien.
    expect(devant).toBeGreaterThan(0);
    expect(dessus).toBeGreaterThan(0);
  });
});
