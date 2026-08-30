import { describe, it, expect } from 'vitest';
import { SCAN_PLAN, faceletsOfStep } from '../src/core/scanPlan';
import { SOLVED_FACELETS, applyAlg, randomScramble } from '../src/core/cube';
import { FACES, applyPermStr, type Face } from '../src/core/geometry';
import { visibleFace } from '../src/core/tracking';

describe('parcours de scan', () => {
  it('couvre les 6 faces en 6 etapes', () => {
    expect(SCAN_PLAN.length).toBe(6);
    expect(new Set(SCAN_PLAN.map((s) => s.face)).size).toBe(6);
  });

  it('chaque etape ne demande qu un seul quart de tour', () => {
    for (const step of SCAN_PLAN.slice(1)) {
      expect(step.rotation).toBeTruthy();
      expect(['x', "x'", 'y', "y'"]).toContain(step.rotation);
    }
  });

  it('deux faces consecutives ne sont jamais opposees', () => {
    const opposite: Record<Face, Face> = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
    for (let i = 1; i < SCAN_PLAN.length; i++) {
      expect(SCAN_PLAN[i].face).not.toBe(opposite[SCAN_PLAN[i - 1].face]);
    }
  });

  it("la grille lue a chaque etape reconstruit exactement l'etat du cube", () => {
    for (let trial = 0; trial < 50; trial++) {
      const state = applyAlg(SOLVED_FACELETS, randomScramble(20));
      // On simule le scan : a chaque etape, la camera voit la face avant du
      // cube tourne, et on range les 9 lectures via faceletsOfStep.
      const rebuilt = new Array<string>(54).fill('?');
      for (const step of SCAN_PLAN) {
        const seen = visibleFace(state, step.orientation);
        const targets = faceletsOfStep(step);
        for (let i = 0; i < 9; i++) rebuilt[targets[i]] = seen[i];
      }
      expect(rebuilt.join('')).toBe(state);
    }
  });

  it('les centres lus correspondent bien a la face annoncee', () => {
    const state = applyAlg(SOLVED_FACELETS, randomScramble(20));
    for (const step of SCAN_PLAN) {
      const seen = visibleFace(state, step.orientation);
      const centre = seen[4];
      expect(centre).toBe(step.face);
      expect(FACES).toContain(centre as Face);
    }
    void applyPermStr;
  });
});
