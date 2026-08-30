/**
 * Cube 3D en CSS pur (pas de bibliotheque 3D : rien a telecharger, et
 * l'animation est composee par le GPU, donc fluide meme sur un vieux telephone).
 *
 * Chaque sticker est place par une matrice 4x4 construite depuis la geometrie
 * du cube. Pour animer un mouvement, on prefixe la matrice des 21 stickers de
 * la couche par une rotation : le navigateur interpole tout seul.
 *
 * Attention aux reperes : CSS a X a droite, Y VERS LE BAS et Z vers
 * l'observateur, alors que la geometrie du cube utilise Y vers le haut.
 */

import {
  FACELETS,
  FACE_NORMAL,
  FACE_RIGHT,
  FACE_DOWN,
  FACES,
  applyPermStr,
  permOf,
  type Face,
  type Orientation,
  type V3,
} from '../core/geometry';

const CELL = 46;
const STICKER = 40;
const HALF = CELL * 1.5;

/** Passage du repere du cube au repere CSS (Y vers le bas). */
const css = (v: V3): [number, number, number] => [v[0], -v[1], v[2]];

/** Rotation 3x3, rangee par rangee, dans le repere CSS. */
export type M3 = readonly number[];

export function multiplier(a: M3, b: M3): M3 {
  const r = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

export function rotationX(deg: number): M3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function rotationY(deg: number): M3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** Applique une rotation a un vecteur du repere CSS. */
export function appliquer(m: M3, v: readonly number[]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Rotation du cube ENTIER telle que l'utilisateur la fait avec sa main.
 *
 * `x` et `y` sont des rotations autour des axes de la PIECE (l'horizontale et
 * la verticale de l'ecran), pas des axes du cube : quand le cube est deja
 * bascule, « tourne vers la gauche » reste un mouvement autour de la verticale
 * de la piece. C'est pour cela que cette rotation se compose A GAUCHE de la
 * vue courante. La composer a droite illustrerait un tout autre geste.
 */
export function rotationDuGeste(generateur: string): { axe: 'x' | 'y'; angle: number } | null {
  switch (generateur) {
    // Bascule en arriere : le dessous remonte face a la camera.
    case 'x':
      return { axe: 'x', angle: 90 };
    // Bascule vers toi : le dessus descend face a la camera.
    case "x'":
      return { axe: 'x', angle: -90 };
    // Tourne vers la gauche : la face de droite vient devant.
    case 'y':
      return { axe: 'y', angle: -90 };
    // Tourne vers la droite : la face de gauche vient devant.
    case "y'":
      return { axe: 'y', angle: 90 };
    default:
      return null;
  }
}

/** Matrice du geste a l'avancement `t` (0 = pas commence, 1 = termine). */
export function matriceDuGeste(generateur: string, t: number): M3 | null {
  const g = rotationDuGeste(generateur);
  if (!g) return null;
  return g.axe === 'x' ? rotationX(g.angle * t) : rotationY(g.angle * t);
}

/**
 * Vue de trois quarts montrant une face donnee, le cube etant dans son
 * orientation de reference (U en haut). Le tangage de D est le symetrique de
 * celui de U : a 40 degres, c'est encore la face F qui domine — le test
 * « chaque vue de depart montre bien la face attendue » le detecte.
 */
export const VUES: Record<Face, [number, number]> = {
  F: [-26, -18],
  R: [-116, -18],
  B: [-206, -18],
  L: [-296, -18],
  U: [-26, -70],
  D: [-26, 70],
};

/**
 * Matrice d'une ORIENTATION du cube, dans le repere CSS.
 *
 * `faceCamera` ne regle que la face tournee vers l'objectif : elle ignore la
 * rotation dans le plan. Le cube affiche montre alors les bonnes couleurs mais
 * tournees d'un quart de tour par rapport a celui que l'utilisateur tient —
 * impossible a comparer d'un coup d'oeil.
 *
 * Une rotation est entierement determinee par l'image de trois axes : les
 * colonnes de la matrice sont les normales des positions ou aboutissent les
 * faces R, U et F.
 *
 * La matrice agit sur des vecteurs CSS, alors que les normales sont donnees en
 * repere cube (Y vers le haut). Il faut donc CONJUGUER par le changement de
 * repere, pas seulement convertir les colonnes — ce qui revient a inverser
 * celle de l'axe vertical. Sans cela, l'identite ne donne meme pas l'identite.
 */
export function matriceOrientation(o: Orientation): M3 {
  const col = (f: Face, signe: number): [number, number, number] => {
    const n = FACE_NORMAL[o.faceMap[f]];
    return [signe * n[0], signe * -n[1], signe * n[2]];
  };
  const [xr, yr, zr] = col('R', 1);
  const [xu, yu, zu] = col('U', -1);
  const [xf, yf, zf] = col('F', 1);
  return [xr, xu, xf, yr, yu, yf, zr, zu, zf];
}

/** Matrice de la vue (lacet puis tangage), sans geste. */
export function matriceVue(yaw: number, pitch: number): M3 {
  return multiplier(rotationX(pitch), rotationY(yaw));
}

/**
 * Vue du cube d'aide a chaque etape du scan.
 *
 * On NE PEUT PAS se contenter de `VUES[face]` : cette table suppose le cube
 * dans son orientation de reference, alors qu'apres une bascule le dessus du
 * cube n'est plus la face U. La vue d'une etape est donc l'orientation
 * ACCUMULEE depuis le depart — chaque geste compose a gauche, autour des axes
 * de la piece. Le test verifie qu'a chaque etape la face annoncee par le plan
 * est bien celle qui regarde la camera.
 */
export function vuesDuParcours(rotations: readonly (string | null)[], depart: Face = 'F'): M3[] {
  const [yaw, pitch] = VUES[depart];
  const vues: M3[] = [matriceVue(yaw, pitch)];
  for (let i = 1; i < rotations.length; i++) {
    const g = rotations[i] ? matriceDuGeste(rotations[i] as string, 1) : null;
    vues.push(g ? multiplier(g, vues[i - 1]) : vues[i - 1]);
  }
  return vues;
}

function versMatrix3d(m: M3): string {
  // matrix3d est en COLONNES.
  return `matrix3d(${m[0]},${m[3]},${m[6]},0,${m[1]},${m[4]},${m[7]},0,${m[2]},${m[5]},${m[8]},0,0,0,0,1)`;
}

function matrixFor(faceletIndex: number): string {
  const f = FACELETS[faceletIndex];
  const right = css(FACE_RIGHT[f.face]);
  const down = css(FACE_DOWN[f.face]);
  const normal = css(FACE_NORMAL[f.face]);
  const n = FACE_NORMAL[f.face];
  const r = FACE_RIGHT[f.face];
  const d = FACE_DOWN[f.face];
  const pos: V3 = [
    n[0] * HALF + r[0] * (f.col - 1) * CELL + d[0] * (f.row - 1) * CELL,
    n[1] * HALF + r[1] * (f.col - 1) * CELL + d[1] * (f.row - 1) * CELL,
    n[2] * HALF + r[2] * (f.col - 1) * CELL + d[2] * (f.row - 1) * CELL,
  ];
  const p = css(pos);
  return `matrix3d(${right.join(',')},0,${down.join(',')},0,${normal.join(',')},0,${p.join(',')},1)`;
}

const DEFAULT_COLORS: Record<Face, string> = {
  U: '#f5f5f2',
  R: '#c8321f',
  F: '#149c4e',
  D: '#f2ce22',
  L: '#e8701a',
  B: '#1b4fbf',
};

export class Cube3D {
  private root: HTMLDivElement;
  private cube: HTMLDivElement;
  private stickers: HTMLDivElement[] = [];
  private baseMatrix: string[] = [];
  private colors: Record<Face, string> = { ...DEFAULT_COLORS };
  private state = FACES.map((f) => f.repeat(9)).join('');
  private vue: M3 = matriceVue(-30, -20);
  private animating = false;
  private loopTimer: number | null = null;
  /** Rotation supplementaire du cube entier, pendant une demonstration de geste. */
  private geste: M3 | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'cube3d';
    this.cube = document.createElement('div');
    this.cube.className = 'cube3d-body';
    this.root.appendChild(this.cube);
    host.appendChild(this.root);

    for (let i = 0; i < 54; i++) {
      const el = document.createElement('div');
      el.className = 'cube3d-sticker';
      el.style.width = `${STICKER}px`;
      el.style.height = `${STICKER}px`;
      el.style.marginLeft = `${-STICKER / 2}px`;
      el.style.marginTop = `${-STICKER / 2}px`;
      const m = matrixFor(i);
      this.baseMatrix.push(m);
      el.style.transform = m;
      this.cube.appendChild(el);
      this.stickers.push(el);
    }
    this.applyView();
    this.render();
    this.enableDrag();
  }

  get element(): HTMLElement {
    return this.root;
  }

  setColors(map: Partial<Record<Face, string>>): void {
    this.colors = { ...this.colors, ...map };
    this.render();
  }

  setState(facelets: string): void {
    this.state = facelets;
    this.render();
  }

  getState(): string {
    return this.state;
  }

  /** Oriente le cube par une matrice, pour suivre une orientation accumulee. */
  setViewMatrix(m: M3): void {
    this.vue = m;
    this.applyView();
  }

  setView(yaw: number, pitch: number): void {
    this.setViewMatrix(matriceVue(yaw, pitch));
  }

  /** Oriente la vue pour montrer une face donnee de face. */
  faceCamera(face: Face): void {
    const [y, p] = VUES[face];
    this.setView(y, p);
  }

  private applyView(): void {
    this.cube.style.transform = versMatrix3d(
      this.geste ? multiplier(this.geste, this.vue) : this.vue,
    );
  }

  private render(): void {
    for (let i = 0; i < 54; i++) {
      const ch = this.state[i] as Face;
      this.stickers[i].style.background = this.colors[ch] ?? '#333';
    }
  }

  private enableDrag(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (e: PointerEvent) => {
      // On rend la main : l'utilisateur veut inspecter, pas subir la boucle.
      this.stopDemo();
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.root.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      // Boule de commande : on tourne autour des axes de l'ECRAN, donc on
      // compose a gauche. Un lacet/tangage accumule se tordrait des que le
      // cube n'est plus dans son orientation de reference.
      const dx = (e.clientX - lastX) * 0.5;
      const dy = (e.clientY - lastY) * 0.5;
      this.vue = multiplier(multiplier(rotationX(-dy), rotationY(dx)), this.vue);
      lastX = e.clientX;
      lastY = e.clientY;
      this.applyView();
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      try {
        this.root.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    this.root.addEventListener('pointerdown', down);
    this.root.addEventListener('pointermove', move);
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
  }

  /** Facettes appartenant a la couche d'une face (les 9 du dessus + 12 laterales). */
  private layerIndices(face: Face): number[] {
    const n = FACE_NORMAL[face];
    return FACELETS.filter((f) => f.pos[0] * n[0] + f.pos[1] * n[1] + f.pos[2] * n[2] === 1).map(
      (f) => f.index,
    );
  }

  private setLayerAngle(face: Face, indices: number[], angle: number): void {
    const n = css(FACE_NORMAL[face]);
    const prefix = angle === 0 ? '' : `rotate3d(${n.join(',')},${angle}deg) `;
    for (const i of indices) {
      this.stickers[i].style.transform = prefix + this.baseMatrix[i];
    }
  }

  /** Joue un mouvement et met a jour l'etat. */
  animateMove(move: string, duration = 420): Promise<void> {
    if (this.animating) return Promise.resolve();
    const face = move[0] as Face;
    const quarter = move.endsWith('2') ? 2 : 1;
    const sign = move.endsWith("'") ? -1 : 1;
    const total = sign * 90 * quarter;
    const indices = this.layerIndices(face);
    this.animating = true;

    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        // adoucissement : demarrage et arrivee amortis
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.setLayerAngle(face, indices, total * eased);
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          this.setLayerAngle(face, indices, 0);
          this.state = applyPermStr(this.state, permOf(move));
          this.render();
          this.animating = false;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  /**
   * Montre le mouvement a faire en boucle, sans modifier l'etat : la couche
   * part, revient, repart. C'est la consigne la plus lisible possible.
   */
  demonstrate(move: string | null, period = 1500): void {
    this.stopDemo();
    if (!move) return;
    const face = move[0] as Face;
    const quarter = move.endsWith('2') ? 2 : 1;
    const sign = move.endsWith("'") ? -1 : 1;
    const total = sign * 90 * quarter;
    const indices = this.layerIndices(face);
    const start = performance.now();

    const tick = () => {
      const elapsed = (performance.now() - start) % period;
      const p = elapsed / period;
      let angle: number;
      if (p < 0.55) {
        const t = p / 0.55;
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        angle = total * eased;
      } else if (p < 0.78) {
        angle = total;
      } else {
        angle = 0;
      }
      this.setLayerAngle(face, indices, angle);
      this.loopTimer = requestAnimationFrame(tick);
    };
    this.loopTimer = requestAnimationFrame(tick);
  }

  /**
   * Montre en boucle le GESTE a faire avec le cube entier : rien ne tourne a
   * l'interieur, c'est la main qui bascule ou pivote le cube.
   *
   * Le cycle marque un temps sur la face de depart, effectue la rotation, puis
   * marque un temps sur la face d'arrivee : sans ces pauses, l'oeil ne sait
   * plus ou le geste commence ni ou il finit.
   */
  demonstrateGesture(generateur: string | null, period = 2800): void {
    this.stopDemo();
    if (!generateur) return;
    if (!rotationDuGeste(generateur)) return;

    const start = performance.now();
    const tick = () => {
      const p = ((performance.now() - start) % period) / period;
      let t: number;
      if (p < 0.2) t = 0;
      else if (p < 0.62) {
        const u = (p - 0.2) / 0.42;
        t = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      } else t = 1;
      this.geste = matriceDuGeste(generateur, t);
      this.applyView();
      this.loopTimer = requestAnimationFrame(tick);
    };
    this.loopTimer = requestAnimationFrame(tick);
  }

  stopDemo(): void {
    if (this.loopTimer !== null) {
      cancelAnimationFrame(this.loopTimer);
      this.loopTimer = null;
    }
    for (let i = 0; i < 54; i++) this.stickers[i].style.transform = this.baseMatrix[i];
    if (this.geste) {
      this.geste = null;
      this.applyView();
    }
  }

  dispose(): void {
    this.stopDemo();
    this.root.remove();
  }
}
