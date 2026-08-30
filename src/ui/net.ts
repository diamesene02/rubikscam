/**
 * Patron deplie du cube : verification et correction manuelle.
 *
 * Filet de securite indispensable : meme a 99 % de reussite, il faut un endroit
 * ou l'utilisateur voit d'un coup d'oeil ce qui a ete lu et peut corriger un
 * sticker d'un simple appui. Les lectures peu sures sont signalees pour que
 * l'oeil aille directement au bon endroit.
 */

import { FACES, type Face } from '../core/geometry';
import { echangerFaces, tournerFace } from '../core/cube';

/**
 * Le patron en croix. Les lignes 0, 4 et 8 sont RESERVEES aux reperes de faces
 * (« haut », « devant »…) : sans elles, les etiquettes se posaient sur la
 * rangee de stickers du dessus et la rendaient illisible.
 */
const LAYOUT: Record<Face, { col: number; row: number }> = {
  U: { col: 3, row: 1 },
  L: { col: 0, row: 5 },
  F: { col: 3, row: 5 },
  R: { col: 6, row: 5 },
  B: { col: 9, row: 5 },
  D: { col: 3, row: 9 },
};

/** Ligne du repere de chaque face : celle juste au-dessus de son bloc. */
const LIGNE_ETIQUETTE: Record<Face, number> = { U: 0, L: 4, F: 4, R: 4, B: 4, D: 8 };

/**
 * Nom de chaque face, du point de vue de l'utilisateur qui tient son cube
 * comme l'ancrage le lui demande. Sans ces reperes, le patron dessine six
 * carres sans dire lequel est le haut ni lequel est la gauche — et la
 * comparaison avec le cube reel devient impossible.
 */
const NOM_FACE: Record<Face, string> = {
  U: 'haut',
  L: 'gauche',
  F: 'devant',
  R: 'droite',
  B: 'arriere',
  D: 'bas',
};

export interface NetOptions {
  onChange?(facelets: string): void;
  /** Le mode « tourner une face » vient de se desarmer tout seul. */
  onRotationFinie?(): void;
  editable?: boolean;
}

export class CubeNet {
  private root: HTMLDivElement;
  private cells: HTMLButtonElement[] = [];
  private state: string;
  private colors: Record<Face, string>;
  private options: NetOptions;

  constructor(host: HTMLElement, initial: string, colors: Record<Face, string>, options: NetOptions = {}) {
    this.state = initial;
    this.colors = colors;
    this.options = options;
    this.root = document.createElement('div');
    this.root.className = 'net';
    host.appendChild(this.root);

    // Les reperes, poses avant les cases pour rester derriere elles.
    for (const face of FACES) {
      const pos = LAYOUT[face];
      const etiquette = document.createElement('span');
      etiquette.className = 'net-etiquette';
      etiquette.textContent = NOM_FACE[face];
      etiquette.style.gridColumn = `${pos.col + 1} / span 3`;
      etiquette.style.gridRow = `${LIGNE_ETIQUETTE[face] + 1}`;
      this.root.appendChild(etiquette);
    }

    for (let i = 0; i < 54; i++) {
      const face = FACES[Math.floor(i / 9)];
      const r = Math.floor((i % 9) / 3);
      const c = i % 3;
      const pos = LAYOUT[face];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'net-cell';
      btn.style.gridColumn = `${pos.col + c + 1}`;
      btn.style.gridRow = `${pos.row + r + 1}`;
      btn.dataset.index = String(i);
      btn.setAttribute(
        'aria-label',
        r === 1 && c === 1
          ? `Centre de la face ${face} : echanger cette face avec une autre`
          : `Face ${face}, ligne ${r + 1}, colonne ${c + 1}`,
      );
      if (options.editable !== false) {
        btn.addEventListener('click', () => this.cycle(i));
      } else {
        btn.disabled = true;
      }
      this.root.appendChild(btn);
      this.cells.push(btn);
    }
    this.render();
  }

  get element(): HTMLElement {
    return this.root;
  }

  setColors(colors: Record<Face, string>): void {
    this.colors = colors;
    this.render();
  }

  setState(facelets: string): void {
    this.state = facelets;
    this.render();
  }

  getState(): string {
    return this.state;
  }

  /** Surligne des facettes (lectures douteuses ou incoherences). */
  highlight(indices: number[], kind: 'doute' | 'erreur' = 'doute'): void {
    for (const cell of this.cells) {
      cell.classList.remove('doute', 'erreur');
    }
    for (const i of indices) {
      this.cells[i]?.classList.add(kind);
    }
  }

  /** Mode « tourner une face » : le prochain appui pivote la face touchee. */
  private rotation = false;

  setModeRotation(actif: boolean): void {
    this.rotation = actif;
    this.root.classList.toggle('net-rotation', actif);
  }

  private cycle(index: number): void {
    if (this.rotation) {
      // Corriger une face enregistree de travers : ses neuf stickers sont
      // justes, seulement pivotes.
      //
      // Le mode se DESARME aussitot. Un mode collant est un piege : on l'active,
      // on l'oublie, et chaque appui suivant fait pivoter huit stickers alors
      // qu'on voulait n'en changer qu'un. Une intention = un geste.
      this.rotation = false;
      this.root.classList.remove('net-rotation');
      this.state = tournerFace(this.state, Math.floor(index / 9));
      this.render();
      this.options.onRotationFinie?.();
      this.options.onChange?.(this.state);
      return;
    }
    // Toucher un CENTRE ne change pas sa couleur — deux centres identiques
    // decriraient un cube impossible. Cela ECHANGE la face avec celle qui
    // porte deja cette couleur au centre : c'est l'operation dont on a besoin
    // quand une face a ete rangee au mauvais endroit, et elle laisse toujours
    // six centres distincts.
    if (index % 9 === 4) {
      const face = (index - 4) / 9;
      const actuelle = this.state[index] as Face;
      const voulue = FACES[(FACES.indexOf(actuelle) + 1) % 6];
      let autre = -1;
      for (let f = 0; f < 6; f++) if (this.state[f * 9 + 4] === voulue) autre = f;
      if (autre < 0) return;
      this.state = echangerFaces(this.state, face, autre);
      this.render();
      this.options.onChange?.(this.state);
      return;
    }
    const current = this.state[index] as Face;
    const next = FACES[(FACES.indexOf(current) + 1) % 6];
    this.state = this.state.slice(0, index) + next + this.state.slice(index + 1);
    this.render();
    this.options.onChange?.(this.state);
  }

  private render(): void {
    for (let i = 0; i < 54; i++) {
      const ch = this.state[i] as Face;
      this.cells[i].style.background = this.colors[ch] ?? '#444';
      this.cells[i].classList.toggle('centre', i % 9 === 4);
    }
  }
}
