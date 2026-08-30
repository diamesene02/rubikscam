/**
 * Reparation automatique d'une lecture invalide.
 *
 * Quand la lecture couleur produit un cube physiquement impossible, la cause
 * est presque toujours locale : un ou deux stickers rouge/orange confondus, ou
 * une face scannee tournee d'un quart de tour. Plutot que de renvoyer
 * l'utilisateur au scan, on cherche la correction la MOINS couteuse (au sens
 * de la distance couleur) qui rend le cube valide.
 *
 * Espace de recherche, du moins cher au plus cher :
 *   - rotation d'une face entiere (erreur de tenue du cube) ;
 *   - echange des etiquettes de 2 stickers peu surs ;
 *   - cycle de 3 etiquettes ;
 *   - deux echanges disjoints.
 * Le comptage "9 par couleur" est toujours preserve, puisqu'on ne fait que
 * permuter des etiquettes existantes.
 */

import { validate } from './cube';
import { FACES, type Face } from './geometry';

export interface RepairInput {
  labels: Face[];
  confidence: number[];
  distances: number[][];
}

export interface RepairResult {
  labels: Face[];
  changed: number[];
  cost: number;
  description: string;
}

const CENTERS = new Set(FACES.map((_, i) => i * 9 + 4));

function cost(distances: number[][], labels: Face[], base: Face[]): number {
  let c = 0;
  for (let i = 0; i < 54; i++) {
    if (labels[i] === base[i]) continue;
    c += distances[i][FACES.indexOf(labels[i])] - distances[i][FACES.indexOf(base[i])];
  }
  return c;
}

function diff(a: Face[], b: Face[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 54; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

/** Fait tourner les 9 etiquettes d'une face de `quarters` quarts de tour horaires. */
function rotateFaceLabels(labels: Face[], face: number, quarters: number): Face[] {
  const out = labels.slice();
  const base = face * 9;
  const q = ((quarters % 4) + 4) % 4;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let nr = r;
      let nc = c;
      for (let i = 0; i < q; i++) {
        const tr = nc;
        const tc = 2 - nr;
        nr = tr;
        nc = tc;
      }
      out[base + nr * 3 + nc] = labels[base + r * 3 + c];
    }
  }
  return out;
}

export function repairReading(input: RepairInput, maxCandidates = 16): RepairResult | null {
  const { labels, confidence, distances } = input;
  if (validate(labels.join('')).ok) {
    return { labels: labels.slice(), changed: [], cost: 0, description: 'Lecture coherente.' };
  }

  let best: RepairResult | null = null;
  const consider = (cand: Face[], description: string) => {
    const c = cost(distances, cand, labels);
    if (best && c >= best.cost) return;
    if (!validate(cand.join('')).ok) return;
    best = { labels: cand, changed: diff(cand, labels), cost: c, description };
  };

  // 1. une face entiere tournee (erreur de tenue du cube pendant le scan)
  for (let f = 0; f < 6; f++) {
    for (const q of [1, 2, 3]) {
      consider(
        rotateFaceLabels(labels, f, q),
        `La face ${FACES[f]} etait tournee de ${q * 90} deg pendant le scan.`,
      );
    }
  }

  // stickers les moins surs (centres exclus : ce sont nos ancres)
  const ranked = labels
    .map((_, i) => i)
    .filter((i) => !CENTERS.has(i))
    .sort((a, b) => confidence[a] - confidence[b]);
  const suspects = ranked.slice(0, maxCandidates);
  const partners = labels.map((_, i) => i).filter((i) => !CENTERS.has(i));

  // 2. echange de deux etiquettes : un suspect avec N'IMPORTE quel autre
  // sticker. Limiter les deux cotes de l'echange aux seuls suspects raterait le
  // cas frequent ou une seule lecture est fausse et son partenaire d'echange
  // est, lui, parfaitement net.
  const swaps: Array<[number, number]> = [];
  for (const i of suspects) {
    for (const j of partners) {
      if (j <= i && suspects.includes(j)) continue; // paire deja vue
      if (j === i || labels[i] === labels[j]) continue;
      swaps.push([i, j]);
      const cand = labels.slice();
      cand[i] = labels[j];
      cand[j] = labels[i];
      consider(cand, `Deux stickers intervertis (${labels[i]} / ${labels[j]}).`);
    }
  }

  // 3. cycle de trois etiquettes parmi les plus douteux
  const trio = ranked.slice(0, Math.min(12, maxCandidates));
  for (let x = 0; x < trio.length; x++) {
    for (let y = x + 1; y < trio.length; y++) {
      for (let z = y + 1; z < trio.length; z++) {
        const [i, j, k] = [trio[x], trio[y], trio[z]];
        if (labels[i] === labels[j] && labels[j] === labels[k]) continue;
        for (const dir of [0, 1]) {
          const cand = labels.slice();
          if (dir === 0) {
            cand[i] = labels[j];
            cand[j] = labels[k];
            cand[k] = labels[i];
          } else {
            cand[i] = labels[k];
            cand[k] = labels[j];
            cand[j] = labels[i];
          }
          consider(cand, 'Trois stickers permutes circulairement.');
        }
      }
    }
  }

  // 4. deux echanges disjoints (budget borne : cas rare et couteux)
  if (!best) {
    const short = swaps.slice(0, 260);
    for (let a = 0; a < short.length; a++) {
      const [i1, j1] = short[a];
      for (let b = a + 1; b < short.length; b++) {
        const [i2, j2] = short[b];
        if (i2 === i1 || i2 === j1 || j2 === i1 || j2 === j1) continue;
        const cand = labels.slice();
        cand[i1] = labels[j1];
        cand[j1] = labels[i1];
        cand[i2] = labels[j2];
        cand[j2] = labels[i2];
        consider(cand, 'Deux paires de stickers interverties.');
      }
    }
  }

  return best;
}

/** Faces contenant les lectures les moins sures : celles a rescanner. */
export function suspectFaces(confidence: number[], threshold = 0.25): number[] {
  const faces = new Set<number>();
  for (let i = 0; i < confidence.length; i++) {
    if (confidence[i] < threshold) faces.add(Math.floor(i / 9));
  }
  return [...faces].sort((a, b) => a - b);
}
