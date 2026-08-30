/**
 * Grille de visee dessinee par-dessus la video.
 *
 * Elle affiche la couleur reellement echantillonnee dans chaque case : c'est le
 * retour le plus honnete possible, l'utilisateur voit immediatement si le
 * cadrage ou la lumiere posent probleme, avant meme la capture.
 */

import type { CellSample, GridRect } from '../media/sampler';
import { rgbToCss } from '../core/color';

export interface Lattice {
  cells: { x: number; y: number }[];
  ux: number;
  uy: number;
  vx: number;
  vy: number;
}

export interface OverlayFrame {
  /** Rectangle englobant, en coordonnees d'affichage (pixels CSS). */
  rect: GridRect;
  cells: CellSample[] | null;
  /** Progression de la capture [0..1]. */
  progress: number;
  /** Etat visuel de la grille. */
  status: 'attente' | 'stable' | 'probleme';
  /**
   * Reseau detecte. Quand il est fourni, on dessine les 9 cases exactement la
   * ou elles ont ete lues — donc penchees si le cube est penche. L'utilisateur
   * voit ainsi ce que l'application voit, et non un cadre theorique.
   */
  lattice?: Lattice;
}

export class GridOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(frame: OverlayFrame): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    const accent =
      frame.status === 'stable' ? '#4ade80' : frame.status === 'probleme' ? '#fb7185' : '#e2e8f0';
    const { rect } = frame;
    const rayon = Math.max(6, Math.min(rect.width, rect.height) * 0.05);

    // assombrissement autour de la zone lue, pour guider l'oeil
    ctx.save();
    ctx.fillStyle = 'rgba(6, 8, 14, 0.5)';
    ctx.beginPath();
    ctx.rect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);
    roundRect(ctx, rect.x - 4, rect.y - 4, rect.width + 8, rect.height + 8, rayon);
    ctx.fill('evenodd');
    ctx.restore();

    if (frame.lattice) {
      const { cells, ux, uy, vx, vy } = frame.lattice;
      const p = 0.42; // demi-cote de la case dessinee
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        ctx.save();
        ctx.beginPath();
        // parallelogramme aligne sur le reseau : la case suit l'inclinaison
        ctx.moveTo(c.x - p * ux - p * vx, c.y - p * uy - p * vy);
        ctx.lineTo(c.x + p * ux - p * vx, c.y + p * uy - p * vy);
        ctx.lineTo(c.x + p * ux + p * vx, c.y + p * uy + p * vy);
        ctx.lineTo(c.x - p * ux + p * vx, c.y - p * uy + p * vy);
        ctx.closePath();
        const sample = frame.cells?.[i];
        if (sample) {
          ctx.fillStyle = rgbToCss(sample.rgb);
          ctx.fill();
        }
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = sample && sample.clipped > 0.25 ? '#fb7185' : 'rgba(255,255,255,0.8)';
        ctx.stroke();
        ctx.restore();
      }
    } else {
      // repli : cadre theorique, tant qu'aucun cube n'est repere
      const cell = rect.width / 3;
      const pad = cell * 0.08;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.save();
          roundRect(
            ctx,
            rect.x + c * cell + pad,
            rect.y + r * cell + pad,
            cell - pad * 2,
            cell - pad * 2,
            cell * 0.16,
          );
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,255,255,0.45)';
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    roundRect(ctx, rect.x - 4, rect.y - 4, rect.width + 8, rect.height + 8, rayon);
    ctx.stroke();

    if (frame.progress > 0) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      const perimetre = 2 * (rect.width + rect.height);
      ctx.setLineDash([perimetre * frame.progress, perimetre]);
      roundRect(ctx, rect.x - 4, rect.y - 4, rect.width + 8, rect.height + 8, rayon);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
