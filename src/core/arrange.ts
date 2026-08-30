/**
 * Retrouver le placement des 6 faces scannees.
 *
 * Le parcours de scan suppose que l'utilisateur enchaine exactement les gestes
 * demandes. En pratique, dans une piece mal eclairee, avec un enfant sur les
 * genoux, on tourne le cube du mauvais cote une fois sur deux. Les couleurs
 * lues sont alors parfaites — 9 stickers de chaque, ce que confirme le
 * compteur — mais les PIECES sont impossibles : "le coin URF n'existe pas".
 * Aucune correction de couleur ne rattrape cela, parce qu'il n'y a rien a
 * corriger : c'est le placement des faces entre elles qui est faux.
 *
 * On cherche donc, parmi tous les placements possibles (quelle face va a
 * quelle position, et tournee comment), celui qui donne un cube physiquement
 * valide. Sans elagage l'espace fait 6! x 4^6 ; en placant les faces une a une
 * et en verifiant chaque piece des qu'elle est determinee, il s'effondre.
 *
 * Consequence pour l'utilisateur : les gestes affiches deviennent une
 * suggestion, plus une obligation.
 */

import { validate } from './cube';
import {
  CORNER_COLORS,
  CORNER_FACELETS,
  EDGE_FACELETS,
  FACES,
  ORIENTATIONS,
  applyPermStr,
  type Face,
} from './geometry';
import { SCAN_PLAN } from './scanPlan';

/** Au-dela, enumerer d'autres candidats n'aide plus personne a choisir. */
const MAX_CANDIDATS = 8;


/** Permutations des 9 cases pour 0, 90, 180 et 270 degres horaires. */
const ROTS: number[][] = (() => {
  const id = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const quart = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  const compose = (a: number[], b: number[]) => a.map((_, i) => a[b[i]]);
  const r2 = compose(quart, quart);
  return [id, quart, r2, compose(r2, quart)];
})();

/**
 * Ordre de placement choisi pour verifier au plus tot : F, U et R se touchent,
 * donc des la troisieme face on peut controler un coin.
 */
const ORDRE: Face[] = ['F', 'U', 'R', 'L', 'D', 'B'];
const OPPOSE: Record<Face, Face> = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

export interface Arrangement {
  /** Etat du cube en 54 facettes, pret a resoudre. */
  facelets: string;
  /** Position finale de chaque face scannee (index de capture -> position). */
  placement: Face[];
  /** Quarts de tour appliques a chaque face scannee. */
  rotations: number[];
  /** Nombre de faces qui n'etaient pas a la place prevue. */
  deplacees: number;
  /** Nombre de faces qu'il a fallu tourner. */
  tournees: number;
  /**
   * Renommage applique : pour chaque POSITION, le nom du groupe de couleur qui
   * s'y trouve. Indispensable a l'appelant, car le placement rebaptise les
   * faces d'apres la couleur de leur centre : sans ce renommage, une palette
   * indexee sur les noms d'origine peint tous les stickers d'un groupe avec la
   * couleur d'un autre.
   */
  renommage: Record<Face, string>;
  /**
   * Les AUTRES cubes legaux que ces six memes faces peuvent former.
   *
   * Ce n'est pas un defaut de la recherche : l'information manque reellement.
   * Mesure sur 300 scans simules dont deux faces sont echangees, 13 donnent un
   * cube faux — et aucun ne viole le schema de couleurs d'un vrai cube, donc
   * aucune contrainte supplementaire ne les distingue. Le seul juge possible
   * est l'utilisateur, qui a son cube en main : on lui propose les candidats
   * au lieu d'en choisir un en silence.
   */
  alternatives?: string[];
}

interface Contexte {
  /** Couleurs des 54 facettes, remplies au fur et a mesure. */
  cases: (string | null)[];
  /** Positions deja occupees. */
  posees: Set<Face>;
  /** Couleur du centre de chaque position posee. */
  centres: Partial<Record<Face, string>>;
}

/** Les couleurs d'une piece sont-elles compatibles avec un cube ? */
function pieceValide(couleurs: string[], ctx: Contexte): boolean {
  // toutes distinctes
  for (let i = 0; i < couleurs.length; i++) {
    for (let j = i + 1; j < couleurs.length; j++) {
      if (couleurs[i] === couleurs[j]) return false;
    }
  }
  // aucune paire de couleurs opposees : deux faces opposees ne se touchent
  // jamais, donc leurs couleurs ne coexistent sur aucune piece
  for (const pos of ctx.posees) {
    const opp = OPPOSE[pos];
    if (!ctx.posees.has(opp)) continue;
    const a = ctx.centres[pos]!;
    const b = ctx.centres[opp]!;
    if (couleurs.includes(a) && couleurs.includes(b)) return false;
  }
  return true;
}

/**
 * Les trois couleurs d'un coin, une fois traduites en POSITIONS, forment-elles
 * un coin qui existe reellement ?
 *
 * Les bonnes couleurs ne suffisent pas : un coin et son miroir portent le meme
 * ensemble mais ne peuvent pas coexister — une piece n'a qu'une chiralite.
 * Sans ce controle, la recherche explorait des branches physiquement
 * impossibles et rendait, dans 2,8 % des cas, un cube que le solveur ne sait pas
 * resoudre : il cherche alors une solution qui n'existe pas.
 *
 * On ne peut trancher que si les trois couleurs ont deja une position connue —
 * sinon on laisse passer, la verification finale s'en chargera.
 */
function chiraliteCoinPossible(couleurs: string[], ctx: Contexte): boolean {
  const position = new Map<string, Face>();
  for (const f of FACES) {
    const c = ctx.centres[f];
    if (c !== undefined) position.set(c, f);
  }
  const trio = couleurs.map((c) => position.get(c));
  if (trio.some((p) => p === undefined)) return true;
  const cle = [...(trio as Face[])].sort().join('');
  const modele = CORNER_COLORS.find((m) => [...m].sort().join('') === cle);
  if (!modele) return false;
  for (let d = 0; d < 3; d++) {
    if (trio.every((p, i) => p === modele[(i + d) % 3])) return true;
  }
  return false;
}

/** Verifie les pieces entierement determinees par les positions posees. */
function piecesCoherentes(ctx: Contexte): boolean {
  const posee = (facelet: number) => ctx.cases[facelet] !== null;

  const vus = new Set<string>();
  for (const coin of CORNER_FACELETS) {
    if (!coin.every(posee)) continue;
    const couleurs = coin.map((i) => ctx.cases[i]!);
    if (!pieceValide(couleurs, ctx)) return false;
    if (!chiraliteCoinPossible(couleurs, ctx)) return false;
    const cle = [...couleurs].sort().join('');
    if (vus.has(cle)) return false; // deux fois la meme piece
    vus.add(cle);
  }

  const vusAretes = new Set<string>();
  for (const arete of EDGE_FACELETS) {
    if (!arete.every(posee)) continue;
    const couleurs = arete.map((i) => ctx.cases[i]!);
    if (!pieceValide(couleurs, ctx)) return false;
    const cle = [...couleurs].sort().join('');
    if (vusAretes.has(cle)) return false;
    vusAretes.add(cle);
  }
  return true;
}

/** Placement attendu : celui que le parcours de scan demande a l'utilisateur. */
const PLACEMENT_ATTENDU: Face[] = SCAN_PLAN.map((s) => s.face);

/**
 * Deux lectures decrivent-elles le MEME cube, a une rotation d'ensemble pres ?
 * Une rotation permute les positions et renomme les faces : oublier le
 * renommage ferait passer chaque rotation pour un cube different.
 */
export function memeCubeAUneRotationPres(a: string, b: string): boolean {
  return ORIENTATIONS.some(
    (o) => [...applyPermStr(a, o.perm)].map((c) => o.faceMap[c as Face]).join('') === b,
  );
}

/**
 * Cherche un placement des faces scannees qui rende le cube valide.
 * @param faces 6 faces de 9 couleurs, dans l'ordre de capture.
 * @param prefere placement attendu : il est essaye en premier, pour que le cas
 *        normal soit trouve immediatement et signale comme "rien a corriger".
 */
export function findValidArrangement(
  faces: string[][],
  prefere: Face[] = PLACEMENT_ATTENDU,
  maxDeplacements = 6,
): Arrangement | null {
  if (faces.length !== 6 || faces.some((f) => f.length !== 9)) return null;

  // Approfondissement progressif : on cherche d'abord une explication sans
  // aucun deplacement, puis a un deplacement pres, etc. Sans cela la recherche
  // renvoie la premiere solution rencontree, qui peut etre tres eloignee du
  // scan reel — et transformer une lecture douteuse en cube VALIDE MAIS FAUX,
  // qu'on resoudrait sans jamais s'en apercevoir.
  //
  // Seuls les DEPLACEMENTS comptent. Une face tournee n'est pas une erreur de
  // l'utilisateur : le detecteur ignore ou est le haut du cube, une rotation
  // est donc attendue et gratuite.
  // Approfondissement progressif : la premiere explication trouvee est la
  // moins couteuse. Explorer un cran de budget de plus a ete mesure : 3,5 fois
  // plus lent, et le vrai cube n'etait pas mieux couvert (8 cas sur 9 dans les
  // deux cas). On s'en tient donc au budget minimal.
  let retenu: Arrangement | null = null;
  for (let budget = 0; budget <= maxDeplacements; budget++) {
    const trouve = chercher(faces, prefere, budget);
    if (trouve) {
      retenu = trouve;
      break;
    }
  }
  return retenu;
}

function chercher(
  faces: string[][],
  prefere: Face[],
  budget: number,
): Arrangement | null {

  const ctx: Contexte = { cases: new Array(54).fill(null), posees: new Set(), centres: {} };
  // Le chemin courant, empile et depile avec la recursion. Rapporter le
  // placement depuis des tableaux mutes laisserait trainer les valeurs des
  // branches abandonnees.
  const chemin: { k: number; pos: Face; rot: number }[] = [];
  const utilisees = new Set<number>();
  let cout = 0;
  let resultat: Arrangement | null = null;
  const distincts: string[] = [];

  // Ordre d'essai des faces scannees : d'abord celle que le parcours attendait
  // a cette position, pour que le cas normal soit trouve immediatement.
  const candidatsPour = (pos: Face): number[] => {
    const attendu = prefere.indexOf(pos);
    const autres = [0, 1, 2, 3, 4, 5].filter((k) => k !== attendu);
    return attendu >= 0 ? [attendu, ...autres] : autres;
  };

  const placer = (profondeur: number): boolean => {
    if (profondeur === ORDRE.length) {
      const brut = ctx.cases.join('');
      // renommage : la couleur du centre de chaque position devient son nom
      const nom = new Map<string, string>();
      for (const f of FACES) nom.set(ctx.centres[f]!, f);
      if (nom.size !== 6) return false;
      const facelets = [...brut].map((c) => nom.get(c) ?? '?').join('');
      if (!validate(facelets).ok) return false;
      const placement = new Array<Face>(6);
      const rotations = new Array<number>(6);
      for (const etape of chemin) {
        placement[etape.k] = etape.pos;
        rotations[etape.k] = etape.rot;
      }
      const renommage = {} as Record<Face, string>;
      for (const f of FACES) renommage[f] = ctx.centres[f]!;
      const candidat: Arrangement = {
        facelets,
        placement,
        rotations,
        renommage,
        deplacees: placement.filter((p, k) => p !== prefere[k]).length,
        tournees: rotations.filter((r) => r !== 0).length,
      };
      if (!resultat) resultat = candidat;
      // On continue d'explorer : ce qui compte n'est pas de trouver UNE
      // explication, mais de savoir si plusieurs cubes DIFFERENTS expliquent
      // ces six faces. Les redites (meme cube vu autrement) sont ignorees.
      if (!distincts.some((d) => memeCubeAUneRotationPres(candidat.facelets, d))) {
        distincts.push(candidat.facelets);
        if (distincts.length >= MAX_CANDIDATS) return true;
      }
      return false;
    }

    const pos = ORDRE[profondeur];
    const base = FACES.indexOf(pos) * 9;
    for (const k of candidatsPour(pos)) {
      if (utilisees.has(k)) continue;
      const coutPlace = prefere[k] === pos ? 0 : 1;
      if (cout + coutPlace > budget) continue;
      utilisees.add(k);
      for (let rot = 0; rot < 4; rot++) {
        const src = faces[k];
        for (let i = 0; i < 9; i++) ctx.cases[base + i] = src[ROTS[rot][i]];
        ctx.posees.add(pos);
        ctx.centres[pos] = src[4];
        chemin.push({ k, pos, rot });
        cout += coutPlace;
        if (piecesCoherentes(ctx) && placer(profondeur + 1)) return true;
        cout -= coutPlace;
        chemin.pop();
        ctx.posees.delete(pos);
        delete ctx.centres[pos];
        for (let i = 0; i < 9; i++) ctx.cases[base + i] = null;
      }
      utilisees.delete(k);
    }
    return false;
  };

  placer(0);
  if (resultat) (resultat as Arrangement).alternatives = distincts.slice(1);
  return resultat;
}
