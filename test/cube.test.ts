import { describe, it, expect } from 'vitest';
import Cube from 'cubejs';
import {
  SOLVED_FACELETS,
  applyAlg,
  validate,
  isSolved,
  randomScramble,
  faceOf,
} from '../src/core/cube';
import { CORNER_FACELETS, EDGE_FACELETS } from '../src/core/geometry';

function swap(s: string, i: number, j: number): string {
  const a = s.split('');
  [a[i], a[j]] = [a[j], a[i]];
  return a.join('');
}

describe('etat du cube', () => {
  it('le cube resolu est valide et detecte comme resolu', () => {
    expect(validate(SOLVED_FACELETS).ok).toBe(true);
    expect(isSolved(SOLVED_FACELETS)).toBe(true);
  });

  it('200 melanges aleatoires sont tous valides', () => {
    for (let i = 0; i < 200; i++) {
      const s = applyAlg(SOLVED_FACELETS, randomScramble(20));
      const r = validate(s);
      expect(r.ok, r.issues.map((x) => x.message).join(' / ')).toBe(true);
    }
  });

  it('accord avec cubejs sur la lecture des faces', () => {
    const alg = "R U2 F' L D B R' U";
    const mine = applyAlg(SOLVED_FACELETS, alg);
    const ref = new Cube();
    ref.move(alg);
    expect(mine).toBe(ref.asString());
    expect(faceOf(mine, 'F')).toBe(ref.asString().slice(18, 27));
  });

  it('rejette un coin tourne sur lui-meme', () => {
    const [a, b, c] = CORNER_FACELETS[0];
    let s = SOLVED_FACELETS.split('');
    const tmp = s[a];
    s[a] = s[b];
    s[b] = s[c];
    s[c] = tmp;
    const r = validate(s.join(''));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'orientation-coins')).toBe(true);
  });

  it('rejette une arete retournee', () => {
    const [a, b] = EDGE_FACELETS[1];
    const r = validate(swap(SOLVED_FACELETS, a, b));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'orientation-aretes')).toBe(true);
  });

  it('rejette deux aretes echangees (parite)', () => {
    const [a0, a1] = EDGE_FACELETS[0];
    const [b0, b1] = EDGE_FACELETS[1];
    let s = swap(SOLVED_FACELETS, a0, b0);
    s = swap(s, a1, b1);
    const r = validate(s);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'parite')).toBe(true);
  });

  it('rejette un mauvais comptage de couleurs', () => {
    const s = SOLVED_FACELETS.slice(0, 1) + 'R' + SOLVED_FACELETS.slice(2);
    const r = validate(s);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'compte')).toBe(true);
  });

  it('rejette un centre incoherent', () => {
    const s = SOLVED_FACELETS.split('');
    s[4] = 'R';
    s[13] = 'U';
    const r = validate(s.join(''));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'centre')).toBe(true);
  });

  it('rejette une confusion rouge/orange typique (2 stickers echanges)', () => {
    // deux stickers de faces opposees echanges : compte OK, cube impossible
    const s = applyAlg(SOLVED_FACELETS, 'R U F');
    const broken = swap(s, 20, 44);
    const r = validate(broken);
    expect(r.ok).toBe(false);
  });
});
