/// <reference lib="webworker" />
/**
 * Solveur Kociemba (deux phases) dans un worker.
 *
 * La construction des tables prend ~2 s : elle demarre des le lancement de
 * l'application, pendant que l'utilisateur scanne, donc elle est toujours
 * terminee au moment ou l'on en a besoin — et l'interface n'est jamais figee.
 *
 * Chaque solution est verifiee avant d'etre renvoyee : on la rejoue sur une
 * copie du cube et on controle qu'il est bien resolu.
 */
import Cube from 'cubejs';

/**
 * Profondeur de recherche. 22 est le bon compromis : la reponse arrive en
 * ~170 ms en moyenne (2,8 s dans le pire cas mesure sur 60 cubes) pour une
 * solution de ~22 mouvements. Descendre a 21 ne gagne que 0,8 mouvement et
 * peut bloquer le worker plusieurs dizaines de secondes, sans possibilite
 * d'interruption : le jeu n'en vaut pas la chandelle pour un humain qui
 * execute les mouvements un par un.
 */
const MAX_DEPTH = 22;

export type SolverRequest =
  | { type: 'init' }
  | { type: 'solve'; id: number; facelets: string };

export type SolverResponse =
  | { type: 'ready'; ms: number }
  | { type: 'solution'; id: number; moves: string[]; final: boolean }
  | { type: 'error'; id: number; message: string };

let ready = false;

function ensureReady(): void {
  if (ready) return;
  const t0 = performance.now();
  Cube.initSolver();
  ready = true;
  post({ type: 'ready', ms: Math.round(performance.now() - t0) });
}

function post(msg: SolverResponse): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function toMoves(solution: string): string[] {
  return solution.trim().split(/\s+/).filter(Boolean);
}

self.onmessage = (event: MessageEvent<SolverRequest>) => {
  const data = event.data;
  if (data.type === 'init') {
    ensureReady();
    return;
  }
  if (data.type !== 'solve') return;

  const { id, facelets } = data;
  try {
    ensureReady();
    const cube = Cube.fromString(facelets);
    if (cube.isSolved()) {
      post({ type: 'solution', id, moves: [], final: true });
      return;
    }

    const moves = toMoves(cube.solve(MAX_DEPTH));

    // Verification systematique : on n'envoie jamais une solution sans avoir
    // verifie qu'elle resout reellement le cube. Une solution fausse coute bien
    // plus cher a l'utilisateur qu'un message d'erreur.
    const controle = Cube.fromString(facelets);
    controle.move(moves.join(' '));
    if (!moves.length || !controle.isSolved()) {
      throw new Error('solution invalide');
    }

    post({ type: 'solution', id, moves, final: true });
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
};
