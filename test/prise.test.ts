import { describe, expect, it } from 'vitest';
import { SOLVED_FACELETS, applyAlg } from '../src/core/cube';
import {
  IDENTITY_ORIENTATION,
  ORIENTATIONS,
  distancePrise,
  invertAlg,
  permOf,
  permOfAlg,
  type Face,
  type Orientation,
} from '../src/core/geometry';
import { GESTES, prochainePrise, type PositionFace } from '../src/core/consigne';
import Cube from 'cubejs';

/**
 * La prise : combien de fois l'utilisateur doit-il reorienter son cube ?
 *
 * C'est la depense reelle d'une resolution. Les rotations de couche sont
 * rapides ; chercher une couleur et repositionner le cube ne l'est pas.
 */
let graine = 987654;
const tirage = () => ((graine = (graine * 1664525 + 1013904223) % 4294967296), graine / 4294967296);
const MOUVEMENTS = ['U',"U'",'U2','R',"R'",'R2','F',"F'",'F2','D',"D'",'D2','L',"L'",'L2','B',"B'",'B2'];

/**
 * Deroule la solution avec LA regle de l'application — importee, pas recopiee.
 *
 * Ce test rejouait auparavant une copie de la machine a prises d'app.ts : il
 * pouvait donc rester vert pendant que l'application faisait autre chose. La
 * regle vit maintenant dans `prochainePrise`, et les deux cotes l'importent.
 */
function derouler(solution: string[]): {
  reorientations: number;
  quarts: number;
  positions: PositionFace[];
  reprises: number[];
} {
  let prise: Orientation = IDENTITY_ORIENTATION;
  let reorientations = 0;
  let quarts = 0;
  const positions: PositionFace[] = [];
  const reprises: number[] = [];
  for (const move of solution) {
    const choix = prochainePrise(prise, move);
    if (choix.reorienter) {
      const d = distancePrise(prise, choix.prise);
      reorientations++;
      quarts += d;
      reprises.push(d);
    }
    prise = choix.prise;
    positions.push(choix.position);
  }
  return { reorientations, quarts, positions, reprises };
}

describe('economie de prises', () => {
  const solutions = (() => {
    Cube.initSolver();
    graine = 987654;
    return Array.from({ length: 20 }, () => {
      const etat = applyAlg(
        SOLVED_FACELETS,
        Array.from({ length: 20 }, () => MOUVEMENTS[Math.floor(tirage() * 18)]),
      );
      return Cube.fromString(etat).solve(22).trim().split(/\s+/);
    });
  })();

  it('choisir la prise la PLUS PROCHE reduit de moitie le travail de reprise', () => {
    let quartsArgmin = 0;
    let arretsArgmin = 0;
    let quartsPremiere = 0;
    let arretsPremiere = 0;
    const histogramme: Record<number, number> = {};
    let total = 0;

    for (const sol of solutions) {
      total += sol.length;
      const r = derouler(sol);
      quartsArgmin += r.quarts;
      arretsArgmin += r.reorientations;
      for (const d of r.reprises) histogramme[d] = (histogramme[d] ?? 0) + 1;

      // Reference : l'ancienne regle — la PREMIERE prise qui amene la face au
      // sommet, sans regarder ou sont les mains.
      let prise: Orientation = IDENTITY_ORIENTATION;
      for (const m of sol) {
        const ou = prise.faceMap[m[0] as Face];
        if (ou === 'U' || ou === 'F') continue;
        const suivante = ORIENTATIONS.find((o) => o.faceMapInv.U === m[0])!;
        quartsPremiere += distancePrise(prise, suivante);
        arretsPremiere++;
        prise = suivante;
      }
    }

    const n = solutions.length;
    console.log(`  ${total} mouvements sur ${n} cubes`);
    console.log(`  premiere prise venue : ${(quartsPremiere / n).toFixed(1)} quarts, ${(arretsPremiere / n).toFixed(1)} arrets`);
    console.log(`  prise la plus proche : ${(quartsArgmin / n).toFixed(1)} quarts, ${(arretsArgmin / n).toFixed(1)} arrets`);
    console.log(`  reprises : ${JSON.stringify(histogramme)}`);

    // Moins de travail de reprise, sans payer en arrets supplementaires.
    expect(quartsArgmin).toBeLessThan(quartsPremiere * 0.7);
    expect(arretsArgmin).toBeLessThanOrEqual(arretsPremiere);
    // Et surtout : plus aucune reprise a trois quarts de tour.
    expect(histogramme[3] ?? 0).toBe(0);
  });

  it('chaque consigne reste JUSTE : la conjugaison tient pour les deux positions', () => {
    // Le gain ne vaudrait rien si une seule consigne devenait fausse.
    for (const sol of solutions.slice(0, 6)) {
      const { positions } = derouler(sol);
      for (const [i, move] of sol.entries()) {
        const suffixe = move.slice(1);
        const position = positions[i];
        const lettre = position === 'dessus' ? 'U' : 'F';
        const prises = ORIENTATIONS.filter((o) =>
          position === 'dessus' ? o.faceMapInv.U === move[0] : o.faceMapInv.F === move[0],
        );
        for (const o of prises) {
          const conj = permOfAlg([...o.word, `${lettre}${suffixe}`, ...invertAlg(o.word)]);
          expect(conj.join(',')).toBe(permOf(move).join(','));
        }
        // Et le geste annonce existe pour cette position.
        expect(GESTES[position][suffixe]).toBeDefined();
      }
    }
  });

  it('la face du mouvement va au PLAFOND ou DEVANT, jamais l un pour l autre', () => {
    // L'argmin a introduit un cas neuf : une reprise peut amener la face du
    // mouvement DEVANT et non au sommet. Annoncer « vers le plafond » dans ce
    // cas contredirait le geste — et l'utilisateur tournerait la mauvaise face.
    let prise: Orientation = IDENTITY_ORIENTATION;
    let vusDessus = 0;
    let vusDevant = 0;
    for (const sol of solutions.slice(0, 10)) {
      for (const move of sol) {
        const choix = prochainePrise(prise, move);
        prise = choix.prise;
        const ou = prise.faceMap[move[0] as Face];
        expect(`${move} annonce ${choix.position}`).toBe(
          `${move} annonce ${ou === 'U' ? 'dessus' : 'devant'}`,
        );
        if (choix.position === 'dessus') vusDessus++;
        else vusDevant++;
      }
    }
    // Les deux cas existent reellement : le test ne teste pas du vide.
    expect(vusDessus).toBeGreaterThan(0);
    expect(vusDevant).toBeGreaterThan(0);
    console.log(`  positions rencontrees : ${vusDessus} dessus, ${vusDevant} devant`);
  });
});
