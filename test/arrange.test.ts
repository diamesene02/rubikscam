import { describe, it, expect } from 'vitest';
import { findValidArrangement } from '../src/core/arrange';
import { SOLVED_FACELETS, applyAlg, randomScramble, validate } from '../src/core/cube';
import { FACES, type Face } from '../src/core/geometry';
import { SCAN_PLAN } from '../src/core/scanPlan';
import { visibleFace } from '../src/core/tracking';

/**
 * Un geste fait dans l'autre sens pendant le scan donne des couleurs
 * parfaites — 9 stickers de chaque — mais des PIECES impossibles. Aucune
 * correction de couleur ne rattrape cela : c'est le placement des faces entre
 * elles qui est faux. On le retrouve par recherche.
 */

let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296), seed / 4294967296);

const ROTS: number[][] = (() => {
  const id = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const q = [6, 3, 0, 7, 4, 1, 8, 5, 2];
  const c = (a: number[], b: number[]) => a.map((_, i) => a[b[i]]);
  const r2 = c(q, q);
  return [id, q, r2, c(r2, q)];
})();

/**
 * Les 6 faces telles que l'application les range apres capture, c'est-a-dire
 * deja converties de l'ordre camera vers l'ordre des facettes. Une rotation
 * nulle signifie alors vraiment "rien a corriger".
 */
function scanner(etat: string): string[][] {
  return SCAN_PLAN.map((step) => {
    const base = FACES.indexOf(step.face) * 9;
    return etat.slice(base, base + 9).split('');
  });
}
void visibleFace;

function tourner(face: string[], q: number): string[] {
  return ROTS[q].map((i) => face[i]);
}

describe('placement des faces', () => {
  it('un scan correct est reconnu tel quel, sans rien deplacer', () => {
    for (let t = 0; t < 25; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      const r = findValidArrangement(scanner(etat));
      expect(r).not.toBeNull();
      expect(r!.deplacees).toBe(0);
      expect(r!.tournees).toBe(0);
      expect(r!.facelets).toBe(etat);
    }
  });

  it('retrouve un cube valide quand des faces ont ete presentees tournees', () => {
    for (let t = 0; t < 25; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      const faces = scanner(etat);
      const combien = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < combien; i++) {
        const k = Math.floor(rnd() * 6);
        faces[k] = tourner(faces[k], 1 + Math.floor(rnd() * 3));
      }
      const r = findValidArrangement(faces);
      expect(r, `essai ${t}`).not.toBeNull();
      expect(validate(r!.facelets).ok).toBe(true);
    }
  });

  it('retrouve un cube valide quand deux faces ont ete INTERVERTIES', () => {
    // le geste fait dans l'autre sens : on montre la face de gauche la ou le
    // parcours attendait celle de droite
    let trouves = 0;
    const essais = 25;
    for (let t = 0; t < essais; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      const faces = scanner(etat);
      const a = Math.floor(rnd() * 6);
      let b = Math.floor(rnd() * 6);
      while (b === a) b = Math.floor(rnd() * 6);
      [faces[a], faces[b]] = [faces[b], faces[a]];
      const r = findValidArrangement(faces);
      if (r && validate(r.facelets).ok) trouves++;
    }
    console.log(`  deux faces interverties : ${trouves}/${essais} rattrapes`);
    expect(trouves).toBe(essais);
  });

  it('retrouve un cube valide quel que soit l ORDRE des 6 faces', () => {
    for (let t = 0; t < 20; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      const faces = scanner(etat);
      // melange complet de l'ordre ET des rotations
      const ordre = [0, 1, 2, 3, 4, 5].sort(() => rnd() - 0.5);
      const melangees = ordre.map((k) => tourner(faces[k], Math.floor(rnd() * 4)));
      const r = findValidArrangement(melangees);
      expect(r, `essai ${t}`).not.toBeNull();
      expect(validate(r!.facelets).ok).toBe(true);
    }
  });

  it('refuse un cube reellement impossible', () => {
    const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
    const faces = scanner(etat);
    // on casse le comptage : aucun placement ne peut sauver cela
    const cible = faces[0][0];
    const autre = (FACES as readonly string[]).find((f) => f !== cible)!;
    faces[0][0] = autre;
    expect(findValidArrangement(faces)).toBeNull();
  });

  it('reste rapide', () => {
    const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
    const faces = scanner(etat);
    const ordre = [0, 1, 2, 3, 4, 5].sort(() => rnd() - 0.5);
    const melangees = ordre.map((k) => tourner(faces[k], Math.floor(rnd() * 4)));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) findValidArrangement(melangees);
    const ms = (performance.now() - t0) / 20;
    console.log(`  recherche complete : ${ms.toFixed(1)} ms`);
    /*
     * Seuil large, et assume.
     *
     * Depuis que la recherche continue APRES avoir trouve une explication —
     * pour savoir si un AUTRE cube explique les memes six faces, ce qui attrape
     * 7 arrangements faux sur 7 — elle explore tout l'espace au lieu de
     * s'arreter a la premiere solution. Mesure : 37 ms avant, 90 a 250 ms selon
     * la charge de la machine ensuite. A 400 ms le test echouait par
     * intermittence pendant les passes completes, ou les tests pixel saturent
     * le processeur ; il ne signalait alors rien d'autre que cette saturation.
     *
     * 900 ms laisse la marge necessaire tout en attrapant encore une vraie
     * regression d'un ordre de grandeur.
     */
    expect(ms).toBeLessThan(900);
  });

  it('respecte les labels : le resultat nomme les faces par leur centre', () => {
    const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
    const r = findValidArrangement(scanner(etat))!;
    for (let f = 0; f < 6; f++) {
      expect(r.facelets[f * 9 + 4]).toBe(FACES[f] as Face);
    }
  });
});

describe('logo sur le sticker central', () => {
  /**
   * Le centre d'une face porte souvent le logo de la marque : un texte sombre
   * imprime sur le sticker. La bande de lecture, concue pour rejeter les
   * REFLETS, retenait justement ce texte et faussait la couleur du centre —
   * la plus critique, puisqu'elle sert d'ancre a tout le classement.
   */
  it('la bande dediee au centre ignore un logo sombre', async () => {
    const { sampleLattice } = await import('../src/media/sampler');
    const W = 90;
    const H = 90;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = 240;
      data[i * 4 + 1] = 238;
      data[i * 4 + 2] = 234;
      data[i * 4 + 3] = 255;
    }
    for (let y = 38; y < 52; y++) {
      for (let x = 32; x < 58; x++) {
        if ((x + y) % 3 === 0) continue;
        const i = (y * W + x) * 4;
        data[i] = 40;
        data[i + 1] = 60;
        data[i + 2] = 150;
      }
    }
    const lu = sampleLattice(data, W, H, [{ x: 45, y: 45 }], { x: 60, y: 0 }, { x: 0, y: 60 })[0].rgb;
    expect(lu.r).toBeGreaterThan(200);
    expect(lu.g).toBeGreaterThan(200);
    expect(lu.b).toBeGreaterThan(190);
  });
});

describe('chaine complete : geste inverse pendant le scan', () => {
  /**
   * Le scenario remonte en usage reel : l'utilisateur tourne le cube du mauvais
   * cote, il montre donc une autre face que celle attendue. Les couleurs sont
   * parfaites (9 de chaque), les pieces impossibles. Il faut passer par une
   * lecture SANS ancrage des centres, sinon l'ancrage attribue les couleurs aux
   * mauvaises positions avant meme la recherche de placement.
   */
  it('rattrape deux faces interverties, en partant des couleurs mesurees', async () => {
    const { classifyCube } = await import('../src/core/color');
    const STICKERS: Record<string, { r: number; g: number; b: number }> = {
      blanc: { r: 236, g: 234, b: 228 },
      jaune: { r: 252, g: 214, b: 38 },
      rouge: { r: 198, g: 28, b: 44 },
      orange: { r: 238, g: 118, b: 22 },
      vert: { r: 0, g: 160, b: 74 },
      bleu: { r: 0, g: 68, b: 174 },
    };
    const noms = Object.keys(STICKERS);

    let rattrapes = 0;
    const essais = 20;
    for (let t = 0; t < essais; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      // schema de couleurs arbitraire, comme un vrai cube
      const melange = noms.slice().sort(() => rnd() - 0.5);
      const parFace: Record<string, string> = {};
      FACES.forEach((f, i) => (parFace[f] = melange[i]));

      // les 6 faces rangees par le parcours, avec DEUX faces interverties
      const rangees = SCAN_PLAN.map((step) => {
        const base = FACES.indexOf(step.face) * 9;
        return etat.slice(base, base + 9).split('');
      });
      const a = Math.floor(rnd() * 6);
      let b = Math.floor(rnd() * 6);
      while (b === a) b = Math.floor(rnd() * 6);
      [rangees[a], rangees[b]] = [rangees[b], rangees[a]];

      // mesures : chaque face auto-exposee comme le fait une camera (le pic a
      // ~235), ce que garantit par ailleurs la porte anti-saturation de
      // l'application. Sans cela le jaune et le blanc saturent et la mesure
      // perd l'information, ce qui testerait autre chose que le placement.
      const echantillons = rangees.flatMap((face) => {
        const brut = face.map((lettre) => STICKERS[parFace[lettre]]);
        const pic = Math.max(...brut.flatMap((c) => [c.r, c.g, c.b]), 1);
        const k = (235 / pic) * (0.92 + rnd() * 0.16);
        return brut.map((c) => ({
          r: Math.min(255, c.r * k),
          g: Math.min(255, c.g * k),
          b: Math.min(255, c.b * k),
        }));
      });

      const libre = classifyCube(echantillons);
      const faces = SCAN_PLAN.map((step) => {
        const base = FACES.indexOf(step.face) * 9;
        return libre.labels.slice(base, base + 9) as string[];
      });
      const r = findValidArrangement(faces);
      if (r && validate(r.facelets).ok) rattrapes++;
    }
    console.log(`  geste inverse : ${rattrapes}/${essais} rattrapes`);
    expect(rattrapes).toBe(essais);
  });
});

describe('image en miroir', () => {
  /**
   * Piste ecartee, gardee ici parce qu'elle est tentante et fausse. On pourrait
   * croire qu'une webcam renvoyant une image inversee explique le symptome
   * "couleurs justes, positions fausses", et qu'il suffit de retourner chaque
   * face. Mesure faite : la recherche de placement trouve deja un cube VALIDE
   * pour des donnees en miroir, en repartissant les faces autrement. Ajouter un
   * repli "essaie aussi en miroir" ne corrigerait donc rien et ferait courir le
   * risque de resoudre silencieusement le mauvais cube.
   */
  const MIROIR = [2, 1, 0, 5, 4, 3, 8, 7, 6];

  it('un scan en miroir donne deja un placement valide : le repli serait inutile', () => {
    let valides = 0;
    const essais = 25;
    for (let t = 0; t < essais; t++) {
      const etat = applyAlg(SOLVED_FACELETS, randomScramble(20));
      const faces = scanner(etat).map((f) => MIROIR.map((i) => f[i]));
      const r = findValidArrangement(faces);
      if (r && validate(r.facelets).ok) valides++;
    }
    console.log(`  scan en miroir : ${valides}/${essais} donnent deja un cube valide`);
    expect(valides).toBeGreaterThan(essais * 0.8);
  });
});
