/**
 * Verite terrain : le cube physique de l'utilisateur, photographie face par
 * face sous bonne lumiere. Six photos, une par face, dans l'ordre d'envoi.
 * Chaque face est lue ligne par ligne, telle qu'elle apparait sur la photo.
 *
 * N blanc, J jaune, R rouge, O orange, V vert, B bleu.
 */
export const FACES_PHOTOGRAPHIEES: string[][] = [
  // centre ROUGE
  ['O', 'V', 'J', 'B', 'R', 'V', 'J', 'N', 'B'],
  // centre BLEU
  ['N', 'N', 'B', 'R', 'B', 'J', 'B', 'R', 'R'],
  // centre VERT
  ['V', 'N', 'N', 'O', 'V', 'R', 'J', 'V', 'O'],
  // centre JAUNE
  ['R', 'O', 'R', 'R', 'J', 'O', 'N', 'J', 'O'],
  // centre BLANC (porte le logo Rubik's)
  ['V', 'B', 'R', 'V', 'N', 'N', 'O', 'O', 'V'],
  // centre ORANGE
  ['V', 'B', 'B', 'J', 'O', 'B', 'N', 'J', 'J'],
];
