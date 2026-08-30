import { describe, expect, it } from 'vitest';
import {
  FACES,
  FACE_NORMAL,
  MOVES,
  ORIENTATIONS,
  applyPermStr,
  type Face,
} from '../src/core/geometry';
import { SOLVED_FACELETS, applyAlg } from '../src/core/cube';
import { appliquer, matriceOrientation, matriceVue, multiplier } from '../src/ui/cube3d';

/**
 * Le cube affiche pendant la resolution doit etre dans la MEME orientation que
 * celui que l'utilisateur tient — face de devant ET rotation dans le plan.
 *
 * `faceCamera` ne reglait que la face de devant : le cube montrait alors les
 * bonnes couleurs, tournees d'un quart de tour. Impossible a comparer d'un
 * coup d'oeil, et c'est exactement ce qu'un utilisateur signale comme « il a
 * applique une rotation ».
 */
const normaleCss = (f: Face): number[] => {
  const n = FACE_NORMAL[f];
  return [n[0], -n[1], n[2]];
};

const proche = (a: readonly number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

describe('orientation du cube affiche', () => {
  it('place chaque face a la position que l orientation lui donne', () => {
    for (const o of ORIENTATIONS) {
      const m = matriceOrientation(o);
      for (const f of FACES) {
        expect(
          `${f} -> ${proche(appliquer(m, normaleCss(f)), normaleCss(o.faceMap[f])) ? o.faceMap[f] : '?'}`,
        ).toBe(`${f} -> ${o.faceMap[f]}`);
      }
    }
  });

  it('montre bien a la camera la face que l orientation amene devant', () => {
    for (const o of ORIENTATIONS) {
      const vue = multiplier(matriceVue(-26, -18), matriceOrientation(o));
      let devant: Face = 'F';
      let max = -Infinity;
      for (const f of FACES) {
        const z = appliquer(vue, normaleCss(f))[2];
        if (z > max) {
          max = z;
          devant = f;
        }
      }
      expect(devant).toBe(o.faceMapInv.F);
      expect(max).toBeGreaterThan(0.8);
    }
  });

  it('les 24 orientations donnent 24 rendus distincts', () => {
    // Si deux orientations produisaient la meme matrice, l'affichage perdrait
    // l'information de rotation dans le plan — precisement le defaut corrige.
    const vues = new Set(
      ORIENTATIONS.map((o) => matriceOrientation(o).map((v) => v.toFixed(3)).join(',')),
    );
    expect(vues.size).toBe(24);
  });
});

describe('le cube affiche pendant la resolution', () => {
  it('met au sommet la face que la consigne nomme, pour les 18 mouvements', () => {
    // Le modele doit montrer ce que le texte demande. Il etait auparavant
    // oriente par ce que la camera croyait voir — donc fige depuis qu'elle est
    // eteinte, et en contradiction avec la consigne.
    for (const move of MOVES) {
      const prise = ORIENTATIONS.find((o) => o.faceMapInv.U === move[0]);
      expect(prise).toBeDefined();
      const vue = multiplier(matriceVue(-26, -34), matriceOrientation(prise!));

      let sommet: Face = 'U';
      let plusHaut = Infinity;
      for (const f of FACES) {
        // En repere CSS, Y pointe vers le BAS : le sommet est le y minimal.
        const y = appliquer(vue, normaleCss(f))[1];
        if (y < plusHaut) {
          plusHaut = y;
          sommet = f;
        }
      }
      expect(`${move} -> ${sommet}`).toBe(`${move} -> ${move[0]}`);
    }
  });

  it('quatre prises amenent chaque face au sommet : le choix est libre', () => {
    for (const f of FACES) {
      expect(ORIENTATIONS.filter((o) => o.faceMapInv.U === f)).toHaveLength(4);
    }
  });
});

describe('l apercu de la face du dessus est EXACT, pas « a une rotation pres »', () => {
  it('la prise nommee fixe la rotation : centre en haut ET centre devant', () => {
    // Sans second ancrage, l'apercu n'etait vrai qu'a une rotation pres :
    // l'utilisateur comparait strictement et croyait a une divergence alors que
    // son cube etait juste. Nommer la couleur qui va DEVANT leve l'ambiguite.
    const etat = applyAlg(SOLVED_FACELETS, ['R', "U'", 'F2', 'L', "D'", 'B2']);
    for (const move of MOVES) {
      const prise = ORIENTATIONS.find((o) => o.faceMapInv.U === move[0]);
      expect(prise).toBeDefined();
      const tourne = applyPermStr(etat, prise!.perm);
      // Le centre du dessus est bien la face du mouvement...
      expect(`${move} : haut=${tourne[4]}`).toBe(`${move} : haut=${move[0]}`);
      // ... et le centre de devant est une face ADJACENTE, jamais l'opposee.
      const opposee: Record<string, string> = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
      expect(tourne[22]).not.toBe(move[0]);
      expect(tourne[22]).not.toBe(opposee[move[0]]);
    }
  });

  it('deux prises differentes donnent des apercus differents : la rotation compte', () => {
    const etat = applyAlg(SOLVED_FACELETS, ['R', "U'", 'F2']);
    for (const face of FACES) {
      const prises = ORIENTATIONS.filter((o) => o.faceMapInv.U === face);
      const apercus = new Set(prises.map((o) => applyPermStr(etat, o.perm).slice(0, 9)));
      // Si les quatre prises donnaient le meme apercu, nommer celle-ci
      // n'apporterait rien — et l'ambiguite serait sans consequence.
      expect(apercus.size).toBeGreaterThan(1);
    }
  });
});
