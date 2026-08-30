/**
 * Parcours de scan des 6 faces.
 *
 * Contrainte geometrique : une rotation d'un quart de tour amene devant l'une
 * des 4 faces adjacentes, jamais la face opposee. L'ordre des faces est donc
 * choisi pour que deux captures consecutives ne soient jamais opposees —
 * l'utilisateur n'a ainsi qu'UN geste simple a faire entre deux captures, et
 * jamais une double bascule ambigue.
 *
 * La correspondance grille-camera -> facettes n'est pas ecrite a la main : a
 * l'orientation `o`, la case i de la grille correspond exactement a la facette
 * `o.perm[18 + i]`, par definition de la permutation d'orientation. Toute la
 * geometrie du scan repose donc sur du code deja verifie par les tests.
 */

import {
  IDENTITY_ORIENTATION,
  ORIENTATIONS,
  composePerm,
  permOfAlg,
  type Face,
  type Orientation,
} from './geometry';

/** Aucune paire consecutive n'est une paire de faces opposees. */
const ORDER: readonly Face[] = ['F', 'U', 'R', 'B', 'L', 'D'];

const GENERATORS = ['x', "x'", 'y', "y'"] as const;

/**
 * Consignes de geste. Deux pieges de repere, qui ont tous les deux ete
 * formules a l'envers dans une version precedente :
 *
 *  1. La CAMERA TE FAIT FACE. « Basculer le cube vers toi » amene donc le
 *     DESSOUS face a l'objectif, pas le dessus. Pour montrer le dessus, il
 *     faut basculer le cube vers l'AVANT, loin de soi.
 *  2. L'image de la camera n'est pas en miroir : ce qui apparait a DROITE de
 *     l'ecran est ce qui se trouve a TA GAUCHE. Nommer « face de droite » la
 *     face qui apparait a droite de l'ecran envoie donc l'utilisateur du
 *     mauvais cote.
 *
 * `arriveeEcran` est la direction, SUR L'ECRAN, de la face qui vient se
 * presenter a la camera. C'est la seule affirmation verifiable par le calcul,
 * et le test `geste.test.ts` la confronte a la rotation reellement appliquee.
 * Les libelles, eux, sont ecrits dans le repere de l'utilisateur.
 */
export type DirectionEcran = 'haut' | 'bas' | 'droite' | 'gauche';

export const GESTURE: Record<
  string,
  { titre: string; detail: string; arriveeEcran: DirectionEcran }
> = {
  x: {
    titre: 'Bascule le cube vers toi',
    detail: 'Le dessous du cube remonte et vient face a la camera.',
    arriveeEcran: 'bas',
  },
  "x'": {
    titre: "Bascule le cube vers l'avant",
    detail: 'Pousse le dessus vers la camera : c\'est lui qui vient se montrer.',
    arriveeEcran: 'haut',
  },
  y: {
    titre: 'Pivote le cube vers ta droite',
    detail: 'La face qui est a TA GAUCHE vient face a la camera.',
    arriveeEcran: 'droite',
  },
  "y'": {
    titre: 'Pivote le cube vers ta gauche',
    detail: 'La face qui est a TA DROITE vient face a la camera.',
    arriveeEcran: 'gauche',
  },
};

export interface ScanStep {
  index: number;
  /** Face absolue capturee a cette etape. */
  face: Face;
  orientation: Orientation;
  /** Rotation a effectuer depuis l'etape precedente (null pour la premiere). */
  rotation: string | null;
  titre: string;
  detail: string;
}

/** Compose une orientation avec un generateur, en restant dans les 24 connues. */
export function composeOrientation(o: Orientation, generator: string): Orientation {
  const perm = composePerm(o.perm, permOfAlg([generator]));
  const key = perm.join(',');
  const found = ORIENTATIONS.find((x) => x.perm.join(',') === key);
  if (!found) throw new Error(`orientation introuvable pour ${generator}`);
  return found;
}

function buildPlan(): ScanStep[] {
  const steps: ScanStep[] = [
    {
      index: 0,
      face: IDENTITY_ORIENTATION.faceMapInv.F,
      orientation: IDENTITY_ORIENTATION,
      rotation: null,
      titre: 'Presente une face dans la grille',
      detail: 'Cette premiere face sert de reference pour tout le scan.',
    },
  ];

  let current = IDENTITY_ORIENTATION;
  for (let i = 1; i < ORDER.length; i++) {
    const target = ORDER[i];
    const generator = GENERATORS.find(
      (g) => composeOrientation(current, g).faceMapInv.F === target,
    );
    if (!generator) {
      throw new Error(
        `parcours impossible : ${current.faceMapInv.F} -> ${target} en un quart de tour`,
      );
    }
    current = composeOrientation(current, generator);
    steps.push({
      index: i,
      face: target,
      orientation: current,
      rotation: generator,
      ...GESTURE[generator],
    });
  }
  return steps;
}

export const SCAN_PLAN: readonly ScanStep[] = buildPlan();

/** Indices de facettes correspondant aux 9 cases de la grille, pour une etape. */
export function faceletsOfStep(step: ScanStep): number[] {
  const out: number[] = [];
  for (let i = 0; i < 9; i++) out.push(step.orientation.perm[18 + i]);
  return out;
}
