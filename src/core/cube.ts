/**
 * Etat du cube en representation "facelets" (54 lettres URFDLB) + validation.
 *
 * La validation est indispensable : une seule couleur mal lue produit un cube
 * physiquement impossible, et le solveur partirait en boucle infinie ou
 * renverrait une solution absurde. On verifie donc, avant de resoudre :
 *   1. 9 stickers de chaque couleur
 *   2. les centres a leur place
 *   3. les 8 coins et 12 aretes existent tous exactement une fois
 *   4. somme des orientations de coins = 0 (mod 3), d aretes = 0 (mod 2)
 *   5. meme parite de permutation entre coins et aretes
 */

import {
  CORNER_COLORS,
  CORNER_FACELETS,
  CORNER_NAMES,
  EDGE_COLORS,
  EDGE_FACELETS,
  EDGE_NAMES,
  FACES,
  CENTER_INDEX,
  applyPermStr,
  permOf,
  permOfAlg,
  parseAlg,
  type Face,
} from './geometry';

export const SOLVED_FACELETS = FACES.map((f) => f.repeat(9)).join('');

export type Facelets = string;

export function isFace(ch: string): ch is Face {
  return (FACES as readonly string[]).includes(ch);
}

export function applyMove(state: Facelets, move: string): Facelets {
  return applyPermStr(state, permOf(move));
}

export function applyAlg(state: Facelets, alg: string | string[]): Facelets {
  return applyPermStr(state, permOfAlg(alg));
}

export function faceOf(state: Facelets, face: Face): string {
  const i = FACES.indexOf(face) * 9;
  return state.slice(i, i + 9);
}

export function isSolved(state: Facelets): boolean {
  for (let f = 0; f < 6; f++) {
    const c = state[f * 9];
    for (let i = 1; i < 9; i++) if (state[f * 9 + i] !== c) return false;
  }
  return true;
}

export interface ValidationIssue {
  code:
    | 'longueur'
    | 'lettre'
    | 'compte'
    | 'centre'
    | 'coin'
    /** Bonnes couleurs, mais montees dans l'autre sens : piece impossible. */
    | 'coin-miroir'
    | 'arete'
    | 'orientation-coins'
    | 'orientation-aretes'
    | 'parite';
  message: string;
  /** Facettes mises en cause, pour les surligner dans l interface. */
  facelets: number[];
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Les couleurs d'un coin sont-elles une rotation cyclique du modele ? */
function rotationCyclique(cols: readonly string[], modele: readonly string[]): boolean {
  for (let d = 0; d < 3; d++) {
    if (cols.every((c, i) => c === modele[(i + d) % 3])) return true;
  }
  return false;
}

const CORNER_KEY = new Map<string, number>();
CORNER_COLORS.forEach((cols, i) => {
  CORNER_KEY.set([...cols].sort().join(''), i);
});
const EDGE_KEY = new Map<string, number>();
EDGE_COLORS.forEach((cols, i) => {
  EDGE_KEY.set([...cols].sort().join(''), i);
});

function permutationParity(perm: number[]): number {
  const seen = new Array(perm.length).fill(false);
  let parity = 0;
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let j = i;
    let len = 0;
    while (!seen[j]) {
      seen[j] = true;
      j = perm[j];
      len++;
    }
    if (len > 0) parity ^= (len - 1) & 1;
  }
  return parity;
}

export function validate(state: Facelets): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (state.length !== 54) {
    return { ok: false, issues: [{ code: 'longueur', message: 'Il faut 54 facettes.', facelets: [] }] };
  }

  const counts = new Map<string, number[]>();
  for (let i = 0; i < 54; i++) {
    const ch = state[i];
    if (!isFace(ch)) {
      issues.push({ code: 'lettre', message: `Facette ${i} non reconnue.`, facelets: [i] });
      continue;
    }
    const arr = counts.get(ch) ?? [];
    arr.push(i);
    counts.set(ch, arr);
  }
  if (issues.length) return { ok: false, issues };

  for (const f of FACES) {
    const got = counts.get(f) ?? [];
    if (got.length !== 9) {
      issues.push({
        code: 'compte',
        message: `${got.length} sticker(s) de la couleur ${f} au lieu de 9.`,
        facelets: got,
      });
    }
  }

  for (const f of FACES) {
    const idx = CENTER_INDEX[f];
    if (state[idx] !== f) {
      issues.push({
        code: 'centre',
        message: `Le centre de la face ${f} a ete lu comme ${state[idx]}.`,
        facelets: [idx],
      });
    }
  }
  if (issues.length) return { ok: false, issues };

  // --- Coins ---
  const cornerPerm: number[] = [];
  const cornerOri: number[] = [];
  const usedCorners = new Set<number>();
  for (let slot = 0; slot < 8; slot++) {
    const fl = CORNER_FACELETS[slot];
    const cols = fl.map((i) => state[i]);
    const id = CORNER_KEY.get([...cols].sort().join(''));
    if (id === undefined || usedCorners.has(id)) {
      issues.push({
        code: 'coin',
        message: `Le coin ${CORNER_NAMES[slot]} (${cols.join('')}) n'existe pas ou est en double.`,
        facelets: [...fl],
      });
      continue;
    }
    // Les bonnes couleurs ne suffisent pas : elles doivent etre montees dans le
    // BON SENS. Un coin et son miroir portent le meme ensemble de couleurs mais
    // ne peuvent pas coexister — une piece de cube n'a qu'une chiralite.
    //
    // Identifier un coin par l'ensemble trie laissait donc passer des cubes
    // physiquement impossibles. Mesure : 2,8 % des placements en produisent, et
    // le solveur part alors chercher une solution qui n'existe pas — il n'en
    // trouve aucune en 22 secondes, abandonne, et l'utilisateur rescanne sans
    // jamais comprendre pourquoi.
    if (!rotationCyclique(cols, CORNER_COLORS[id])) {
      issues.push({
        code: 'coin-miroir',
        message:
          `Le coin ${CORNER_NAMES[slot]} porte les bonnes couleurs (${cols.join('')}) mais` +
          ` montees a l'envers : ce coin n'existe pas.`,
        facelets: [...fl],
      });
      continue;
    }
    usedCorners.add(id);
    // orientation : position de la facette U/D dans le triplet du slot
    let ori = cols.findIndex((c) => c === 'U' || c === 'D');
    if (ori < 0) {
      issues.push({
        code: 'coin',
        message: `Le coin ${CORNER_NAMES[slot]} n'a ni blanc-haut ni bas (U/D).`,
        facelets: [...fl],
      });
      continue;
    }
    cornerPerm[slot] = id;
    cornerOri[slot] = ori;
  }

  // --- Aretes ---
  const edgePerm: number[] = [];
  const edgeOri: number[] = [];
  const usedEdges = new Set<number>();
  for (let slot = 0; slot < 12; slot++) {
    const fl = EDGE_FACELETS[slot];
    const cols = fl.map((i) => state[i]);
    const id = EDGE_KEY.get([...cols].sort().join(''));
    if (id === undefined || usedEdges.has(id)) {
      issues.push({
        code: 'arete',
        message: `L'arete ${EDGE_NAMES[slot]} (${cols.join('')}) n'existe pas ou est en double.`,
        facelets: [...fl],
      });
      continue;
    }
    usedEdges.add(id);
    edgePerm[slot] = id;
    edgeOri[slot] = cols[0] === EDGE_COLORS[id][0] ? 0 : 1;
  }

  if (issues.length) return { ok: false, issues };

  const twist = cornerOri.reduce((a, b) => a + b, 0) % 3;
  if (twist !== 0) {
    issues.push({
      code: 'orientation-coins',
      message: "Un coin est mal oriente (somme des rotations de coins ≠ 0). Verifie les coins.",
      facelets: CORNER_FACELETS.flatMap((c) => [...c]),
    });
  }
  const flip = edgeOri.reduce((a, b) => a + b, 0) % 2;
  if (flip !== 0) {
    issues.push({
      code: 'orientation-aretes',
      message: "Une arete est retournee (somme des retournements ≠ 0). Verifie les aretes.",
      facelets: EDGE_FACELETS.flatMap((e) => [...e]),
    });
  }
  if (permutationParity(cornerPerm) !== permutationParity(edgePerm)) {
    issues.push({
      code: 'parite',
      message:
        "Deux stickers semblent inverses (parite coins/aretes incoherente). Deux couleurs voisines ont sans doute ete confondues.",
      facelets: [],
    });
  }

  return { ok: issues.length === 0, issues };
}

export function describeIssues(issues: ValidationIssue[]): string {
  if (!issues.length) return '';
  return issues.map((i) => i.message).join(' ');
}

/** Melange aleatoire valide (utile pour le mode demo et les tests). */
export function randomScramble(length = 25): string[] {
  const axes: Record<Face, number> = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
  const out: string[] = [];
  let lastFace: Face | null = null;
  let lastAxis = -1;
  while (out.length < length) {
    const f = FACES[Math.floor(Math.random() * 6)];
    if (f === lastFace) continue;
    if (axes[f] === lastAxis && out.length > 0 && lastFace && axes[lastFace] === lastAxis) {
      // eviter U D U : on autorise une paire sur le meme axe mais pas trois
      if (out.length >= 2) {
        const prev = out[out.length - 2][0] as Face;
        if (axes[prev] === lastAxis) continue;
      }
    }
    const suffix = ['', "'", '2'][Math.floor(Math.random() * 3)];
    out.push(f + suffix);
    lastFace = f;
    lastAxis = axes[f];
  }
  return out;
}

export { parseAlg };

/**
 * Echange deux faces entieres dans une lecture.
 *
 * C'est l'operation dont l'utilisateur a besoin quand une face a ete rangee au
 * mauvais endroit — le cas le plus frequent quand un geste de scan est fait a
 * l'envers. Changer la COULEUR d'un centre n'aurait pas de sens : cela
 * creerait deux centres identiques, un cube impossible. Echanger deux faces,
 * au contraire, conserve toujours six centres distincts et les neuf stickers
 * de chaque couleur.
 */
export function echangerFaces(state: Facelets, a: number, b: number): Facelets {
  if (a === b) return state;
  const bloc = (i: number) => state.slice(i * 9, i * 9 + 9);
  const blocA = bloc(a);
  const blocB = bloc(b);
  const cases = [];
  for (let f = 0; f < 6; f++) cases.push(f === a ? blocB : f === b ? blocA : bloc(f));
  return cases.join('');
}

/**
 * Fait tourner UNE face d'un quart de tour, sans toucher au reste.
 *
 * Ce n'est PAS un mouvement de cube — les aretes des faces voisines ne bougent
 * pas. C'est une correction de LECTURE : quand le scan a enregistre une face
 * dans le mauvais sens, ses neuf stickers sont justes mais pivotes. Changer
 * leurs couleurs une par une demanderait huit corrections coordonnees ; ici
 * c'est un geste.
 */
export function tournerFace(state: Facelets, face: number, quarts = 1): Facelets {
  const QUART = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  const base = face * 9;
  let bloc = state.slice(base, base + 9).split('');
  const n = ((quarts % 4) + 4) % 4;
  for (let i = 0; i < n; i++) bloc = QUART.map((j) => bloc[j]);
  return state.slice(0, base) + bloc.join('') + state.slice(base + 9);
}
