import { describe, expect, it } from 'vitest';
import { SOLVED_FACELETS, applyAlg } from '../src/core/cube';
import { findValidArrangement } from '../src/core/arrange';
import { SCAN_PLAN } from '../src/core/scanPlan';
import { FACES, type Face } from '../src/core/geometry';
import { classifyFace, toLinear, type Lin, type RGB } from '../src/core/color';

/**
 * Le placement rebaptise chaque face d'apres la couleur de son centre. Toute
 * table indexee sur les noms d'ORIGINE — au premier rang la palette
 * d'affichage — doit subir le meme renommage.
 *
 * Sans cela, l'etat du cube est juste mais l'ecran ment : les neuf stickers
 * d'un groupe sont peints avec la couleur d'un autre. L'utilisateur voit alors
 * « tous mes bleus sont affiches en vert », sur toutes les faces a la fois.
 */
let graine = 31;
const tirage = () => ((graine = (graine * 1664525 + 1013904223) % 4294967296), graine / 4294967296);
const MOUVEMENTS = ['U',"U'",'U2','R',"R'",'R2','F',"F'",'F2','D',"D'",'D2','L',"L'",'L2','B',"B'",'B2'];
const tourner = (f: string[], n: number) => {
  let r = f;
  for (let i = 0; i < n; i++) r = [6, 3, 0, 7, 4, 1, 8, 5, 2].map((j) => r[j]);
  return r;
};

describe('renommage des faces par le placement', () => {
  it('le renommage est une bijection sur les six groupes', () => {
    for (let n = 0; n < 40; n++) {
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
      if (!r) continue;
      const groupes = FACES.map((f) => r.renommage[f]);
      expect(new Set(groupes).size).toBe(6);
    }
  });

  it('relire les facettes a travers le renommage redonne les groupes d origine', () => {
    // C'est la propriete exacte dont depend la palette d'affichage : la
    // couleur a peindre en position f est celle du groupe `renommage[f]`.
    for (let n = 0; n < 40; n++) {
      const vrai = applyAlg(
        SOLVED_FACELETS,
        Array.from({ length: 12 }, () => MOUVEMENTS[Math.floor(tirage() * 18)]),
      );
      const faces = SCAN_PLAN.map((s) => {
        const b = FACES.indexOf(s.face) * 9;
        return tourner(vrai.slice(b, b + 9).split(''), Math.floor(tirage() * 4));
      });
      const r = findValidArrangement(faces);
      if (!r) continue;

      // Le centre de la position f porte le nom f...
      for (const [k, f] of FACES.entries()) {
        expect(r.facelets[k * 9 + 4]).toBe(f);
      }
      // ... et ce nom designe bien le groupe `renommage[f]`.
      for (const [k, f] of FACES.entries()) {
        const source = r.placement.findIndex((p) => p === f);
        const tournee = tourner(faces[source], r.rotations[source]);
        expect(`${f}:${r.renommage[f]}`).toBe(`${f}:${tournee[4]}`);
        void k;
      }
    }
  });

  it('sans renommage, la palette peindrait les mauvaises couleurs', () => {
    // Garde-fou explicite : on cherche un cas ou le placement rebaptise, et on
    // verifie qu'ignorer le renommage change bien la couleur affichee.
    let trouve = false;
    for (let n = 0; n < 60 && !trouve; n++) {
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
      if (!r) continue;
      const change = FACES.filter((f) => r.renommage[f] !== f);
      if (change.length) trouve = true;
    }
    expect(trouve).toBe(true);
  });
});

describe('le suivi en direct utilise les references renommees', () => {
  /** Couleur physique de chaque groupe, arbitraire mais bien separee. */
  const COULEURS: Record<string, RGB> = {
    U: { r: 240, g: 240, b: 238 },
    R: { r: 190, g: 34, b: 40 },
    F: { r: 22, g: 152, b: 78 },
    D: { r: 250, g: 208, b: 45 },
    L: { r: 240, g: 106, b: 26 },
    B: { r: 24, g: 74, b: 178 },
  };

  it('sans le renommage, le suivi lit des etiquettes d une autre nomenclature', () => {
    let casTeste = 0;
    for (let n = 0; n < 60 && casTeste < 5; n++) {
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
      if (!r) continue;
      // On ne teste que les cas ou le placement a REELLEMENT rebaptise.
      if (FACES.every((f) => r.renommage[f] === f)) continue;
      casTeste++;

      // La face U de l'etat retenu, telle que la camera la verrait : chaque
      // facette porte la couleur physique de son GROUPE.
      const facette = r.facelets.slice(0, 9).split('');
      const image = facette.map((c) => COULEURS[r.renommage[c as Face]]);

      const renommees = {} as Record<Face, Lin>;
      const naives = {} as Record<Face, Lin>;
      for (const f of FACES) {
        renommees[f] = toLinear(COULEURS[r.renommage[f]]);
        naives[f] = toLinear(COULEURS[f]);
      }

      // Avec les references renommees, on relit exactement l'etat.
      expect(classifyFace(image, renommees).labels.join('')).toBe(facette.join(''));
      // Sans, on lit une autre nomenclature : le suivi ne peut rien reconnaitre.
      expect(classifyFace(image, naives).labels.join('')).not.toBe(facette.join(''));
    }
    expect(casTeste).toBeGreaterThan(0);
  });
});
