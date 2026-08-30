declare module 'cubejs' {
  export default class Cube {
    constructor(other?: Cube);
    static fromString(str: string): Cube;
    static random(): Cube;
    static scramble(): string;
    static inverse(alg: string | string[]): string;
    static initSolver(): void;
    static moves: unknown;
    identity(): void;
    randomize(): void;
    isSolved(): boolean;
    clone(): Cube;
    asString(): string;
    move(alg: string): Cube;
    upright(): string;
    solve(maxDepth?: number): string;
    solveUpright(maxDepth?: number): string;
  }
}
