import { describe, expect, it } from 'vitest';
import { SOLVED_FACELETS, applyAlg, validate } from '../src/core/cube';
import { findValidArrangement } from '../src/core/arrange';
import { SCAN_PLAN } from '../src/core/scanPlan';
import { FACES, ORIENTATIONS, applyPermStr } from '../src/core/geometry';


let seed = 20260829;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296);
const MOVES = ['U',"U'",'U2','R',"R'",'R2','F',"F'",'F2','D',"D'",'D2','L',"L'",'L2','B',"B'",'B2'];

function tourner(f: string[], n: number): string[] {
  let r = f;
  for (let i = 0; i < n; i++) r = [6,3,0,7,4,1,8,5,2].map((j) => r[j]);
  return r;
}

/** Le cube trouve est-il le VRAI cube, a une rotation d'ensemble pres ? */
function memeCube(a: string, b: string): boolean {
  // Une rotation d'ensemble permute les positions ET renomme les faces.
  return ORIENTATIONS.some(
    (o) =>
      [...applyPermStr(a, o.perm)].map((c) => o.faceMap[c as never]).join('') === b,
  );
}

/**
 * Un arrangement VALIDE n'est pas forcement le VRAI cube : les memes six faces
 * peuvent s'assembler en plusieurs cubes legaux. Resoudre le mauvais serait un
 * mensonge silencieux — l'utilisateur suivrait vingt mouvements pour rien.
 *
 * Ce test mesure les deux choses qui comptent : combien d'arrangements sont
 * faux, et si le drapeau `ambigu` les attrape tous.
 */
describe('placement des faces : valide ne veut pas dire vrai', () => {
it('signale toute lecture qui s assemble aussi en un autre cube', () => {
  let valides = 0;
  let corrects = 0;
  let ambigus = 0;
  let fauxDetectes = 0;
  const essais = 200;
  for (let n = 0; n < essais; n++) {
    const alg = Array.from({ length: 12 }, () => MOVES[Math.floor(rnd() * 18)]);
    const vrai = applyAlg(SOLVED_FACELETS, alg);
    // Les 6 faces telles que le scan les fournit, dans l'ordre du parcours.
    let faces = SCAN_PLAN.map((s) => {
      const b = FACES.indexOf(s.face) * 9;
      return tourner(vrai.slice(b, b + 9).split(''), Math.floor(rnd() * 4));
    });
    // ... et deux faces echangees, comme quand un geste est fait a l'envers.
    const i = Math.floor(rnd() * 6);
    let j = Math.floor(rnd() * 6);
    if (j === i) j = (j + 1) % 6;
    faces = faces.slice();
    [faces[i], faces[j]] = [faces[j], faces[i]];
    const r = findValidArrangement(faces);
    if (!r) continue;
    if (validate(r.facelets).ok) valides++;
    const bon = memeCube(r.facelets, vrai);
    if (bon) corrects++;
    if (r.alternatives?.length) ambigus++;
    if (!bon && r.alternatives?.length) fauxDetectes++;
  }
  console.log(`  valides  : ${valides}/${essais}`);
  console.log(`  CORRECTS : ${corrects}/${essais}   <-- mensonges silencieux : ${valides - corrects}`);
  console.log(`  signales ambigus : ${ambigus}/${essais}`);
  console.log(`  FAUX detectes comme ambigus : ${fauxDetectes}/${valides - corrects}`);
  // Le taux d'erreur brut est reel : on ne pretend pas l'annuler.
  expect(valides - corrects).toBeGreaterThan(0);
  // Ce qui doit etre parfait, c'est la DETECTION : aucun cube faux ne doit
  // passer sans que l'utilisateur soit prevenu.
  expect(fauxDetectes).toBe(valides - corrects);
  // Et l'avertissement doit rester rare, sinon il devient du bruit.
  expect(ambigus).toBeLessThan(essais * 0.15);
});
});

describe('les autres lectures possibles sont proposees, pas cachees', () => {
  const MOUVEMENTS = ['U',"U'",'U2','R',"R'",'R2','F',"F'",'F2','D',"D'",'D2','L',"L'",'L2','B',"B'",'B2'];
  let graine = 99;
  const tirage = () => ((graine = (graine * 1664525 + 1013904223) % 4294967296), graine / 4294967296);

  it('quand plusieurs cubes expliquent le scan, le VRAI est parmi les propositions', () => {
    let ambigus = 0;
    let vraiPresent = 0;
    for (let n = 0; n < 120; n++) {
      const vrai = applyAlg(
        SOLVED_FACELETS,
        Array.from({ length: 12 }, () => MOUVEMENTS[Math.floor(tirage() * 18)]),
      );
      let faces = SCAN_PLAN.map((s) => {
        const b = FACES.indexOf(s.face) * 9;
        return tourner(vrai.slice(b, b + 9).split(''), Math.floor(tirage() * 4));
      });
      const i = Math.floor(tirage() * 6);
      let j = Math.floor(tirage() * 6);
      if (j === i) j = (j + 1) % 6;
      faces = faces.slice();
      [faces[i], faces[j]] = [faces[j], faces[i]];

      const r = findValidArrangement(faces);
      if (!r?.alternatives?.length) continue;
      ambigus++;
      const propositions = [r.facelets, ...r.alternatives];
      if (propositions.some((p) => memeCube(p, vrai))) vraiPresent++;
    }
    console.log(`  lectures ambigues : ${ambigus}/120`);
    console.log(`  le vrai cube etait propose : ${vraiPresent}/${ambigus}`);
    expect(ambigus).toBeGreaterThan(0);
    // Proposer des candidats n'a de sens que si le bon s'y trouve le plus
    // souvent. Mesure : 8 fois sur 9. Le cas restant demande un placement plus
    // couteux que la solution minimale ; l'explorer a ete essaye et coute 3,5
    // fois plus cher sans rien couvrir de plus. Quand aucune proposition ne
    // correspond, l'utilisateur rescanne — et il le sait, on le lui dit.
    expect(vraiPresent / ambigus).toBeGreaterThan(0.8);
  });
});
