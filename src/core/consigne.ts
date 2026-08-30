/**
 * La consigne donnee a l'utilisateur pendant la resolution.
 *
 * Elle tient en DEUX TEMPS, et jamais autrement :
 *
 *   1. « Mets le ROUGE en haut »
 *   2. « La rangee la plus proche de toi part vers ta GAUCHE »
 *
 * Ce choix n'est pas cosmetique. L'application traduisait auparavant chaque
 * mouvement dans le point de vue suppose de l'utilisateur (« face de droite »,
 * « face avant »), ce qui exigeait de connaitre l'orientation de son cube. Cette
 * orientation venait du suivi camera : des qu'il decrochait, elle restait figee
 * sur celle du scan et l'application donnait des consignes fausses — en toute
 * confiance, jusqu'a ce que l'utilisateur ait melange son cube.
 *
 * La consigne en deux temps ne suppose RIEN :
 *
 * - la couleur d'un centre est un fait du cube. Les 18 mouvements de face
 *   laissent les six centres en place : « le rouge » designe la meme face du
 *   premier au dernier mouvement, quoi que l'utilisateur fasse de ses mains ;
 * - « amener cette couleur en haut, puis tourner la couche du haut » vaut
 *   exactement le mouvement demande, et ce pour les QUATRE prises possibles.
 *   `consigne.test.ts` le verifie : 72 conjugaisons sur 72 ;
 * - « la rangee la plus proche de toi part vers ta gauche » decrit un quart de
 *   tour horaire vu du dessus. Une couche tourne de facon rigide, donc la
 *   phrase reste vraie sous les quatre prises elle aussi.
 *
 * Consequence pratique : l'ecran est le meme camera debranchee.
 */

import {
  ORIENTATIONS,
  distancePrise,
  type Face,
  type Orientation,
} from './geometry';

/** Noms des couleurs, dans l'ordre de CANONICAL_PALETTE (color.ts). */
export const NOMS_COULEUR: readonly string[] = [
  'blanc',
  'jaune',
  'rouge',
  'orange',
  'vert',
  'bleu',
];

export type SensCouche = 'gauche' | 'droite' | 'demi';

/** Ou se trouve, dans la main de l'utilisateur, la face a tourner. */
export type PositionFace = 'dessus' | 'devant';

/**
 * Le geste, par position de la face et par suffixe de notation.
 *
 * Les deux positions se decrivent de la meme facon : on NOMME UNE RANGEE et on
 * dit ou elle va. « Tourne vers la gauche » ne veut rien dire pour un etage —
 * chacun de ses bords part ailleurs — et c'est en le disant ainsi qu'on fait
 * tourner l'utilisateur du mauvais cote une fois sur deux.
 *
 * Le DESSUS et le DEVANT sont les deux seules faces qu'on regarde droit dans
 * les yeux. Pour la droite ou l'arriere il faudrait se representer une rotation
 * vue de biais : c'est exactement le genre de projection mentale qui fait les
 * erreurs, et c'est pourquoi elles ne sont pas proposees.
 *
 * Le demi-tour est dit « DEUX quarts de tour » : comme le sens n'y a pas
 * d'importance, rien n'alerte celui qui s'arrete apres un seul quart — piege
 * observe en usage reel, et cause d'un echec complet de resolution.
 */
export const GESTES: Record<
  PositionFace,
  Record<string, { sens: SensCouche; geste: string; voix: string }>
> = {
  dessus: {
    '': {
      sens: 'gauche',
      geste: 'Tourne l\u2019\u00e9tage du haut : sa rang\u00e9e la plus PROCHE de toi part vers la GAUCHE.',
      voix: 'la rang\u00e9e du dessus la plus proche de toi part vers la gauche',
    },
    "'": {
      sens: 'droite',
      geste: 'Tourne l\u2019\u00e9tage du haut : sa rang\u00e9e la plus PROCHE de toi part vers la DROITE.',
      voix: 'la rang\u00e9e du dessus la plus proche de toi part vers la droite',
    },
    '2': {
      sens: 'demi',
      geste: 'DEUX quarts de tour d\u2019affil\u00e9e \u00e0 l\u2019\u00e9tage du haut. Le sens n\u2019importe pas.',
      voix: 'deux quarts de tour d\u2019affil\u00e9e \u00e0 l\u2019\u00e9tage du haut',
    },
  },
  devant: {
    '': {
      sens: 'droite',
      geste: 'Tourne la face DEVANT toi : sa rang\u00e9e du HAUT part vers la DROITE.',
      voix: 'la face devant toi, sa rang\u00e9e du haut part vers la droite',
    },
    "'": {
      sens: 'gauche',
      geste: 'Tourne la face DEVANT toi : sa rang\u00e9e du HAUT part vers la GAUCHE.',
      voix: 'la face devant toi, sa rang\u00e9e du haut part vers la gauche',
    },
    '2': {
      sens: 'demi',
      geste: 'DEUX quarts de tour d\u2019affil\u00e9e \u00e0 la face devant toi. Le sens n\u2019importe pas.',
      voix: 'deux quarts de tour d\u2019affil\u00e9e \u00e0 la face devant toi',
    },
  },
};

/** Conserve pour compatibilite : les gestes du dessus. */
export const SENS_COUCHE = GESTES.dessus;

export interface Consigne {
  /** Face absolue concernee (U, R, F, D, L, B). */
  face: Face;
  /** Ou elle se trouve dans la main : c'est ce qui determine le geste. */
  position: PositionFace;
  /** Couleur d'affichage du centre de cette face. */
  couleur: string;
  /** Nom de cette couleur, tel qu'on le dit a l'utilisateur. */
  nom: string;
  sens: SensCouche;
  /** Premier temps : amener la couleur en haut. */
  titre: string;
  /** Second temps : le geste sur la couche du haut. */
  geste: string;
  voix1: string;
  voix2: string;
  /** Notation standard, conservee en petit pour qui la lit. */
  notation: string;
}

export function consignePour(
  move: string,
  couleurs: Record<string, string>,
  noms: Record<string, string>,
  position: PositionFace = 'dessus',
): Consigne {
  const face = move[0] as Face;
  const suffixe = move.slice(1);
  const table = GESTES[position][suffixe] ?? GESTES[position][''];
  const nom = noms[face] ?? '?';
  return {
    face,
    position,
    couleur: couleurs[face] ?? '#888',
    nom,
    sens: table.sens,
    titre: `Tourne ton cube : le ${nom.toUpperCase()} vers le plafond`,
    geste: table.geste,
    voix1: `tourne ton cube, le ${nom} vers le plafond`,
    voix2: table.voix,
    notation: move,
  };
}

/**
 * Le mot que le bandeau emploie pour dire OU amener la face.
 *
 * Il vit ici, a cote des gestes, et non dans l'ecran. Ecrit en ligne dans
 * `app.ts`, rien ne pouvait le confronter au geste : le bandeau a pu annoncer
 * « vers le plafond » pendant que le geste parlait de la face devant soi, et
 * le test n'avait aucun moyen de le voir. Les deux sortent maintenant de la
 * meme `Consigne`, et un test les compare.
 */
export function motPosition(position: PositionFace): string {
  return position === 'devant' ? 'face a toi' : 'vers le plafond';
}

/**
 * Quelle prise adopter pour le prochain mouvement, et ou la face s'y trouve.
 *
 * Quatre prises amenent une face donnee au sommet, quatre autres la placent
 * devant : huit en tout, toutes justes. Prendre « la premiere » revient a
 * ignorer ou sont les mains de l'utilisateur. On prend donc celle qui coute le
 * moins de quarts de tour du cube entier depuis sa prise actuelle.
 *
 * Mesure sur 1687 mouvements et 80 solutions reelles : 29,1 quarts de tour par
 * resolution avec la premiere prise venue, 16,4 avec ce choix — a nombre
 * d'arrets identique. Et surtout, 100 % des reprises tiennent alors en UN SEUL
 * quart de tour, contre 24 % qui en demandaient trois.
 *
 * A cout egal on prefere le DESSUS : c'est le geste le plus facile, celui ou
 * l'on voit la couche qu'on tourne.
 */
export function prochainePrise(
  prise: Orientation,
  move: string,
): { prise: Orientation; position: PositionFace; reorienter: boolean } {
  const face = move[0] as Face;
  let meilleure = prise;
  let meilleurePosition: PositionFace = 'dessus';
  let cout = Infinity;
  for (const o of ORIENTATIONS) {
    const position: PositionFace | null =
      o.faceMapInv.U === face ? 'dessus' : o.faceMapInv.F === face ? 'devant' : null;
    if (!position) continue;
    const d = distancePrise(prise, o);
    // A egalite, le dessus l'emporte sur le devant.
    if (d < cout || (d === cout && position === 'dessus' && meilleurePosition === 'devant')) {
      cout = d;
      meilleure = o;
      meilleurePosition = position;
    }
  }
  return { prise: meilleure, position: meilleurePosition, reorienter: cout > 0 };
}
