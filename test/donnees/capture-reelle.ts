/**
 * Capture reelle envoyee par l'utilisateur : webcam de Mac, piece peu eclairee.
 * Les 54 mesures dans l'ordre des facettes (U R F D L B), telles que sorties de
 * l'echantillonneur, avant tout traitement.
 *
 * Fait notable : ces couleurs sont PARFAITEMENT separables a l'oeil — six
 * groupes de neuf, sans ambiguite. La verite terrain ci-dessous a ete etablie
 * ainsi, et le compte tombe juste pour les six couleurs. Toute erreur du
 * classifieur sur ce jeu est donc une erreur du classifieur, pas une limite de
 * la mesure.
 *
 * Ce que la capture montre aussi : l'auto-exposition de la webcam pousse fort
 * dans une piece sombre, et SATURE le canal rouge sur les faces claires. Six
 * mesures valent exactement [255,255,255] et beaucoup d'autres plafonnent a
 * 245-255 en rouge. C'est le regime que ce jeu de donnees fait tester.
 */

export const CAPTURE_REELLE: [number, number, number][] = [
  [218, 236, 245], [145, 63, 49], [37, 67, 133],
  [221, 217, 128], [47, 87, 165], [168, 67, 51],
  [237, 136, 64], [255, 255, 255], [255, 255, 255],

  [229, 226, 132], [44, 87, 171], [209, 119, 62],
  [255, 255, 255], [199, 83, 65], [66, 145, 101],
  [58, 118, 229], [78, 169, 120], [255, 251, 170],

  [137, 55, 41], [213, 228, 234], [53, 93, 67],
  [219, 214, 132], [228, 241, 243], [175, 109, 68],
  [52, 90, 166], [77, 137, 102], [215, 131, 75],

  [211, 76, 64], [255, 255, 255], [255, 255, 255],
  [69, 127, 246], [81, 191, 141], [237, 94, 81],
  [103, 208, 154], [95, 207, 152], [254, 182, 104],

  [255, 255, 255], [254, 251, 175], [67, 145, 102],
  [255, 252, 189], [251, 158, 81], [46, 95, 194],
  [255, 251, 181], [59, 110, 210], [45, 89, 178],

  [245, 121, 100], [253, 167, 97], [254, 249, 138],
  [254, 188, 99], [255, 252, 194], [247, 143, 67],
  [251, 103, 81], [245, 99, 80], [69, 153, 107],
];

/** Couleur reelle de chaque mesure : B bleu, V vert, R rouge, O orange, J jaune, N blanc. */
export const VERITE_REELLE = [
  'N', 'R', 'B', 'J', 'B', 'R', 'O', 'N', 'N',
  'J', 'B', 'O', 'N', 'R', 'V', 'B', 'V', 'J',
  'R', 'N', 'V', 'J', 'N', 'O', 'B', 'V', 'O',
  'R', 'N', 'N', 'B', 'V', 'R', 'V', 'V', 'O',
  'N', 'J', 'V', 'J', 'O', 'B', 'J', 'B', 'B',
  'R', 'O', 'J', 'O', 'J', 'O', 'R', 'R', 'V',
];
