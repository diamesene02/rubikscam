/**
 * Cote application : pilote le worker du solveur.
 * Le worker demarre des le chargement pour que la construction des tables
 * (~2 s) soit terminee avant la fin du scan.
 */
import type { SolverResponse } from '../workers/solver.worker';

export interface SolveHandlers {
  /** Appele a chaque solution, la derniere ayant final = true. */
  onSolution(moves: string[], final: boolean): void;
  onError?(message: string): void;
}

export class SolverClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, SolveHandlers>();
  private readyResolve: (() => void) | null = null;
  readonly ready: Promise<void>;
  private initMs = 0;

  constructor() {
    this.worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    this.worker.onmessage = (event: MessageEvent<SolverResponse>) => this.handle(event.data);
    this.worker.postMessage({ type: 'init' });
  }

  get initialisationMs(): number {
    return this.initMs;
  }

  private handle(msg: SolverResponse): void {
    if (msg.type === 'ready') {
      this.initMs = msg.ms;
      this.readyResolve?.();
      this.readyResolve = null;
      return;
    }
    const handlers = this.pending.get(msg.id);
    if (!handlers) return;
    if (msg.type === 'solution') {
      handlers.onSolution(msg.moves, msg.final);
      if (msg.final) this.pending.delete(msg.id);
    } else {
      handlers.onError?.(msg.message);
      this.pending.delete(msg.id);
    }
  }

  solve(facelets: string, handlers: SolveHandlers, timeoutMs = 15000): number {
    const id = this.nextId++;
    this.pending.set(id, handlers);
    this.worker.postMessage({ type: 'solve', id, facelets });
    // Filet de securite : si le worker ne repond pas (cas pathologique), on le
    // remplace plutot que de laisser l'interface bloquee sur "calcul en cours".
    window.setTimeout(() => {
      if (!this.pending.has(id)) return;
      this.pending.delete(id);
      handlers.onError?.('le calcul a pris trop de temps');
      this.redemarrer();
    }, timeoutMs);
    return id;
  }

  private redemarrer(): void {
    this.worker.terminate();
    this.pending.clear();
    this.worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<SolverResponse>) => this.handle(event.data);
    this.worker.postMessage({ type: 'init' });
  }

  solveOnce(facelets: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.solve(facelets, {
        onSolution: (moves, final) => {
          if (final) resolve(moves);
        },
        onError: (message) => reject(new Error(message)),
      });
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
