import { describe, expect, it } from 'vitest';
import { FACES, FACE_NORMAL, type Face } from '../src/core/geometry';
import { GESTURE, SCAN_PLAN, type DirectionEcran } from '../src/core/scanPlan';
import {
  VUES,
  appliquer,
  matriceDuGeste,
  matriceVue,
  multiplier,
  vuesDuParcours,
} from '../src/ui/cube3d';

/**
 * L'illustration du geste doit etre VRAIE : a chaque etape, la face que le
 * plan annonce doit etre celle qui regarde la camera apres le geste. Sans ce
 * test, l'animation resterait jolie tout en montrant un geste faux — ce qui
 * egare l'utilisateur bien plus surement que pas d'illustration du tout.
 */

/** Normale d'une face dans le repere CSS (Y vers le bas). */
function normaleCss(f: Face): number[] {
  const n = FACE_NORMAL[f];
  return [n[0], -n[1], n[2]];
}

/** Face dont la normale pointe le plus vers l'observateur (+Z en CSS). */
function faceVersCamera(m: readonly number[]): { face: Face; z: number } {
  let meilleure: Face = 'F';
  let max = -Infinity;
  for (const f of FACES) {
    const z = appliquer(m, normaleCss(f))[2];
    if (z > max) {
      max = z;
      meilleure = f;
    }
  }
  return { face: meilleure, z: max };
}

const ROTATIONS = SCAN_PLAN.map((s) => s.rotation);

describe('illustration du geste de scan', () => {
  it('chaque vue de reference montre bien la face attendue', () => {
    for (const face of FACES) {
      const [yaw, pitch] = VUES[face];
      expect(faceVersCamera(matriceVue(yaw, pitch)).face).toBe(face);
    }
  });

  it('a chaque etape, la face annoncee par le plan regarde la camera', () => {
    const vues = vuesDuParcours(ROTATIONS);
    expect(vues).toHaveLength(SCAN_PLAN.length);

    const observe = vues.map((m) => faceVersCamera(m).face).join(' ');
    const attendu = SCAN_PLAN.map((s) => s.face).join(' ');
    expect(observe).toBe(attendu);

    // Franchement de face, pas juste "un peu plus que les autres" : la vue est
    // de trois quarts (lacet 26 deg, tangage 18 deg), donc cos(36 deg) = 0.81
    // est la bonne barre.
    for (const m of vues) expect(faceVersCamera(m).z).toBeGreaterThan(0.8);
  });

  it('le parcours passe bien par les 6 faces, une seule fois chacune', () => {
    const vues = vuesDuParcours(ROTATIONS);
    const vues6 = new Set(vues.map((m) => faceVersCamera(m).face));
    expect(vues6.size).toBe(6);
  });

  it('composer le geste du mauvais cote donnerait un geste faux', () => {
    // Garde-fou : « tourne vers la gauche » tourne autour de la verticale de la
    // PIECE. Compose a droite (axe propre du cube), l'etape 3 ne montrerait
    // plus la bonne face — et l'utilisateur ferait le mauvais mouvement.
    const vues = vuesDuParcours(ROTATIONS);
    const etape = SCAN_PLAN[2];
    const geste = matriceDuGeste(etape.rotation as string, 1) as number[];
    const aDroite = multiplier(vues[1], geste);
    expect(faceVersCamera(aDroite).face).not.toBe(etape.face);
  });

  it('dans son dernier tiers, le geste montre sans ambiguite la face d arrivee', () => {
    // Ce qui rend un geste lisible n'est pas qu'il soit monotone — l'animation
    // passe bien en face de la cible avant de se poser sur la vue de trois
    // quarts — mais que sa fin designe une seule face. Mesure : la bascule se
    // fait au plus tard a 60 % de la course (etape 3, la plus tardive).
    const vues = vuesDuParcours(ROTATIONS);
    for (let i = 1; i < SCAN_PLAN.length; i++) {
      for (let k = 6; k <= 10; k++) {
        const g = matriceDuGeste(SCAN_PLAN[i].rotation as string, k / 10) as number[];
        const vue = faceVersCamera(multiplier(g, vues[i - 1]));
        expect(`t=${k / 10} -> ${vue.face}`).toBe(`t=${k / 10} -> ${SCAN_PLAN[i].face}`);
      }
    }
  });

  it('le libelle de chaque geste dit la verite sur la face qui arrive', () => {
    // Sur l'ecran (repere CSS : Y vers le bas, Z vers l'observateur).
    const DIRECTION: Record<DirectionEcran, number[]> = {
      haut: [0, -1, 0],
      bas: [0, 1, 0],
      droite: [1, 0, 0],
      gauche: [-1, 0, 0],
    };
    for (const [generateur, geste] of Object.entries(GESTURE)) {
      const m = matriceDuGeste(generateur, 1) as number[];
      const arrivee = appliquer(m, DIRECTION[geste.arriveeEcran]);
      // Cette direction doit finir exactement face a l'observateur.
      expect(`${generateur} -> z=${arrivee[2].toFixed(3)}`).toBe(`${generateur} -> z=1.000`);
    }
  });

  it('aucun libelle ne dit « vers toi » pour un geste qui eloigne du corps', () => {
    // La camera FAIT FACE a l'utilisateur : « basculer vers toi » amene le
    // dessous a l'objectif. Un libelle « vers toi » sur le geste qui montre le
    // DESSUS enverrait l'utilisateur exactement a l'envers — c'est le bug qui
    // a motive ce test.
    expect(GESTURE["x'"].titre.toLowerCase()).not.toContain('vers toi');
    expect(GESTURE["x'"].arriveeEcran).toBe('haut');
    expect(GESTURE.x.titre.toLowerCase()).toContain('vers toi');
    expect(GESTURE.x.arriveeEcran).toBe('bas');
  });
});
