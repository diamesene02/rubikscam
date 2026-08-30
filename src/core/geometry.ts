/**
 * Geometrie du cube 3x3.
 *
 * Tout (permutations des 18 mouvements, 24 orientations du cube, tables
 * coins/aretes) est DERIVE d'un modele 3D explicite, jamais tape a la main :
 * chaque facette est un couple (position, normale) dans {-1,0,1}^3, et un
 * mouvement est une rotation de 90 deg appliquee aux facettes d'une couche.
 *
 * Repere monde (main droite) : x = droite, y = haut, z = vers l'observateur.
 * Index des facettes : U(0-8) R(9-17) F(18-26) D(27-35) L(36-44) B(45-53),
 * chaque face lue ligne par ligne (r=0 en haut, c=0 a gauche) vue de
 * l'exterieur — c'est la convention Kociemba utilisee par le solveur.
 */

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Face = (typeof FACES)[number];

export type V3 = readonly [number, number, number];
export type Perm = Int32Array;

export const FACE_ORDER: Record<Face, number> = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };

/** Normale sortante de chaque face. */
export const FACE_NORMAL: Record<Face, V3> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};

/** Vecteur "haut" de chaque face, vue de l'exterieur (definit r=0). */
export const FACE_UP: Record<Face, V3> = {
  U: [0, 0, -1], // en regardant U d'en haut, le haut de l'image est l'arriere
  R: [0, 1, 0],
  F: [0, 1, 0],
  D: [0, 0, 1], // en regardant D d'en bas, le haut de l'image est l'avant
  L: [0, 1, 0],
  B: [0, 1, 0],
};

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** Vecteur "droite" de chaque face vue de l'exterieur (definit c=0..2). */
export const FACE_RIGHT: Record<Face, V3> = Object.fromEntries(
  FACES.map((f) => [f, cross(FACE_UP[f], FACE_NORMAL[f])]),
) as Record<Face, V3>;

/** Direction "bas" dans l'image de la face (r croissant). */
export const FACE_DOWN: Record<Face, V3> = Object.fromEntries(
  FACES.map((f) => [f, scale(FACE_UP[f], -1)]),
) as Record<Face, V3>;

export interface FaceletGeom {
  index: number;
  face: Face;
  row: number;
  col: number;
  /** Position du centre du sticker, composantes dans {-1,0,1}. */
  pos: V3;
  /** Normale sortante (= normale de la face). */
  normal: V3;
}

function buildFacelets(): FaceletGeom[] {
  const out: FaceletGeom[] = [];
  for (const face of FACES) {
    const n = FACE_NORMAL[face];
    const up = FACE_UP[face];
    const right = FACE_RIGHT[face];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const pos = add(add(n, scale(up, 1 - r)), scale(right, c - 1));
        out.push({ index: FACE_ORDER[face] * 9 + r * 3 + c, face, row: r, col: c, pos, normal: n });
      }
    }
  }
  return out;
}

export const FACELETS: readonly FaceletGeom[] = buildFacelets();

const key = (pos: V3, normal: V3) =>
  `${pos[0]},${pos[1]},${pos[2]}|${normal[0]},${normal[1]},${normal[2]}`;

const FACELET_BY_KEY = new Map<string, number>();
for (const f of FACELETS) FACELET_BY_KEY.set(key(f.pos, f.normal), f.index);

/**
 * Rotation de -90 deg * `times` autour de l'axe donne (0=x, 1=y, 2=z).
 * -90 deg autour de +axe = "sens horaire vu depuis l'exterieur de +axe",
 * c'est la convention des mouvements du cube (R, U, F...).
 */
export function rotateV(v: V3, axis: 0 | 1 | 2, times: number): V3 {
  let [x, y, z] = v;
  const t = ((times % 4) + 4) % 4;
  for (let i = 0; i < t; i++) {
    if (axis === 0) [x, y, z] = [x, z, -y];
    else if (axis === 1) [x, y, z] = [-z, y, x];
    else [x, y, z] = [y, -x, z];
  }
  return [x, y, z];
}

export function identityPerm(): Perm {
  const p = new Int32Array(54);
  for (let i = 0; i < 54; i++) p[i] = i;
  return p;
}

/** `applyPerm(s, p)[j] === s[p[j]]` : la facette p[j] arrive en position j. */
export function applyPerm<T>(state: ArrayLike<T>, perm: Perm): T[] {
  const out = new Array<T>(54);
  for (let j = 0; j < 54; j++) out[j] = state[perm[j]];
  return out;
}

export function applyPermStr(state: string, perm: Perm): string {
  let out = '';
  for (let j = 0; j < 54; j++) out += state[perm[j]];
  return out;
}

/** Composition : appliquer `a` puis `b`. */
export function composePerm(a: Perm, b: Perm): Perm {
  const out = new Int32Array(54);
  for (let j = 0; j < 54; j++) out[j] = a[b[j]];
  return out;
}

export function invertPerm(p: Perm): Perm {
  const out = new Int32Array(54);
  for (let j = 0; j < 54; j++) out[p[j]] = j;
  return out;
}

function axisOf(n: V3): { axis: 0 | 1 | 2; sign: number } {
  if (n[0] !== 0) return { axis: 0, sign: n[0] };
  if (n[1] !== 0) return { axis: 1, sign: n[1] };
  return { axis: 2, sign: n[2] };
}

/**
 * Permutation d'une rotation. `layer` : si defini, seules les facettes de la
 * couche portee par la face sont bougees (mouvement) ; sinon tout le cube tourne.
 */
function rotationPerm(face: Face, quarters: number, wholeCube: boolean): Perm {
  const n = FACE_NORMAL[face];
  const { axis, sign } = axisOf(n);
  const times = sign > 0 ? quarters : -quarters;
  const perm = identityPerm();
  for (const f of FACELETS) {
    if (!wholeCube && dot(f.pos, n) !== 1) continue;
    const np = rotateV(f.pos, axis, times);
    const nn = rotateV(f.normal, axis, times);
    const target = FACELET_BY_KEY.get(key(np, nn));
    if (target === undefined) throw new Error(`facette introuvable pour ${face}`);
    perm[target] = f.index;
  }
  return perm;
}

export const MOVE_FACES = FACES;
export type MoveSuffix = '' | "'" | '2';
export type Move = `${Face}${MoveSuffix}`;

export const MOVES: readonly Move[] = FACES.flatMap(
  (f) => [`${f}`, `${f}'`, `${f}2`] as Move[],
);

const MOVE_PERMS = new Map<string, Perm>();
for (const f of FACES) {
  MOVE_PERMS.set(f, rotationPerm(f, 1, false));
  MOVE_PERMS.set(`${f}'`, rotationPerm(f, -1, false));
  MOVE_PERMS.set(`${f}2`, rotationPerm(f, 2, false));
}

/** Rotations du cube entier : x (comme R), y (comme U), z (comme F). */
export const ROTATIONS = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'] as const;
export type Rotation = (typeof ROTATIONS)[number];

const ROTATION_FACE: Record<'x' | 'y' | 'z', Face> = { x: 'R', y: 'U', z: 'F' };

const ROTATION_PERMS = new Map<string, Perm>();
for (const r of ['x', 'y', 'z'] as const) {
  const face = ROTATION_FACE[r];
  ROTATION_PERMS.set(r, rotationPerm(face, 1, true));
  ROTATION_PERMS.set(`${r}'`, rotationPerm(face, -1, true));
  ROTATION_PERMS.set(`${r}2`, rotationPerm(face, 2, true));
}

export function permOf(token: string): Perm {
  const p = MOVE_PERMS.get(token) ?? ROTATION_PERMS.get(token);
  if (!p) throw new Error(`mouvement inconnu : ${token}`);
  return p;
}

export function isMoveToken(token: string): token is Move {
  return MOVE_PERMS.has(token);
}

export function isRotationToken(token: string): token is Rotation {
  return ROTATION_PERMS.has(token);
}

export function parseAlg(alg: string): string[] {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[’‘`]/g, "'").replace(/^([A-Za-z])(?:i|-)$/, "$1'"))
    .map((t) => {
      const m = /^([URFDLBxyz])(2|'|)$/.exec(t);
      if (!m) throw new Error(`token invalide : ${t}`);
      return m[1] + m[2];
    });
}

export function permOfAlg(alg: string | string[]): Perm {
  const tokens = Array.isArray(alg) ? alg : parseAlg(alg);
  let p = identityPerm();
  for (const t of tokens) p = composePerm(p, permOf(t));
  return p;
}

export function invertMove(move: string): string {
  if (move.endsWith('2')) return move;
  if (move.endsWith("'")) return move.slice(0, -1);
  return move + "'";
}

export function invertAlg(alg: string | string[]): string[] {
  const tokens = Array.isArray(alg) ? alg : parseAlg(alg);
  return tokens.slice().reverse().map(invertMove);
}

// ---------------------------------------------------------------------------
// Orientations : les 24 facons de tenir le cube
// ---------------------------------------------------------------------------

export interface Orientation {
  /** Permutation des facettes correspondant a cette rotation du cube. */
  perm: Perm;
  /** faceMap[A] = position occupee par la face absolue A apres rotation. */
  faceMap: Record<Face, Face>;
  /** faceMapInv[P] = face absolue qui occupe la position P. */
  faceMapInv: Record<Face, Face>;
  /** Suite de rotations la plus courte menant a cette orientation. */
  word: string[];
}

function faceOfNormal(n: V3): Face {
  for (const f of FACES) {
    const m = FACE_NORMAL[f];
    if (m[0] === n[0] && m[1] === n[1] && m[2] === n[2]) return f;
  }
  throw new Error('normale invalide');
}

function orientationFromWord(word: string[]): Orientation {
  const perm = word.length ? permOfAlg(word) : identityPerm();
  // La rotation geometrique globale correspondante, appliquee aux normales.
  const faceMap = {} as Record<Face, Face>;
  const faceMapInv = {} as Record<Face, Face>;
  for (const f of FACES) {
    let n = FACE_NORMAL[f];
    for (const t of word) {
      const base = t[0] as 'x' | 'y' | 'z';
      const { axis, sign } = axisOf(FACE_NORMAL[ROTATION_FACE[base]]);
      const q = t.endsWith("'") ? -1 : t.endsWith('2') ? 2 : 1;
      n = rotateV(n, axis, sign > 0 ? q : -q);
    }
    const target = faceOfNormal(n);
    faceMap[f] = target;
    faceMapInv[target] = f;
  }
  return { perm, faceMap, faceMapInv, word };
}

function buildOrientations(): Orientation[] {
  const seen = new Map<string, Orientation>();
  const start = orientationFromWord([]);
  seen.set(start.perm.join(','), start);
  let frontier: Orientation[] = [start];
  const gens: Rotation[] = ['x', "x'", 'y', "y'", 'z', "z'"];
  while (frontier.length) {
    const next: Orientation[] = [];
    for (const o of frontier) {
      for (const g of gens) {
        const word = [...o.word, g];
        const cand = orientationFromWord(word);
        const k = cand.perm.join(',');
        if (!seen.has(k)) {
          seen.set(k, cand);
          next.push(cand);
        }
      }
    }
    frontier = next;
  }
  return [...seen.values()];
}

export const ORIENTATIONS: readonly Orientation[] = buildOrientations();

/**
 * Distance entre deux prises, en QUARTS DE TOUR du cube entier.
 *
 * C'est la mesure du travail reel demande a l'utilisateur : reposer son cube
 * d'un quart de tour est un geste, de trois quarts en est trois. Choisir une
 * prise sans regarder ou sont ses mains revient a ignorer ce cout.
 *
 * Table 24x24 calculee une fois par parcours en largeur sur les six generateurs.
 */
const DISTANCE_PRISES: number[][] = (() => {
  const index = new Map<string, number>();
  ORIENTATIONS.forEach((o, i) => index.set(o.perm.join(','), i));
  const gens: Rotation[] = ['x', "x'", 'y', "y'", 'z', "z'"];
  const voisins = ORIENTATIONS.map((o) =>
    gens
      .map((g) => index.get(composePerm(o.perm, permOf(g)).join(',')))
      .filter((v): v is number => v !== undefined),
  );
  return ORIENTATIONS.map((_, depart) => {
    const d = new Array<number>(ORIENTATIONS.length).fill(Infinity);
    d[depart] = 0;
    const file = [depart];
    for (let t = 0; t < file.length; t++) {
      const a = file[t];
      for (const b of voisins[a]) {
        if (d[b] !== Infinity) continue;
        d[b] = d[a] + 1;
        file.push(b);
      }
    }
    return d;
  });
})();

const RANG_PRISE = new Map<string, number>();
ORIENTATIONS.forEach((o, i) => RANG_PRISE.set(o.perm.join(','), i));

/** Quarts de tour du cube entier separant deux prises. */
export function distancePrise(a: Orientation, b: Orientation): number {
  const ia = RANG_PRISE.get(a.perm.join(','));
  const ib = RANG_PRISE.get(b.perm.join(','));
  if (ia === undefined || ib === undefined) return Infinity;
  return DISTANCE_PRISES[ia][ib];
}

export const IDENTITY_ORIENTATION: Orientation = ORIENTATIONS.find((o) => o.word.length === 0)!;

/** Orientation dont faceMapInv correspond a la face vue + la face en haut. */
export function orientationWith(frontIs: Face, upIs: Face): Orientation | null {
  return (
    ORIENTATIONS.find((o) => o.faceMapInv.F === frontIs && o.faceMapInv.U === upIs) ?? null
  );
}

// ---------------------------------------------------------------------------
// Cubies : tables coins / aretes derivees de la geometrie
// ---------------------------------------------------------------------------

export const CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'] as const;
export const EDGE_NAMES = [
  'UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR',
] as const;
export type CornerName = (typeof CORNER_NAMES)[number];
export type EdgeName = (typeof EDGE_NAMES)[number];

function posOfName(name: string): V3 {
  let v: V3 = [0, 0, 0];
  for (const ch of name) v = add(v, FACE_NORMAL[ch as Face]);
  return v;
}

function faceletAt(pos: V3, normal: V3): number {
  const idx = FACELET_BY_KEY.get(key(pos, normal));
  if (idx === undefined) throw new Error('facette introuvable');
  return idx;
}

/**
 * Facettes d'un coin, dans l'ordre horaire vu de l'exterieur, en commencant
 * par la facette U/D (convention standard pour l'orientation des coins).
 */
function cornerFacelets(name: CornerName): [number, number, number] {
  const pos = posOfName(name);
  const ex: V3 = [pos[0], 0, 0];
  const ey: V3 = [0, pos[1], 0];
  const ez: V3 = [0, 0, pos[2]];
  const det = pos[0] * pos[1] * pos[2];
  const order: V3[] = det > 0 ? [ey, ex, ez] : [ey, ez, ex];
  return order.map((n) => faceletAt(pos, n)) as [number, number, number];
}

/**
 * Facettes d'une arete : la facette "de reference" d'abord (U/D pour les
 * aretes des couches U/D, F/B pour les aretes de la tranche du milieu).
 */
function edgeFacelets(name: EdgeName): [number, number] {
  const pos = posOfName(name);
  const normals: V3[] = [];
  if (pos[0] !== 0) normals.push([pos[0], 0, 0]);
  if (pos[1] !== 0) normals.push([0, pos[1], 0]);
  if (pos[2] !== 0) normals.push([0, 0, pos[2]]);
  const rank = (n: V3) => (n[1] !== 0 ? 0 : n[2] !== 0 ? 1 : 2);
  normals.sort((a, b) => rank(a) - rank(b));
  return [faceletAt(pos, normals[0]), faceletAt(pos, normals[1])] as [number, number];
}

export const CORNER_FACELETS: readonly (readonly [number, number, number])[] =
  CORNER_NAMES.map(cornerFacelets);
export const EDGE_FACELETS: readonly (readonly [number, number])[] = EDGE_NAMES.map(edgeFacelets);

/** Couleur resolue d'une facette (= lettre de sa face). */
export function solvedColorAt(index: number): Face {
  return FACES[Math.floor(index / 9)];
}

export const CORNER_COLORS: readonly (readonly [Face, Face, Face])[] = CORNER_FACELETS.map(
  (t) => t.map(solvedColorAt) as [Face, Face, Face],
);
export const EDGE_COLORS: readonly (readonly [Face, Face])[] = EDGE_FACELETS.map(
  (t) => t.map(solvedColorAt) as [Face, Face],
);

export const CENTER_INDEX: Record<Face, number> = Object.fromEntries(
  FACES.map((f) => [f, FACE_ORDER[f] * 9 + 4]),
) as Record<Face, number>;
