/**
 * Science des couleurs du scanner.
 *
 * Le seul vrai probleme d'un scanner de Rubik's cube, c'est de separer ROUGE
 * et ORANGE (et BLANC / JAUNE) sous un eclairage quelconque. Quatre idees
 * portent la fiabilite :
 *
 *  1. METRIQUE DE CHROMATICITE MASQUEE. On ne compare pas des couleurs brutes
 *     mais la direction de la couleur, la luminosite etant reestimee par
 *     moindres carres pour chaque sticker. Un sticker a l'ombre ou en pleine
 *     lumiere donne la meme distance. Les canaux SATURES (>=250) ou ecrases
 *     (<=3) sont exclus du calcul : un reflet ne fait plus mentir la mesure.
 *  2. ILLUMINANT PAR FACE (von Kries). Chaque face est filmee sous son propre
 *     angle et sa propre lumiere ; on estime 3 gains par face a partir de
 *     l'affectation courante.
 *  3. AFFECTATION GLOBALE SOUS CONTRAINTE. Exactement 9 stickers par couleur,
 *     resolue optimalement (algorithme hongrois) : une contrainte physique du
 *     cube vaut mieux que 54 decisions independantes.
 *  4. A PRIORI DE PALETTE. Les 6 couleurs d'un cube sont connues a une
 *     transformation d'eclairage globale pres ; cet ancrage empeche les
 *     references apprises de deriver.
 *
 * Les centres physiques du cube servent d'ancres certaines : par definition,
 * le centre de la face U est de la couleur U.
 */

import { hungarian } from './hungarian';
import { CENTER_INDEX, FACES, type Face } from './geometry';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export type Lin = [number, number, number];

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function toLinear(rgb: RGB): Lin {
  return [
    SRGB_TO_LINEAR[Math.round(clamp255(rgb.r))],
    SRGB_TO_LINEAR[Math.round(clamp255(rgb.g))],
    SRGB_TO_LINEAR[Math.round(clamp255(rgb.b))],
  ];
}

export function linearToSrgb(lin: Lin): RGB {
  const f = (c: number) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
    return clamp255(v * 255);
  };
  return { r: f(lin[0]), g: f(lin[1]), b: f(lin[2]) };
}

const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

export function linearToLab(lin: Lin): Lab {
  const [r, g, b] = lin;
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / XN;
  const Y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / YN;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / ZN;
  const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function rgbToLab(rgb: RGB): Lab {
  return linearToLab(toLinear(rgb));
}

export function luminance(c: Lin): number {
  return 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
}

export function rgbToCss(rgb: RGB): string {
  return `rgb(${Math.round(clamp255(rgb.r))} ${Math.round(clamp255(rgb.g))} ${Math.round(clamp255(rgb.b))})`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Un canal sature (>= CLIP_HIGH) a perdu son information : la vraie valeur est
 * "au moins ca". On l'exclut du calcul. En revanche un canal a 0 est une
 * mesure legitime (le rouge d'un sticker vert vaut vraiment zero) : le masquer
 * detruirait le canal le plus discriminant pour vert et bleu.
 */
export const CLIP_HIGH = 249;
const CLIP_LINEAR = SRGB_TO_LINEAR[CLIP_HIGH];

/**
 * Poids du terme de clarte ln(k)^2.
 * Volontairement faible : mesure faite, la clarte apporte peu face a la
 * chromaticite une fois l'eclairage normalise par face, et un poids eleve fait
 * lire un orange dans l'ombre comme un rouge (l'ecart de clarte de la BONNE
 * couleur devient aussi couteux que l'ecart chromatique de la mauvaise).
 */
export const DEFAULT_WEIGHT_L = 0.01;
/** Ridge sur l'estimation du facteur de clarte (tire k vers 1). */
export const DEFAULT_RIDGE = 0.03;
/** Penalite sur le voile speculaire estime (tire v vers 0). */
export const DEFAULT_GLARE_WEIGHT = 0.06;
/** Plafond du terme de clarte : au-dela, un ecart de luminosite ne prouve rien. */
const LUMA_CAP = 0.36;

export type Mask = [boolean, boolean, boolean];

export function channelMask(rgb: RGB): Mask {
  return [rgb.r < CLIP_HIGH, rgb.g < CLIP_HIGH, rgb.b < CLIP_HIGH];
}

/**
 * Distance couleur robuste entre un echantillon et une reference.
 *
 * On cherche le facteur de luminosite k qui rapproche le plus l'echantillon de
 * la reference (moindres carres sur les seuls canaux valides), puis on mesure
 * le residu RELATIF. Resultat : invariant a l'ombrage, insensible aux reflets,
 * et le terme en ln(k) conserve juste ce qu'il faut d'information de clarte
 * pour separer rouge et orange.
 */
export function colorCost(
  sample: Lin,
  mask: Mask,
  ref: Lin,
  weightL = DEFAULT_WEIGHT_L,
  ridge = DEFAULT_RIDGE,
  glareWeight = DEFAULT_GLARE_WEIGHT,
): number {
  // Modele : echantillon ~= k * reference + v * blanc.
  //   k = clarte (angle d'eclairage, distance a la lampe)
  //   v = voile speculaire, une lumiere BLANCHE qui s'ajoute (reflet)
  // Les deux sont estimes par moindres carres sur les canaux non satures, avec
  // un a priori qui tire k vers 1 et v vers 0. Sans le terme v, un simple
  // reflet suffit a faire lire un rouge comme un orange.
  let srr = 0;
  let sr = 0;
  let ssr = 0;
  let ss = 0;
  let n = 0;
  for (let c = 0; c < 3; c++) {
    if (!mask[c]) continue;
    srr += ref[c] * ref[c];
    sr += ref[c];
    ssr += sample[c] * ref[c];
    ss += sample[c];
    n++;
  }

  let k: number;
  let v: number;
  if (n === 0) {
    k = 1;
    v = 0;
  } else {
    const a11 = srr + ridge;
    const a12 = sr;
    const a22 = n + glareRidge(glareWeight);
    const b1 = ssr + ridge; // a priori k = 1
    const b2 = ss;
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-9) {
      k = (ssr + ridge) / (srr + ridge);
      v = 0;
    } else {
      k = (b1 * a22 - a12 * b2) / det;
      v = (a11 * b2 - a12 * b1) / det;
    }
    if (v < 0) {
      // un reflet ne peut qu'ajouter de la lumiere
      v = 0;
      k = (ssr + ridge) / (srr + ridge);
    }
    k = Math.max(0.2, Math.min(5, k));
    v = Math.max(0, Math.min(1, v));
  }

  let err = 0;
  let mag = 2e-3;
  for (let c = 0; c < 3; c++) {
    const predicted = k * ref[c] + v;
    if (mask[c]) {
      const d = sample[c] - predicted;
      err += d * d;
      mag += sample[c] * sample[c];
    } else {
      // Canal sature : l'information n'est pas perdue, c'est une INEGALITE
      // ("la vraie valeur vaut au moins le seuil"). Une reference qui predit du
      // sombre sur ce canal est donc incompatible ; une reference qui predit du
      // clair passe sans cout.
      const missing = CLIP_LINEAR - predicted;
      if (missing > 0) err += missing * missing;
      mag += CLIP_LINEAR * CLIP_LINEAR;
    }
  }

  // err / |echantillon|^2 : sin^2 de l'angle entre les couleurs, borne dans
  // [0,1] et insensible a la luminosite. (Normaliser par |k.ref|^2 donnerait
  // tan^2, non borne, ce qui deregle l'affectation globale.)
  const rel = err / mag;
  // La clarte aide a separer rouge et orange, mais son pouvoir de preuve
  // s'epuise : au-dela d'un facteur ~1,8 (ou d'un tiers de lumiere), un ecart
  // signifie "eclairage inhabituel", pas "mauvaise couleur". Sans ce
  // plafonnement, un orange dans l'ombre est lu comme un rouge.
  const lk = Math.log(k);
  const clarte = Math.min(lk * lk, LUMA_CAP);
  const veil = v / 0.25;
  return rel + weightL * clarte + glareWeight * veil * veil;
}

/** Force du rappel de v vers 0 dans les equations normales. */
function glareRidge(glareWeight: number): number {
  return glareWeight * 8;
}

/**
 * Palette canonique d'un cube 3x3 standard (sRGB approximatif).
 * A priori : les 6 couleurs d'un cube sont toujours a peu pres celles-la, a une
 * transformation d'eclairage globale pres.
 */
export const CANONICAL_PALETTE: readonly RGB[] = [
  { r: 240, g: 240, b: 238 }, // blanc
  { r: 250, g: 208, b: 45 }, // jaune
  { r: 190, g: 34, b: 40 }, // rouge
  { r: 240, g: 106, b: 26 }, // orange
  { r: 22, g: 152, b: 78 }, // vert
  { r: 24, g: 74, b: 178 }, // bleu
];
const CANONICAL_LIN = CANONICAL_PALETTE.map(toLinear);
/** Position du blanc dans la palette canonique. */
const INDEX_BLANC = 0;

/** Indices de la palette canonique associes a chaque groupe appris. */
function matchPaletteIndices(refLin: Lin[]): number[] {
  const sumRef = refLin.reduce((a, c) => a + luminance(c), 0);
  const sumCan = CANONICAL_LIN.reduce((a, c) => a + luminance(c), 0);
  const scale = sumCan > 1e-6 ? sumRef / sumCan : 1;
  const scaled = CANONICAL_LIN.map((c) => [c[0] * scale, c[1] * scale, c[2] * scale] as Lin);
  const full: Mask = [true, true, true];
  const cost = refLin.map((r) => scaled.map((c) => colorCost(r, full, c, 0.05)));
  return hungarian(cost);
}

function matchPalette(refLin: Lin[]): Lin[] {
  const sumRef = refLin.reduce((a, c) => a + luminance(c), 0);
  const sumCan = CANONICAL_LIN.reduce((a, c) => a + luminance(c), 0);
  const scale = sumCan > 1e-6 ? sumRef / sumCan : 1;
  const scaled = CANONICAL_LIN.map((c) => [c[0] * scale, c[1] * scale, c[2] * scale] as Lin);
  const full: Mask = [true, true, true];
  const cost = refLin.map((r) => scaled.map((c) => colorCost(r, full, c, 0.05)));
  const assign = hungarian(cost);
  return assign.map((j) => scaled[j]);
}

export interface ClassifyOptions {
  iterations?: number;
  weightL?: number;
  ridge?: number;
  glareWeight?: number;
  perFaceExposure?: boolean;
  /** Poids de l'a priori de palette [0..1]. 0 = purement pilote par l'image. */
  palettePrior?: number;
  /**
   * Ancrer les centres (par defaut). Les 6 centres etant de 6 couleurs
   * differentes, chacun sert de graine a un groupe. Les LETTRES obtenues ne
   * sont que des noms de groupes : elles n'affirment rien sur la position
   * geometrique des faces — c'est `findValidArrangement` qui s'en charge.
   */
  anchorCenters?: boolean;
}

export interface ClassifyResult {
  /** 54 lettres de face, dans l'ordre des facettes. */
  labels: Face[];
  /** Marge de confiance [0..1] : 0 = ambigu, 1 = certain. */
  confidence: number[];
  /** Ecart relatif au second choix, dans [0,1]. Contrairement a `confidence`,
   *  cette grandeur ne sature pas : c'est elle qui permet de designer les
   *  lectures reellement limites. */
  marge: number[];
  /** Deuxieme meilleur choix pour chaque sticker. */
  alternatives: Face[];
  /** distances[sticker][couleur] : cout, pour la reparation automatique. */
  distances: number[][];
  /** Couleurs de reference apprises, affichables. */
  referenceRgb: Record<Face, RGB>;
  /** References en RGB lineaire, pour la classification image par image. */
  referenceLin: Record<Face, Lin>;
  /**
   * Couleur de cube FRANCHE associee a chaque groupe (blanc, jaune, rouge,
   * orange, vert, bleu). C'est ce qu'il faut AFFICHER : la couleur mesuree est
   * delavee par l'eclairage, et un patron affiche en couleurs boueuses est
   * invérifiable pour l'utilisateur.
   */
  paletteRgb: Record<Face, RGB>;
  /** Indice dans CANONICAL_PALETTE de la couleur reelle de chaque groupe. */
  paletteIndex: Record<Face, number>;
  /** Stickers dont au moins un canal etait sature/ecrase. */
  saturated: boolean[];
}

export function classifyCube(samples: RGB[], options: ClassifyOptions = {}): ClassifyResult {
  const {
    iterations = 10,
    weightL = DEFAULT_WEIGHT_L,
    ridge = DEFAULT_RIDGE,
    glareWeight = DEFAULT_GLARE_WEIGHT,
    perFaceExposure = true,
    palettePrior = 0.35,
    anchorCenters = true,
  } = options;

  if (samples.length !== 54) throw new Error('54 echantillons attendus');

  const raw: Lin[] = samples.map(toLinear);
  const masks: Mask[] = samples.map(channelMask);
  const saturated = masks.map((m) => !(m[0] && m[1] && m[2]));

  // --- amorce : exposition par face ---
  const faceGain: Lin[] = Array.from({ length: 6 }, () => [1, 1, 1] as Lin);
  if (perFaceExposure) {
    const maxima: number[] = [];
    for (let f = 0; f < 6; f++) {
      const vals: number[] = [];
      for (let i = 0; i < 9; i++) {
        const s = f * 9 + i;
        const valid = raw[s].filter((_, c) => masks[s][c]);
        if (valid.length) vals.push(Math.max(...valid));
      }
      maxima.push(vals.length ? median(vals) : 1);
    }
    const target = median(maxima);
    for (let f = 0; f < 6; f++) {
      const k = maxima[f] > 1e-6 ? target / maxima[f] : 1;
      faceGain[f] = [k, k, k];
    }
  }

  const applyGains = (): Lin[] =>
    raw.map((c, i) => {
      const g = faceGain[Math.floor(i / 9)];
      return [c[0] * g[0], c[1] * g[1], c[2] * g[2]] as Lin;
    });

  const centerIdx = FACES.map((f) => CENTER_INDEX[f]);
  let lin = applyGains();
  let refLin: Lin[] = centerIdx.map((i) => lin[i]);
  let assignment: number[] = new Array(54).fill(0);

  /**
   * Une mesure dont les TROIS canaux saturent ne peut etre que du BLANC.
   *
   * C'est une certitude physique, pas une heuristique : le blanc est la seule
   * couleur d'un cube claire sur les trois canaux. Toutes les autres gardent un
   * canal franchement bas — bleu et vert n'ont pas de rouge, rouge et orange
   * n'ont pas de bleu, jaune n'a pas de bleu.
   *
   * Sans cette regle, une webcam qui surexpose (piece sombre, gain pousse a
   * fond) mesure les neuf blancs a (255,255,255) : l'information est detruite,
   * le groupe "blanc" n'existe plus, un autre groupe se coupe en deux et les
   * rouges se font lire comme du blanc. Mesure faite sur une capture reelle :
   * 19 erreurs sur 54 sans la regle, 0 avec.
   */
  const toutSature = (s: number) => !masks[s][0] && !masks[s][1] && !masks[s][2];

  /**
   * Quel groupe est le blanc ?
   *
   * Un CENTRE sature sur les trois canaux EST le centre blanc, et cette
   * certitude prime sur l'appariement de palette : une fois brules, un blanc
   * et un jaune se ressemblent assez pour que l'appariement les echange, ce
   * qui intervertit les deux groupes entiers. Entre plusieurs centres brules
   * on garde le plus bleu — le jaune perd son bleu avant le blanc.
   */
  const trouverGroupeBlanc = (refs: Lin[]): number => {
    if (anchorCenters) {
      let meilleur = -1;
      let bleuMax = -1;
      for (let k = 0; k < 6; k++) {
        const s = centerIdx[k];
        if (s === undefined || !toutSature(s)) continue;
        if (samples[s].b > bleuMax) {
          bleuMax = samples[s].b;
          meilleur = k;
        }
      }
      if (meilleur >= 0) return meilleur;
    }
    return matchPaletteIndices(refs).indexOf(INDEX_BLANC);
  };

  const costMatrix = (refs: Lin[]): number[][] => {
    const groupeBlanc = trouverGroupeBlanc(refs);
    const matrix: number[][] = [];
    for (let s = 0; s < 54; s++) {
      const row = new Array<number>(54);
      const fixed = centerIdx.indexOf(s);
      // Un centre est deja epingle a son propre groupe : lui appliquer en plus
      // la regle du blanc creerait deux contraintes contradictoires.
      const blancObligatoire = groupeBlanc >= 0 && fixed < 0 && toutSature(s);
      for (let col = 0; col < 54; col++) {
        const k = Math.floor(col / 9);
        const interdit =
          (anchorCenters && fixed >= 0 && k !== fixed) ||
          (blancObligatoire && k !== groupeBlanc);
        row[col] = interdit
          ? 1e6
          : colorCost(lin[s], masks[s], refs[k], weightL, ridge, glareWeight);
      }
      matrix.push(row);
    }
    return matrix;
  };

  for (let iter = 0; iter < iterations; iter++) {
    assignment = hungarian(costMatrix(refLin)).map((col) => Math.floor(col / 9));

    // --- illuminant par face, canaux valides seulement ---
    if (iter >= 1) {
      for (let f = 0; f < 6; f++) {
        const sumObs: Lin = [0, 0, 0];
        const sumRef: Lin = [0, 0, 0];
        for (let i = 0; i < 9; i++) {
          const s = f * 9 + i;
          const ref = refLin[assignment[s]];
          for (let c = 0; c < 3; c++) {
            if (!masks[s][c]) continue;
            sumObs[c] += raw[s][c];
            sumRef[c] += ref[c];
          }
        }
        for (let c = 0; c < 3; c++) {
          if (sumObs[c] < 1e-6) continue;
          const g = Math.max(0.3, Math.min(4, sumRef[c] / sumObs[c]));
          const trust = sumObs[c] / (sumObs[c] + 0.5);
          faceGain[f][c] = faceGain[f][c] * (1 - trust) + g * trust;
        }
      }
      lin = applyGains();
    }

    // --- references = moyenne des membres (centre pese double) ---
    // Le compteur est PAR CANAL : un canal sature est exclu de la somme, il
    // doit donc l'etre aussi du diviseur. Sinon un groupe dont tous les
    // membres saturent (les neuf blancs d'une camera surexposee) recoit la
    // reference (0,0,0) — du noir — et aspire n'importe quelle autre couleur.
    const sums = Array.from({ length: 6 }, () => [0, 0, 0, 0, 0, 0]);
    for (let s = 0; s < 54; s++) {
      const k = assignment[s];
      const w = centerIdx.includes(s) ? 2 : 1;
      for (let c = 0; c < 3; c++) {
        if (!masks[s][c]) continue;
        sums[k][c] += lin[s][c] * w;
        sums[k][3 + c] += w;
      }
    }
    let next: Lin[] = sums.map(
      (s, k) =>
        [0, 1, 2].map((c) =>
          s[3 + c] > 0
            ? s[c] / s[3 + c]
            : // Aucune mesure exploitable : tous les membres saturaient sur ce
              // canal, donc la verite y est au moins au niveau de saturation.
              Math.max(refLin[k][c], CLIP_LINEAR),
        ) as Lin,
    );

    if (palettePrior > 0 && iter >= 1) {
      const prior = matchPalette(next);
      const b = palettePrior;
      next = next.map(
        (v, k) =>
          [
            v[0] * (1 - b) + prior[k][0] * b,
            v[1] * (1 - b) + prior[k][1] * b,
            v[2] * (1 - b) + prior[k][2] * b,
          ] as Lin,
      );
    }

    let shift = 0;
    for (let k = 0; k < 6; k++) {
      shift += Math.abs(next[k][0] - refLin[k][0]) + Math.abs(next[k][1] - refLin[k][1]) + Math.abs(next[k][2] - refLin[k][2]);
    }
    refLin = next;
    if (shift < 1e-5 && iter >= 3) break;
  }

  assignment = hungarian(costMatrix(refLin)).map((col) => Math.floor(col / 9));

  const labels: Face[] = new Array(54);
  const confidence: number[] = new Array(54);
  const marge: number[] = new Array(54);
  const alternatives: Face[] = new Array(54);
  const distances: number[][] = new Array(54);
  for (let s = 0; s < 54; s++) {
    const k = assignment[s];
    labels[s] = FACES[k];
    const dists = refLin.map((r) => colorCost(lin[s], masks[s], r, weightL, ridge, glareWeight));
    distances[s] = dists;
    let bestOther = -1;
    for (let i = 0; i < 6; i++) {
      if (i === k) continue;
      if (bestOther < 0 || dists[i] < dists[bestOther]) bestOther = i;
    }
    alternatives[s] = FACES[bestOther];
    const d1 = Math.sqrt(dists[k]);
    const d2 = Math.sqrt(dists[bestOther]);
    // MARGE : ecart relatif au second choix, dans [0,1], sans facteur d'echelle.
    // C'est la seule des deux grandeurs qui reste informative — la confiance
    // ci-dessous sature a 1 des que la lecture est un tant soit peu nette.
    marge[s] = Math.max(0, Math.min(1, (d2 - d1) / (d1 + d2 + 1e-6)));
    // CONFIANCE : conservee telle quelle parce que le suivi en direct pondere
    // ses scores avec, contre un seuil de 0,86. La reechelonner casserait la
    // reconnaissance des faces pendant la resolution.
    confidence[s] = Math.max(0, Math.min(1, marge[s] * 2.2));
  }

  const referenceRgb = {} as Record<Face, RGB>;
  const referenceLin = {} as Record<Face, Lin>;
  const paletteRgb = {} as Record<Face, RGB>;
  const paletteIndex = {} as Record<Face, number>;
  const correspondance = matchPaletteIndices(refLin);
  for (let k = 0; k < 6; k++) {
    referenceLin[FACES[k]] = refLin[k];
    const acc = { r: 0, g: 0, b: 0, n: 0 };
    for (let s = 0; s < 54; s++) {
      if (assignment[s] !== k || saturated[s]) continue;
      acc.r += samples[s].r;
      acc.g += samples[s].g;
      acc.b += samples[s].b;
      acc.n++;
    }
    referenceRgb[FACES[k]] = acc.n
      ? { r: acc.r / acc.n, g: acc.g / acc.n, b: acc.b / acc.n }
      : linearToSrgb(refLin[k]);
    paletteRgb[FACES[k]] = { ...CANONICAL_PALETTE[correspondance[k]] };
    paletteIndex[FACES[k]] = correspondance[k];
  }

  return {
    labels,
    confidence,
    marge,
    alternatives,
    distances,
    referenceRgb,
    referenceLin,
    paletteRgb,
    paletteIndex,
    saturated,
  };
}

/**
 * Classification d'une seule face pendant le guidage : les 6 references sont
 * deja connues, on renormalise l'exposition sur l'image courante puis on prend
 * le plus proche voisin (avec la meme metrique robuste).
 */
export function classifyFace(
  samples: RGB[],
  references: Record<Face, Lin>,
  weightL = DEFAULT_WEIGHT_L,
  ridge = DEFAULT_RIDGE,
  glareWeight = DEFAULT_GLARE_WEIGHT,
): { labels: Face[]; confidence: number[] } {
  const raw = samples.map(toLinear);
  const masks = samples.map(channelMask);
  const refs = FACES.map((f) => references[f]);

  // Amorce : mise a l'echelle globale de l'image sur les references.
  const obsVals: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const valid = raw[i].filter((_, c) => masks[i][c]);
    if (valid.length) obsVals.push(Math.max(...valid));
  }
  const refVals = refs.map((r) => Math.max(r[0], r[1], r[2]));
  const k0 = obsVals.length ? median(refVals) / Math.max(1e-6, median(obsVals)) : 1;
  const gains: Lin = [k0, k0, k0];

  const affecter = (lin: Lin[]): number[] =>
    lin.map((c, i) => {
      const couts = refs.map((r) => colorCost(c, masks[i], r, weightL, ridge, glareWeight));
      let best = 0;
      for (let j = 1; j < 6; j++) if (couts[j] < couts[best]) best = j;
      return best;
    });

  let lin = raw.map((c) => [c[0] * gains[0], c[1] * gains[1], c[2] * gains[2]] as Lin);
  let choix = affecter(lin);

  // La face vue pendant la resolution n'est pas eclairee comme au moment du
  // scan : angle, distance et lumiere ont change. On reestime donc les trois
  // gains d'illuminant sur l'image courante, exactement comme pour le scan.
  for (let iter = 0; iter < 3; iter++) {
    const sumObs: Lin = [0, 0, 0];
    const sumRef: Lin = [0, 0, 0];
    for (let i = 0; i < raw.length; i++) {
      const ref = refs[choix[i]];
      for (let c = 0; c < 3; c++) {
        if (!masks[i][c]) continue;
        sumObs[c] += raw[i][c];
        sumRef[c] += ref[c];
      }
    }
    let bouge = 0;
    for (let c = 0; c < 3; c++) {
      if (sumObs[c] < 1e-6) continue;
      const g = Math.max(0.3, Math.min(4, sumRef[c] / sumObs[c]));
      const confiance = sumObs[c] / (sumObs[c] + 0.5);
      const suivant = gains[c] * (1 - confiance) + g * confiance;
      bouge += Math.abs(suivant - gains[c]);
      gains[c] = suivant;
    }
    lin = raw.map((c) => [c[0] * gains[0], c[1] * gains[1], c[2] * gains[2]] as Lin);
    const nouveau = affecter(lin);
    const stable = nouveau.every((v, i) => v === choix[i]);
    choix = nouveau;
    if (stable && bouge < 1e-3) break;
  }

  const labels: Face[] = [];
  const confidence: number[] = [];
  for (let i = 0; i < lin.length; i++) {
    const dists = refs.map((r) => colorCost(lin[i], masks[i], r, weightL, ridge, glareWeight));
    const best = choix[i];
    let second = -1;
    for (let j = 0; j < 6; j++) {
      if (j === best) continue;
      if (second < 0 || dists[j] < dists[second]) second = j;
    }
    labels.push(FACES[best]);
    const d1 = Math.sqrt(dists[best]);
    const d2 = Math.sqrt(dists[second]);
    confidence.push(Math.max(0, Math.min(1, ((d2 - d1) / (d1 + d2 + 1e-6)) * 2.2)));
  }
  return { labels, confidence };
}

/**
 * Ces deux couleurs sont-elles la MEME couleur de sticker vue sous deux
 * lumieres differentes ? Utilise pour refuser une face dont le centre est deja
 * enregistre (il n'existe qu'un centre de chaque couleur sur un cube).
 *
 * Trois precautions, chacune payee par un bug :
 *  - chromaticite pure, sans ridge : le ridge tire la luminosite estimee vers 1
 *    et fabriquerait un faux ecart entre deux vues d'un meme centre sombre ;
 *  - accord exige dans LES DEUX SENS : quand un canal sature, la comparaison
 *    devient asymetrique (un jaune au rouge sature parait compatible avec un
 *    orange dans un sens, pas dans l'autre) ;
 *  - abstention si un canal de l'un des deux centres est sature : on ne peut
 *    alors rien affirmer.
 *
 * SEUIL. Mesures relevees sur des captures reelles en lumiere faible :
 *   meme couleur, deux eclairages ......... 0,0005
 *   orange sombre contre rouge sombre ..... 0,0104
 * D'ou 0,004, au milieu de la marge. Ajouter un terme de clarte ne sauve pas
 * la mise : il fait monter "meme couleur, deux eclairages" a 0,0437, soit
 * PLUS que rouge contre orange (0,0417) — l'ordre s'inverse.
 *
 * Cette marge reste etroite : ce test SIGNALE, il ne bloque pas. Le refus de
 * capture s'appuie sur la comparaison des 9 cases, bien mieux informee.
 */
export function sameStickerColor(a: RGB, b: RGB, threshold = 0.004): boolean {
  const ma = channelMask(a);
  const mb = channelMask(b);
  if (!ma[0] || !ma[1] || !ma[2] || !mb[0] || !mb[1] || !mb[2]) return false;
  const la = toLinear(a);
  const lb = toLinear(b);
  const cost = Math.max(
    colorCost(la, ma, lb, 0, 1e-4, 0.6),
    colorCost(lb, mb, la, 0, 1e-4, 0.6),
  );
  return cost < threshold;
}
