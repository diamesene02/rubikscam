import { describe, expect, it } from 'vitest';
import { SOLVED_FACELETS, applyAlg } from '../src/core/cube';
import { ORIENTATIONS, applyPermStr, permOf, type Face } from '../src/core/geometry';
import { SENS_COUCHE } from '../src/core/consigne';
import Cube from 'cubejs';

/**
 * LE test qui compte : en suivant les consignes a la lettre, le cube est-il
 * resolu a la fin ?
 *
 * On ne simule pas les mouvements de la solution — ce serait tautologique. On
 * simule ce que fait REELLEMENT l'utilisateur, dans le repere de la piece :
 *
 *   1. il fait tourner son cube ENTIER pour amener la couleur demandee en haut
 *      (aucun sticker ne bouge par rapport aux autres, seul le point de vue
 *      change) ;
 *   2. il fait tourner l'etage du haut, et rien d'autre ;
 *   3. il ne « defait » jamais la reorientation : il enchaine directement.
 *
 * C'est ce troisieme point qui inquiete a juste titre : la demonstration
 * mathematique conjugue par o puis par o inverse, alors que l'utilisateur, lui,
 * ne revient jamais en arriere.
 */
let graine = 20260829;
const tirage = () => ((graine = (graine * 1664525 + 1013904223) % 4294967296), graine / 4294967296);
const MOUVEMENTS = ['U',"U'",'U2','R',"R'",'R2','F',"F'",'F2','D',"D'",'D2','L',"L'",'L2','B',"B'",'B2'];

/** Chaque face du cube ne porte-t-elle qu'une seule couleur ? */
function resolu(etat: string): boolean {
  for (let f = 0; f < 6; f++) {
    const face = etat.slice(f * 9, f * 9 + 9);
    if ([...face].some((c) => c !== face[0])) return false;
  }
  return true;
}

/**
 * L'utilisateur tourne son cube entier pour amener au sommet la face dont le
 * CENTRE porte cette couleur. Dans le repere de la piece, cela deplace les
 * stickers sans en changer aucun.
 */
function amenerEnHaut(piece: string, couleur: string): string {
  for (const o of ORIENTATIONS) {
    const tourne = applyPermStr(piece, o.perm);
    if (tourne[4] === couleur) return tourne;
  }
  throw new Error(`aucune prise n amene ${couleur} en haut`);
}

describe('le parcours complet, tel que l utilisateur le vit', () => {
  it('suivre les consignes resout le cube, sans jamais defaire une prise', () => {
    // Le VRAI solveur, celui que l'application utilise : des solutions
    // Kociemba d'une vingtaine de mouvements, pas un melange inverse.
    Cube.initSolver();

    let resolus = 0;
    let mouvementsSuivis = 0;
    const essais = 25;

    for (let n = 0; n < essais; n++) {
      const melange = Array.from({ length: 20 }, () => MOUVEMENTS[Math.floor(tirage() * 18)]);
      const depart = applyAlg(SOLVED_FACELETS, melange);
      const solution = Cube.fromString(depart).solve(22).trim().split(/\s+/).filter(Boolean);
      expect(solution.length).toBeGreaterThan(10);

      // Le cube tel qu'il est dans la piece, au depart tenu comme au scan.
      let piece = depart;
      for (const move of solution) {
        // 1. La consigne nomme une couleur : l'utilisateur l'amene en haut.
        piece = amenerEnHaut(piece, move[0]);
        // 2. Il tourne l'etage du haut, et rien d'autre.
        piece = applyPermStr(piece, permOf(`U${move.slice(1)}`));
        mouvementsSuivis++;
        // 3. Il ne defait rien : on enchaine tel quel.
      }
      if (resolu(piece)) resolus++;
    }

    console.log(`  ${mouvementsSuivis} consignes suivies sur ${essais} cubes (solveur reel)`);
    console.log(`  cubes resolus a la fin : ${resolus}/${essais}`);
    expect(resolus).toBe(essais);
  });

  it('chaque consigne nomme une couleur qui EXISTE au centre d une face', () => {
    // Si une consigne nommait une couleur absente des centres, l'utilisateur
    // ne pourrait pas l'amener en haut — la consigne serait impossible.
    const melange = Array.from({ length: 20 }, () => MOUVEMENTS[Math.floor(tirage() * 18)]);
    let piece = applyAlg(SOLVED_FACELETS, melange);
    const centres = new Set([0, 1, 2, 3, 4, 5].map((f) => piece[f * 9 + 4]));
    expect(centres.size).toBe(6);
    for (const m of MOUVEMENTS) {
      expect(centres.has(m[0] as Face)).toBe(true);
      // Et le suffixe a bien une consigne de geste.
      expect(SENS_COUCHE[m.slice(1)]).toBeDefined();
    }
    piece = applyPermStr(piece, permOf('U'));
    // Les centres ne bougent jamais : c'est ce qui rend la couleur fiable.
    expect(new Set([0, 1, 2, 3, 4, 5].map((f) => piece[f * 9 + 4])).size).toBe(6);
  });
});
