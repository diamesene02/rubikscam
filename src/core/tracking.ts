/**
 * Suivi temps reel pendant la resolution.
 *
 * L'idee qui rend le guidage a la fois fluide et robuste : comme on connait
 * l'etat COMPLET du cube, on peut simuler tout ce que l'utilisateur a pu faire
 * et comparer avec la seule face que voit la camera. On teste :
 *
 *   - les 24 facons de tenir le cube (l'utilisateur peut le retourner dans sa
 *     main : on s'y adapte au lieu de lui demander de ne pas bouger) ;
 *   - "rien n'a ete fait", puis les 1, 2, 3 prochains mouvements attendus
 *     (l'anticipation gere les mouvements de la face arriere, invisibles pour
 *     la camera : on les rattrape des que le suivant devient visible) ;
 *   - les 18 mouvements possibles, pour reconnaitre une ERREUR et repartir de
 *     l'etat reel plutot que de laisser l'utilisateur dans le vide.
 *
 * Cela fait 24 x (4 + 18) comparaisons de 9 stickers : negligeable, et cela
 * remplace toute une machinerie de vision par de la deduction exacte.
 */

import {
  FACES,
  IDENTITY_ORIENTATION,
  MOVES,
  ORIENTATIONS,
  applyPermStr,
  composePerm,
  permOf,
  permOfAlg,
  type Face,
  type Orientation,
} from './geometry';
import { isSolved } from './cube';

export interface Observation {
  labels: Face[];
  confidence?: number[];
}

export interface MatchCandidate {
  /** Mouvements a appliquer a l'etat de reference pour expliquer l'image. */
  moves: string[];
  orientation: Orientation;
  /** Part des stickers expliques, ponderee par la confiance [0..1]. */
  score: number;
  /** Vrai si l'explication sort de la solution prevue. */
  deviation: boolean;
}

export interface MatchOptions {
  /** Nombre de mouvements attendus testes d'avance. */
  lookahead?: number;
  /** Tester aussi les mouvements imprevus (erreur de l'utilisateur). */
  allowDeviation?: boolean;
  /** Preference pour l'orientation deja retenue, evite les oscillations. */
  stickiness?: number;
}

function scoreFace(expected: string, obs: Observation): number {
  let good = 0;
  let total = 0;
  for (let i = 0; i < 9; i++) {
    const w = Math.max(0.15, obs.confidence?.[i] ?? 1);
    total += w;
    if (obs.labels[i] === expected[i]) good += w;
  }
  return total > 0 ? good / total : 0;
}

/** Face vue par la camera si le cube `state` est tenu selon `orientation`. */
export function visibleFace(state: string, orientation: Orientation): string {
  return applyPermStr(state, orientation.perm).slice(18, 27);
}

export function matchObservation(
  cube: string,
  upcoming: string[],
  observation: Observation,
  current: Orientation = IDENTITY_ORIENTATION,
  options: MatchOptions = {},
): MatchCandidate[] {
  const { lookahead = 3, allowDeviation = true, stickiness = 0.02 } = options;

  const hypotheses: Array<{ state: string; moves: string[]; deviation: boolean }> = [];
  let state = cube;
  hypotheses.push({ state, moves: [], deviation: false });
  for (let i = 0; i < Math.min(lookahead, upcoming.length); i++) {
    state = applyPermStr(state, permOf(upcoming[i]));
    hypotheses.push({ state, moves: upcoming.slice(0, i + 1), deviation: false });
  }
  if (allowDeviation) {
    const expected = upcoming.length ? upcoming[0] : null;
    for (const m of MOVES) {
      if (m === expected) continue;
      hypotheses.push({ state: applyPermStr(cube, permOf(m)), moves: [m], deviation: true });
    }
  }

  const results: MatchCandidate[] = [];
  for (const h of hypotheses) {
    for (const o of ORIENTATIONS) {
      let score = scoreFace(visibleFace(h.state, o), observation);
      if (o === current) score += stickiness;
      // a explication egale, la plus simple gagne
      score -= h.moves.length * 0.004;
      if (h.deviation) score -= 0.01;
      results.push({ moves: h.moves, orientation: o, score, deviation: h.deviation });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

export type TrackEvent =
  | { kind: 'inchange' }
  | { kind: 'avance'; moves: string[]; resolu: boolean }
  | { kind: 'ecart'; move: string }
  | { kind: 'reoriente'; orientation: Orientation }
  | { kind: 'incoherent' };

export interface SessionOptions {
  /** Score minimal pour accepter une explication. */
  threshold?: number;
  /** Lectures stables consecutives requises avant d'agir. */
  hold?: number;
  /**
   * La camera a-t-elle le droit d'expliquer l'image par un mouvement IMPREVU,
   * et donc de reecrire l'etat memorise ?
   *
   * Mesure sur des solutions reelles, avec une camera PARFAITE : 13,4 % des
   * etapes produisent un faux « ecart » au moment ou l'utilisateur reoriente
   * son cube — soit environ trois destructions d'etat par resolution, chacune
   * repartant d'un cube qui n'existe pas, avec pleine confiance.
   *
   * En lecture seule, la camera ne peut plus que faire AVANCER dans la
   * solution ou dire qu'elle ne reconnait rien. Un ecart soupconne se propose,
   * il ne s'applique jamais tout seul.
   */
  allowDeviation?: boolean;
}

/**
 * Etat de la session de resolution : cube reel, solution restante et facon dont
 * l'utilisateur tient le cube.
 */
/** Les quatre rotations d'une lecture 3x3, dans le sens horaire. */
const ROTATIONS_LECTURE: number[][] = (() => {
  const identite = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const quart = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  const composer = (a: number[], b: number[]) => a.map((_, i) => a[b[i]]);
  const demi = composer(quart, quart);
  return [identite, quart, demi, composer(demi, quart)];
})();

/**
 * La face observee existe-t-elle quelque part dans l'etat memorise ?
 *
 * C'est la question qui separe les deux causes d'un « cube non reconnu », que
 * rien ne distinguait jusqu'ici :
 *
 *  - la face EXISTE dans l'etat mais le suivi n'arrive pas a la situer : c'est
 *    un probleme d'angle, de lumiere ou de mouvement hors champ ;
 *  - la face n'existe NULLE PART : l'etat memorise ne decrit pas ce cube, donc
 *    le scan etait faux et suivre la solution ne menerait a rien.
 *
 * On compare a chacune des 6 faces, dans chacune de ses 4 rotations, et on
 * garde la meilleure concordance.
 */
export function meilleureCorrespondanceFace(
  labels: readonly string[],
  cube: string,
): { score: number; face: Face; rotation: number } {
  let meilleur: { score: number; face: Face; rotation: number } = {
    score: -1,
    face: FACES[0],
    rotation: 0,
  };
  for (const [f, face] of FACES.entries()) {
    const attendue = cube.slice(f * 9, f * 9 + 9);
    for (const [r, rotation] of ROTATIONS_LECTURE.entries()) {
      let bons = 0;
      for (let i = 0; i < 9; i++) if (labels[rotation[i]] === attendue[i]) bons++;
      if (bons > meilleur.score) meilleur = { score: bons, face, rotation: r };
    }
  }
  return meilleur;
}

export class SolveSession {
  cube: string;
  solution: string[];
  index = 0;
  orientation: Orientation;
  private readonly threshold: number;
  private readonly hold: number;
  private readonly allowDeviation: boolean;
  private streakKey = '';
  private streak = 0;

  constructor(
    cube: string,
    solution: string[] = [],
    orientation: Orientation = IDENTITY_ORIENTATION,
    options: SessionOptions = {},
  ) {
    this.cube = cube;
    this.solution = solution;
    this.orientation = orientation;
    this.threshold = options.threshold ?? 0.86;
    this.hold = options.hold ?? 2;
    this.allowDeviation = options.allowDeviation ?? true;
  }

  get remaining(): string[] {
    return this.solution.slice(this.index);
  }

  get currentMove(): string | null {
    return this.solution[this.index] ?? null;
  }

  get finished(): boolean {
    return this.index >= this.solution.length;
  }

  get solved(): boolean {
    return isSolved(this.cube);
  }

  setSolution(moves: string[]): void {
    this.solution = moves;
    this.index = 0;
    this.streak = 0;
    this.streakKey = '';
  }

  /** Avance manuellement de n mouvements (bouton "suivant"). */
  advance(n = 1): void {
    for (let i = 0; i < n && !this.finished; i++) {
      this.cube = applyPermStr(this.cube, permOf(this.solution[this.index]));
      this.index++;
    }
    this.streak = 0;
  }

  /** Revient en arriere (bouton "precedent"). */
  back(n = 1): void {
    for (let i = 0; i < n && this.index > 0; i++) {
      this.index--;
      const m = this.solution[this.index];
      const inverse = m.endsWith('2') ? m : m.endsWith("'") ? m.slice(0, -1) : m + "'";
      this.cube = applyPermStr(this.cube, permOf(inverse));
    }
    this.streak = 0;
  }

  /**
   * Un mouvement est INVISIBLE si, dans la facon dont le cube est tenu, il ne
   * change rien a la face que voit la camera (typiquement la face arriere).
   * On ne pourra donc jamais le confirmer isolement.
   */
  isInvisible(move: string, from: string = this.cube): boolean {
    const before = visibleFace(from, this.orientation);
    const after = visibleFace(applyPermStr(from, permOf(move)), this.orientation);
    return before === after;
  }

  /**
   * Mouvements a annoncer maintenant : le prochain, et tant qu'il est
   * invisible, celui d'apres. Sans ce groupage, l'application attendrait la
   * confirmation d'un mouvement qu'elle ne peut pas voir pendant que
   * l'utilisateur attend la consigne suivante — blocage garanti.
   */
  instructionGroup(max = 3): string[] {
    const group: string[] = [];
    let state = this.cube;
    for (let i = this.index; i < this.solution.length && group.length < max; i++) {
      const move = this.solution[i];
      group.push(move);
      const invisible = this.isInvisible(move, state);
      state = applyPermStr(state, permOf(move));
      if (!invisible) break;
    }
    return group;
  }

  /**
   * Le groupe de consignes change-t-il quelque chose a l'image ? Si non, la
   * camera ne pourra pas le valider : c'est a l'utilisateur de confirmer.
   * Cela arrive quand plusieurs mouvements consecutifs n'affectent pas la face
   * visible (typiquement des mouvements de la face arriere).
   */
  groupeObservable(groupe: string[] = this.instructionGroup()): boolean {
    if (!groupe.length) return false;
    const avant = visibleFace(this.cube, this.orientation);
    let etat = this.cube;
    for (const m of groupe) etat = applyPermStr(etat, permOf(m));
    return visibleFace(etat, this.orientation) !== avant;
  }

  /** Mouvement absolu traduit dans le repere de l'utilisateur. */
  displayMove(move: string, viewpoint: Orientation = this.orientation): string {
    const face = viewpoint.faceMap[move[0] as Face];
    return face + move.slice(1);
  }

  /**
   * Integre une lecture de la face visible. Renvoie ce qui s'est passe.
   * Une explication doit etre confirmee sur `hold` lectures consecutives avant
   * d'etre appliquee : cela evite de reagir a une image floue.
   */
  observe(observation: Observation): TrackEvent {
    const candidates = matchObservation(this.cube, this.remaining, observation, this.orientation, {
      allowDeviation: this.allowDeviation,
    });
    const best = candidates[0];
    if (!best || best.score < this.threshold) {
      this.streak = 0;
      this.streakKey = '';
      return { kind: 'incoherent' };
    }

    const key = `${best.moves.join(' ')}|${best.orientation.word.join(' ')}|${best.deviation}`;
    if (key === this.streakKey) this.streak++;
    else {
      this.streakKey = key;
      this.streak = 1;
    }

    const reoriented = best.orientation !== this.orientation;
    if (!best.moves.length) {
      if (reoriented && this.streak >= this.hold) {
        this.orientation = best.orientation;
        this.streak = 0;
        return { kind: 'reoriente', orientation: best.orientation };
      }
      return { kind: 'inchange' };
    }

    if (this.streak < this.hold) return { kind: 'inchange' };
    this.streak = 0;
    this.orientation = best.orientation;

    if (best.deviation) {
      const move = best.moves[0];
      this.cube = applyPermStr(this.cube, permOf(move));
      this.solution = [];
      this.index = 0;
      return { kind: 'ecart', move };
    }

    this.cube = applyPermStr(this.cube, permOfAlg(best.moves));
    this.index += best.moves.length;
    return { kind: 'avance', moves: best.moves, resolu: this.solved };
  }
}

/** Orientation du point de vue de l'utilisateur selon la camera utilisee. */
export function userViewpoint(
  orientation: Orientation,
  faceToFace: boolean,
): Orientation {
  if (!faceToFace) return orientation;
  // Camera frontale (webcam) : l'utilisateur voit la face opposee a celle que
  // voit la camera, et sa gauche/droite sont inversees. Une demi-rotation
  // autour de la verticale exprime exactement ce changement de point de vue.
  const y2 = ORIENTATIONS.find((o) => o.word.join(' ') === 'y2' || o.word.join(' ') === "y' y'");
  const target = y2 ?? ORIENTATIONS.find((o) => o.faceMap.F === 'B' && o.faceMap.U === 'U')!;
  const perm = composePerm(orientation.perm, target.perm);
  const key = perm.join(',');
  return ORIENTATIONS.find((o) => o.perm.join(',') === key) ?? orientation;
}
