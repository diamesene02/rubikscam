/**
 * Le dessin de la consigne.
 *
 * Il doit repondre a UNE question : qu'est-ce qui bouge ? Un bloc plein
 * surmonte d'une fleche n'y repond pas — l'utilisateur ne sait pas s'il doit
 * tourner l'etage du haut ou le cube entier, et les deux gestes donnent des
 * resultats differents.
 *
 * D'ou un cube dessine en ETAGES SEPARES : celui du haut, en couleur et
 * legerement decolle, porte la fleche ; les deux autres restent gris et
 * immobiles. La separation dit le geste mieux qu'une phrase.
 *
 * La fleche est PLATE, posee par-dessus, et non dessinee en perspective sur
 * les facettes : selon la mesure faite sur des solutions reelles, deux tiers
 * des consignes tomberaient sur une face vue tres inclinee, ou une fleche en
 * perspective devient illisible.
 */

import type { PositionFace, SensCouche } from '../core/consigne';

const CX = 100;
const DEMI_L = 62; // demi-largeur du losange
const DEMI_H = 31; // demi-hauteur du losange
const Y_HAUT = 42; // centre du losange de l'etage superieur
const EP_ETAGE = 20; // epaisseur d'un etage
const ECART = 9; // decollement de l'etage du haut

/** Les quatre sommets d'un losange centre a (CX, y). */
function losange(y: number): string {
  return [
    `${CX},${y - DEMI_H}`,
    `${CX + DEMI_L},${y}`,
    `${CX},${y + DEMI_H}`,
    `${CX - DEMI_L},${y}`,
  ].join(' ');
}

/** Un etage : son dessus, puis ses deux flancs visibles. */
function etage(y: number, dessus: string, flancGauche: string, flancDroit: string): string {
  const bas = y + EP_ETAGE;
  return `
    <polygon points="${CX - DEMI_L},${y} ${CX},${y + DEMI_H} ${CX},${bas + DEMI_H} ${CX - DEMI_L},${bas}"
      fill="${flancGauche}" stroke="rgba(0,0,0,.5)" stroke-width="2" />
    <polygon points="${CX},${y + DEMI_H} ${CX + DEMI_L},${y} ${CX + DEMI_L},${bas} ${CX},${bas + DEMI_H}"
      fill="${flancDroit}" stroke="rgba(0,0,0,.5)" stroke-width="2" />
    <polygon points="${losange(y)}" fill="${dessus}" stroke="rgba(0,0,0,.5)" stroke-width="2" />`;
}

/** Assombrit une couleur hexadecimale, pour les flancs de l'etage colore. */
function sombre(css: string, facteur: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return 'rgba(0,0,0,.35)';
  const [r, g, b] = [0, 2, 4].map((i) => Math.round(parseInt(m[1].slice(i, i + 2), 16) * facteur));
  return `rgb(${r},${g},${b})`;
}

/** La fleche, inscrite dans le losange du dessus. */
const RX = 34;
const RY = 17;

function surEllipse(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + RX * Math.cos(a), Y_HAUT + RY * Math.sin(a)];
}

function pointe(deg: number, versAngleCroissant: boolean): string {
  const [x, y] = surEllipse(deg);
  const a = (deg * Math.PI) / 180;
  const s = versAngleCroissant ? 1 : -1;
  const tx = -RX * Math.sin(a) * s;
  const ty = RY * Math.cos(a) * s;
  const n = Math.hypot(tx, ty) || 1;
  const [ux, uy] = [tx / n, ty / n];
  const barbe = (signe: number) => {
    const c = Math.cos((142 * Math.PI) / 180);
    const si = Math.sin((142 * Math.PI) / 180) * signe;
    return `${x + 13 * (ux * c - uy * si)} ${y + 13 * (ux * si + uy * c)}`;
  };
  return `<path d="M ${barbe(1)} L ${x} ${y} L ${barbe(-1)}" fill="none" stroke="#fff"
    stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />`;
}

function arc(deb: number, fin: number, sens: number): string {
  const [x1, y1] = surEllipse(deb);
  const [x2, y2] = surEllipse(fin);
  return `M ${x1} ${y1} A ${RX} ${RY} 0 0 ${sens} ${x2} ${y2}`;
}

/**
 * La fleche dessine l'ANGLE reellement demande.
 *
 * Un quart de tour parcourt un quart d'ellipse, un demi-tour la moitie. Dessiner
 * le meme arc pour les deux — comme c'etait le cas — donne une image qui
 * contredit le texte : « demi-tour » avec un dessin de quart de tour.
 *
 * Le trajet part toujours de la rangee la plus PROCHE de l'utilisateur (le bas
 * du losange), parce que c'est elle que la phrase nomme.
 */
function fleche(sens: SensCouche): string {
  const ombre = (d: string) =>
    `<path d="${d}" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="12" stroke-linecap="round" />`;
  const trait = (d: string) =>
    `<path d="${d}" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" />`;

  if (sens === 'demi') {
    // Un demi-tour : la rangee proche va jusqu'a l'oppose. Deux pointes, car le
    // sens n'a aucune importance — et c'est ce que dit la phrase.
    const d = arc(88, 272, 1);
    return `${ombre(d)}${trait(d)}${pointe(272, true)}${pointe(88, false)}`;
  }
  // Un quart de tour : de la rangee proche jusqu'au bord de gauche ou de droite.
  const versGauche = sens === 'gauche';
  const d = versGauche ? arc(88, 176, 1) : arc(92, 4, 0);
  return `${ombre(d)}${trait(d)}${versGauche ? pointe(176, true) : pointe(4, false)}`;
}

/**
 * La face DEVANT, vue droit dans les yeux : un carre, et la fleche de rotation
 * dessus. Pas de perspective — on la regarde de face, c'est tout l'interet de
 * n'autoriser que les deux faces qu'on voit franchement.
 */
function faceDevant(sens: SensCouche, couleur: string): string {
  const ombre = (d: string) =>
    `<path d="${d}" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="13" stroke-linecap="round" />`;
  const trait = (d: string) =>
    `<path d="${d}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" />`;
  const R = 40;
  const [cx, cy] = [100, 92];
  const p = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  };
  const tete = (deg: number, horaire: boolean) => {
    const [x, y] = p(deg);
    const a = (deg * Math.PI) / 180;
    const s = horaire ? 1 : -1;
    const [ux, uy] = [-Math.sin(a) * s, Math.cos(a) * s];
    const barbe = (signe: number) => {
      const c = Math.cos((142 * Math.PI) / 180);
      const si = Math.sin((142 * Math.PI) / 180) * signe;
      return `${x + 15 * (ux * c - uy * si)} ${y + 15 * (ux * si + uy * c)}`;
    };
    return `<path d="M ${barbe(1)} L ${x} ${y} L ${barbe(-1)}" fill="none" stroke="#fff"
      stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />`;
  };
  const arc = (a: number, b: number, sweep: number) =>
    `M ${p(a).join(' ')} A ${R} ${R} 0 0 ${sweep} ${p(b).join(' ')}`;

  // La rangee du HAUT part a droite (horaire) ou a gauche (anti-horaire).
  const d =
    sens === 'demi' ? arc(200, 340, 1) : sens === 'droite' ? arc(200, 290, 1) : arc(340, 250, 0);
  const pointes =
    sens === 'demi'
      ? `${tete(340, true)}${tete(200, false)}`
      : sens === 'droite'
        ? tete(290, true)
        : tete(250, false);

  return `
    <rect x="42" y="34" width="116" height="116" rx="10" fill="${couleur}"
      stroke="rgba(0,0,0,.5)" stroke-width="2" />
    ${ombre(d)}${trait(d)}${pointes}`;
}

export function pictogramme(
  sens: SensCouche,
  couleur: string,
  position: PositionFace = 'dessus',
): string {
  const corps =
    position === 'devant'
      ? faceDevant(sens, couleur)
      : (() => {
          const yMilieu = Y_HAUT + EP_ETAGE + ECART;
          const yBas = yMilieu + EP_ETAGE;
          return `
    ${etage(yBas, '#232b3d', '#161d2c', '#111726')}
    ${etage(yMilieu, '#2b3548', '#1b2334', '#151b2b')}
    ${etage(Y_HAUT, couleur, sombre(couleur, 0.62), sombre(couleur, 0.45))}
    ${fleche(sens)}`;
        })();
  return `<svg viewBox="0 0 200 180" width="100%" height="100%" role="img"
    aria-label="${position === 'devant' ? 'La face devant toi tourne' : 'Seul l etage du haut tourne'}, ${
      sens === 'demi' ? 'deux quarts de tour' : `vers ta ${sens}`
    }">${corps}</svg>`;
}
