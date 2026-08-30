import { describe, it, expect } from 'vitest';
import { SolveSession, visibleFace, userViewpoint, matchObservation } from '../src/core/tracking';
import { SOLVED_FACELETS, applyAlg, applyMove, randomScramble } from '../src/core/cube';
import {
  IDENTITY_ORIENTATION,
  MOVES,
  ORIENTATIONS,
  applyPermStr,
  permOf,
  invertMove,
  type Face,
  type Orientation,
} from '../src/core/geometry';

/** Cube physique tenu par un utilisateur simule. */
class VirtualUser {
  constructor(
    public state: string,
    public orientation: Orientation = IDENTITY_ORIENTATION,
  ) {}
  /** Tourne une face (notation absolue). */
  turn(move: string): void {
    this.state = applyPermStr(this.state, permOf(move));
  }
  /** Retourne le cube dans la main. */
  hold(o: Orientation): void {
    this.orientation = o;
  }
  look(noise = 0): { labels: Face[]; confidence: number[] } {
    const face = visibleFace(this.state, this.orientation);
    const labels = face.split('') as Face[];
    const confidence = labels.map(() => 0.9);
    for (let i = 0; i < noise; i++) {
      const k = (i * 5 + 3) % 9;
      labels[k] = (['U', 'R', 'F', 'D', 'L', 'B'] as Face[])[(i * 3 + 1) % 6];
      confidence[k] = 0.1;
    }
    return { labels, confidence };
  }
}

/** Envoie plusieurs lectures et renvoie le premier evenement significatif. */
function feed(session: SolveSession, user: VirtualUser, times = 3, noise = 0) {
  let significant: ReturnType<SolveSession['observe']> | null = null;
  for (let i = 0; i < times; i++) {
    const ev = session.observe(user.look(noise));
    if (!significant && ev.kind !== 'inchange') significant = ev;
  }
  return significant ?? { kind: 'inchange' as const };
}

describe('suivi temps reel', () => {
  it('suit un utilisateur qui execute la solution correctement', () => {
    const scramble = ['R', "U'", 'F2', 'L', 'D', "B'", 'R2', 'U', "L'", 'F'];
    const start = applyAlg(SOLVED_FACELETS, scramble);
    const solution = scramble.slice().reverse().map(invertMove);
    const user = new VirtualUser(start);
    const session = new SolveSession(start, solution);

    // L'utilisateur suit les consignes affichees, groupe par groupe.
    let guard = 0;
    while (!session.finished && guard++ < 100) {
      const group = session.instructionGroup();
      expect(group.length).toBeGreaterThan(0);
      for (const move of group) user.turn(move);
      feed(session, user);
      // le suivi ne doit jamais croire autre chose que la realite
      expect(visibleFace(session.cube, session.orientation)).toBe(
        visibleFace(user.state, user.orientation),
      );
    }
    expect(session.finished).toBe(true);
    expect(session.solved).toBe(true);
    expect(session.cube).toBe(SOLVED_FACELETS);
  });

  it('rattrape les mouvements de la face arriere, invisibles pour la camera', () => {
    const start = applyAlg(SOLVED_FACELETS, 'B R B2 U');
    const solution = ["U'", 'B2', "R'", "B'"];
    const user = new VirtualUser(start);
    const session = new SolveSession(start, solution);

    // l'utilisateur enchaine U' puis B2 : la camera ne voit rien changer sur B2
    user.turn("U'");
    feed(session, user);
    expect(session.index).toBe(1);

    // B2 est invisible de face : la consigne l'annonce donc avec le mouvement
    // suivant, qui lui est verifiable.
    expect(session.instructionGroup()).toEqual(['B2', "R'"]);
    user.turn('B2');
    user.turn("R'");
    feed(session, user);
    expect(session.index).toBe(3); // les deux confirmes d'un coup

    expect(session.instructionGroup()).toEqual(["B'"]);
    user.turn("B'");
    feed(session, user);
    session.advance(session.solution.length - session.index);
    expect(session.solved).toBe(true);
  });

  it("s'adapte quand l'utilisateur retourne le cube dans sa main", () => {
    const start = applyAlg(SOLVED_FACELETS, 'R U F2 L D');
    const solution = ["D'", "L'", 'F2', "U'", "R'"];
    const user = new VirtualUser(start);
    const session = new SolveSession(start, solution);

    user.turn("D'");
    feed(session, user);
    expect(session.index).toBe(1);

    // l'utilisateur tourne le cube d'un quart de tour vers la gauche
    const y = ORIENTATIONS.find((o) => o.word.join(' ') === 'y')!;
    user.hold(y);
    const ev = feed(session, user);
    expect(ev.kind).toBe('reoriente');
    expect(session.orientation.faceMapInv.F).toBe('R');

    // Le mouvement reste L' en absolu, mais apres un quart de tour vers la
    // gauche la face L absolue s'est deplacee en position arriere : la consigne
    // affichee devient B'.
    expect(session.displayMove("L'")).toBe("B'");
    expect(session.displayMove("R'")).toBe("F'");

    // Apres la rotation, L' est passe a l'arriere : invisible, donc annonce
    // avec le mouvement suivant.
    const group = session.instructionGroup();
    expect(group).toEqual(["L'", 'F2']);
    for (const m of group) user.turn(m);
    feed(session, user);
    expect(session.index).toBe(3);
  });

  it("detecte une erreur de l'utilisateur et repart de l'etat reel", () => {
    const start = applyAlg(SOLVED_FACELETS, 'R U F');
    const solution = ["F'", "U'", "R'"];
    const user = new VirtualUser(start);
    const session = new SolveSession(start, solution);

    user.turn('F'); // au lieu de F'
    const ev = feed(session, user);
    expect(ev.kind).toBe('ecart');
    if (ev.kind === 'ecart') expect(ev.move).toBe('F');
    expect(session.cube).toBe(applyMove(start, 'F'));
    expect(session.solution).toEqual([]);
  });

  it('tolere une lecture bruitee', () => {
    const start = applyAlg(SOLVED_FACELETS, 'R U2 F L');
    const solution = ["L'", "F'", 'U2', "R'"];
    const user = new VirtualUser(start);
    const session = new SolveSession(start, solution);
    user.turn("L'");
    feed(session, user, 3, 1); // 1 sticker sur 9 mal lu, avec confiance basse
    expect(session.index).toBe(1);
  });

  it('signale une lecture incoherente au lieu d inventer', () => {
    const start = applyAlg(SOLVED_FACELETS, 'R U F');
    const session = new SolveSession(start, ["F'", "U'", "R'"]);
    const ev = session.observe({
      labels: ['U', 'U', 'U', 'D', 'D', 'D', 'L', 'L', 'L'] as Face[],
      confidence: new Array(9).fill(0.9),
    });
    expect(ev.kind).toBe('incoherent');
  });

  it('le point de vue en vis-a-vis inverse bien la gauche et la droite', () => {
    const v = userViewpoint(IDENTITY_ORIENTATION, true);
    expect(v.faceMap.R).toBe('L');
    expect(v.faceMap.L).toBe('R');
    expect(v.faceMap.U).toBe('U');
    expect(v.faceMap.F).toBe('B');
    const same = userViewpoint(IDENTITY_ORIENTATION, false);
    expect(same).toBe(IDENTITY_ORIENTATION);
  });

  it('la correspondance renvoie une explication unique quand elle existe', () => {
    const cube = applyAlg(SOLVED_FACELETS, randomScramble(18));
    const after = applyMove(cube, 'R');
    const obs = { labels: visibleFace(after, IDENTITY_ORIENTATION).split('') as Face[] };
    const [best] = matchObservation(cube, ['R', 'U'], obs, IDENTITY_ORIENTATION);
    expect(best.moves).toEqual(['R']);
    expect(best.score).toBeGreaterThan(0.9);
  });
});

let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296);

function scramble(n: number): string[] {
  const out: string[] = [];
  let last = '';
  while (out.length < n) {
    const m = MOVES[Math.floor(rnd() * MOVES.length)];
    if (m[0] === last) continue;
    last = m[0];
    out.push(m);
  }
  return out;
}

describe('robustesse du suivi', () => {
  it('200 resolutions completes, du melange au cube resolu', () => {
    const echecs: string[] = [];
    for (let t = 0; t < 200; t++) {
      seed = 1000 + t;
      const melange = scramble(15);
      const depart = applyAlg(SOLVED_FACELETS, melange);
      const solution = melange.slice().reverse().map(invertMove);
      let etatReel = depart;
      const session = new SolveSession(depart, solution);
      let garde = 0;
      let bloque = false;
      while (!session.finished && garde++ < 60) {
        const groupe = session.instructionGroup();
        if (!groupe.length) { bloque = true; break; }
        for (const m of groupe) etatReel = applyPermStr(etatReel, permOf(m));
        const avant = session.index;
        for (let k = 0; k < 4; k++) {
          const face = visibleFace(etatReel, IDENTITY_ORIENTATION);
          session.observe({ labels: face.split('') as Face[], confidence: new Array(9).fill(0.9) });
        }
        if (session.index === avant) {
          // La camera ne peut pas valider un groupe qui ne change rien a
          // l'image : c'est le bouton « Fait » qui prend le relais.
          if (!session.groupeObservable(groupe)) session.advance(groupe.length);
          else { bloque = true; break; }
        }
      }
      if (bloque || !session.finished || session.cube !== SOLVED_FACELETS) {
        echecs.push(
          `t=${t} bloque=${bloque} index=${session.index}/${session.solution.length} ` +
          `resolu=${session.cube === SOLVED_FACELETS} groupe=[${session.instructionGroup().join(' ')}] ` +
          `orientation=[${session.orientation.word.join(' ')}]`,
        );
      }
    }
    if (echecs.length) console.log('  ' + echecs.slice(0, 6).join('\n  '));
    expect(echecs).toEqual([]);
  }, 120000);
});
