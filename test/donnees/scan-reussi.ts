/**
 * Scan REEL ayant abouti, webcam frontale 1280x720, piece eclairee.
 *
 * Les 54 mesures brutes dans l'ordre des facettes, telles que l'application les
 * a produites. Sept d'entre elles saturent les trois canaux (des blancs brules
 * par l'auto-exposition) : ce scan exerce donc aussi la regle « trois canaux
 * satures = blanc ».
 *
 * Contrairement au scan de `scan-reel.ts`, celui-ci a ete valide par
 * l'utilisateur comme conforme a son cube.
 */
export const MESURES_SCAN_REUSSI: [number, number, number][] = [
  [228, 224, 222], [212, 193, 118], [75, 121, 82], [233, 209, 113], [226, 118, 63],
  [45, 82, 161], [244, 218, 114], [44, 78, 161], [44, 81, 165], [255, 230, 102],
  [242, 122, 68], [91, 145, 105], [70, 147, 79], [73, 141, 83], [255, 255, 255],
  [249, 141, 73], [252, 136, 70], [93, 153, 106], [99, 115, 159], [194, 79, 63],
  [254, 254, 252], [254, 254, 254], [231, 226, 219], [81, 144, 89], [209, 70, 54],
  [164, 183, 222], [85, 159, 96], [52, 87, 168], [255, 255, 255], [253, 234, 130],
  [78, 149, 87], [243, 92, 75], [56, 88, 171], [255, 248, 127], [82, 159, 92],
  [254, 142, 74], [50, 87, 173], [252, 225, 122], [202, 83, 68], [255, 255, 255],
  [55, 87, 164], [209, 87, 71], [236, 97, 81], [243, 136, 82], [209, 88, 72],
  [252, 138, 74], [253, 230, 122], [254, 254, 251], [242, 139, 82], [255, 237, 121],
  [216, 89, 72], [248, 146, 84], [229, 93, 77], [255, 255, 255],
];
