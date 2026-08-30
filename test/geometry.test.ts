import { describe, it, expect } from 'vitest';
import Cube from 'cubejs';
import {
  FACELETS,
  MOVES,
  ORIENTATIONS,
  IDENTITY_ORIENTATION,
  CORNER_FACELETS,
  EDGE_FACELETS,
  applyPermStr,
  permOf,
  permOfAlg,
  invertAlg,
  orientationWith,
  identityPerm,
  invertPerm,
} from '../src/core/geometry';

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

/** Tables de reference Kociemba (0-indexees) : verite terrain independante. */
const KOCIEMBA_CORNERS = [
  [8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11],
  [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51],
];
const KOCIEMBA_EDGES = [
  [5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25],
  [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14],
];

function randomAlg(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(MOVES[Math.floor(Math.random() * MOVES.length)]);
  return out;
}

describe('geometrie', () => {
  it('54 facettes uniques et bien indexees', () => {
    expect(FACELETS.length).toBe(54);
    const idx = new Set(FACELETS.map((f) => f.index));
    expect(idx.size).toBe(54);
    for (const f of FACELETS) {
      // pos . normal === 1 : le sticker est bien sur la couche exterieure
      const d = f.pos[0] * f.normal[0] + f.pos[1] * f.normal[1] + f.pos[2] * f.normal[2];
      expect(d).toBe(1);
    }
  });

  it('les tables coins/aretes derivees correspondent aux tables Kociemba', () => {
    expect(CORNER_FACELETS.map((c) => [...c])).toEqual(KOCIEMBA_CORNERS);
    expect(EDGE_FACELETS.map((e) => [...e])).toEqual(KOCIEMBA_EDGES);
  });

  it('chaque mouvement simple est d ordre 4 et le double d ordre 2', () => {
    for (const m of MOVES) {
      const p = permOf(m);
      let s = SOLVED;
      const order = m.endsWith('2') ? 2 : 4;
      for (let i = 0; i < order; i++) s = applyPermStr(s, p);
      expect(s, `${m}^${order}`).toBe(SOLVED);
    }
  });

  it('le sexy move revient a l identite apres 6 repetitions', () => {
    let s = SOLVED;
    const p = permOfAlg("R U R' U'");
    for (let i = 0; i < 6; i++) s = applyPermStr(s, p);
    expect(s).toBe(SOLVED);
  });

  it('accord parfait avec cubejs sur 300 algorithmes aleatoires', () => {
    for (let i = 0; i < 300; i++) {
      const alg = randomAlg(1 + Math.floor(Math.random() * 25));
      const mine = applyPermStr(SOLVED, permOfAlg(alg));
      const ref = new Cube();
      ref.move(alg.join(' '));
      expect(mine, alg.join(' ')).toBe(ref.asString());
    }
  });

  it('inverser un algorithme annule son effet', () => {
    for (let i = 0; i < 50; i++) {
      const alg = randomAlg(12);
      const s = applyPermStr(applyPermStr(SOLVED, permOfAlg(alg)), permOfAlg(invertAlg(alg)));
      expect(s).toBe(SOLVED);
    }
  });
});

describe('orientations', () => {
  it('exactement 24 orientations distinctes', () => {
    expect(ORIENTATIONS.length).toBe(24);
    const keys = new Set(ORIENTATIONS.map((o) => o.perm.join(',')));
    expect(keys.size).toBe(24);
  });

  it('l identite est presente et neutre', () => {
    expect(IDENTITY_ORIENTATION.word).toEqual([]);
    expect([...IDENTITY_ORIENTATION.perm]).toEqual([...identityPerm()]);
    expect(orientationWith('F', 'U')).toBe(IDENTITY_ORIENTATION);
  });

  it('chaque couple (face avant, face haut) valide a exactement une orientation', () => {
    const faces = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
    let found = 0;
    for (const front of faces) {
      for (const up of faces) {
        const o = orientationWith(front, up);
        if (o) found++;
      }
    }
    expect(found).toBe(24);
  });

  it('apres y, la face absolue R occupe la position avant', () => {
    const y = ORIENTATIONS.find((o) => o.word.join(' ') === 'y')!;
    expect(y.faceMap.R).toBe('F');
    expect(y.faceMapInv.F).toBe('R');
    // et la lecture de la face avant du cube tourne = la face R absolue
    const scrambled = applyPermStr(SOLVED, permOfAlg('R U F2 L D B'));
    const rotated = applyPermStr(scrambled, y.perm);
    expect(rotated.slice(18, 27)).toBe(scrambled.slice(9, 18));
  });

  it('une rotation du cube garde chaque face unie (cube resolu)', () => {
    for (const o of ORIENTATIONS) {
      const s = applyPermStr(SOLVED, o.perm);
      for (let f = 0; f < 6; f++) {
        const face = s.slice(f * 9, f * 9 + 9);
        expect(new Set(face).size, `${o.word.join(' ')} face ${f}`).toBe(1);
      }
    }
  });

  it('une rotation puis son inverse redonne l etat de depart', () => {
    const scrambled = applyPermStr(SOLVED, permOfAlg("R U2 F' L D B R'"));
    for (const o of ORIENTATIONS) {
      const back = applyPermStr(applyPermStr(scrambled, o.perm), invertPerm(o.perm));
      expect(back).toBe(scrambled);
    }
  });

  it('tourner le cube puis appliquer un mouvement = appliquer le mouvement traduit', () => {
    // Tenir le cube tourne par o puis tourner la face vue en position P revient
    // a tourner la face absolue faceMapInv[P] sur le cube non tourne.
    const scrambled = applyPermStr(SOLVED, permOfAlg("R U F2 L' D2 B"));
    for (const o of ORIENTATIONS) {
      for (const abs of ['U', 'R', 'F', 'D', 'L', 'B'] as const) {
        const seen = o.faceMap[abs];
        const viaAbsolute = applyPermStr(applyPermStr(scrambled, permOf(abs)), o.perm);
        const viaSeen = applyPermStr(applyPermStr(scrambled, o.perm), permOf(seen));
        expect(viaSeen, `${o.word.join(' ')} / ${abs}`).toBe(viaAbsolute);
      }
    }
  });
});
