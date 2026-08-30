/**
 * Orchestration de l'application.
 *
 * Une seule boucle d'analyse tourne en continu, calee sur la cadence de la
 * camera (`requestVideoFrameCallback` quand il existe) : elle echantillonne la
 * grille, puis alimente soit le scan, soit le suivi de resolution. Aucun
 * traitement lourd n'est fait sur le fil principal — le solveur est dans un
 * worker, et l'echantillonnage ne lit que la zone utile de l'image.
 */

import { Camera, ScreenLock } from '../media/camera';
import {
  TemporalAccumulator,
  assessFace,
  maxCellDelta,
  maxCellDeltaNormalise,
  sampleLattice,
  type CellSample,
  type GridRect,
} from '../media/sampler';
import { FaceDetector, LatticeSmoother, type Detection } from '../media/detector';
import {
  classifyCube,
  rgbToCss,
  sameStickerColor,
  toLinear,
  type Lin,
  type RGB,
} from '../core/color';
import { repairReading, suspectFaces } from '../core/repair';
import { findValidArrangement } from '../core/arrange';
import {
  NOMS_COULEUR,
  consignePour,
  motPosition,
  prochainePrise,
  type PositionFace,
} from '../core/consigne';
import { pictogramme } from './pictogramme';
import {
  SOLVED_FACELETS,
  applyAlg,
  randomScramble,
  validate,
  type Facelets,
} from '../core/cube';
import {
  FACES,
  IDENTITY_ORIENTATION,
  ORIENTATIONS,
  applyPermStr,
  invertAlg,
  type Face,
} from '../core/geometry';
import { SCAN_PLAN, faceletsOfStep, type ScanStep } from '../core/scanPlan';
import {
  SolveSession,
  visibleFace,
} from '../core/tracking';
import { SolverClient } from '../core/solverClient';
import { GridOverlay } from './overlay';
import { CubeNet } from './net';
import {
  Cube3D,
  matriceOrientation,
  matriceVue,
  multiplier,
  vuesDuParcours,
} from './cube3d';
import { Speaker } from './speech';

type Ecran = 'accueil' | 'parcours' | 'scan' | 'verif' | 'resolution' | 'fin';



/** Largeur de travail de l'analyse : assez fine pour la couleur, assez petite
 *  pour rester tres au-dessus de la cadence video. */
const LARGEUR_ANALYSE = 360;
/**
 * Lectures CONSOLIDEES stables requises avant une capture automatique.
 * On juge la stabilite sur la mediane temporelle, pas sur les pixels bruts :
 * a main levee, avec un reflet qui bouge, les pixels bruts ne sont jamais
 * stables — exiger cela revient a ne jamais capturer.
 */
const STABILITE_REQUISE = 5;
/** Ecart maximal entre deux lectures consolidees pour les juger identiques. */
const SEUIL_STABILITE = 11;
/** Au-dela, l'image a trop change : le cube a bouge, on repart de zero. */
const SEUIL_MOUVEMENT = 26;
/** Images minimales dans l'accumulateur avant d'envisager une capture. */
const IMAGES_MINIMALES = 7;
/** Apres ce delai a voir le cube sans capturer, on capture quoi qu'il arrive. */
const PATIENCE_MAX = 5000;
/**
 * Ecart MINIMAL avec la face precedemment capturee pour accepter la suivante.
 * Sans ce verrou, l'application capture la face suivante moins d'une demi-
 * seconde apres la precedente, avant meme que l'utilisateur ait eu le temps de
 * tourner le cube : elle enregistre alors quatre fois la meme face.
 */
const SEUIL_CHANGEMENT = 20;

/** Le fond est-il assez clair pour porter du texte sombre ? */
function clair(css: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim()) ?? /rgb\((\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(css);
  if (!m) return false;
  const [r, g, b] = m[0].startsWith('#') || m[1].length === 6
    ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
    : [Number(m[1]), Number(m[2]), Number(m[3])];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}
/** Nombre de lectures les moins nettes signalees a l'oeil, sur les 54. */
const STICKERS_SIGNALES = 6;
/** Delai minimal entre deux captures, pour laisser le temps du geste. */
const DELAI_ENTRE_CAPTURES = 900;
/**
 * Apres une capture, la vue doit AVOIR CHANGE avant qu'une autre soit
 * acceptee. Un simple delai ne suffit pas : si la main n'a pas encore tourne
 * le cube, la meme face est enregistree deux fois de suite et le scan defile
 * sans laisser le temps de bouger. Le seuil de liberation est plus haut que
 * celui du verrou anti-doublon, et il faut le tenir sur plusieurs images pour
 * qu'un reflet passager ne libere pas le verrou.
 */
const SEUIL_LIBERATION = 34;
const IMAGES_CHANGEMENT = 3;
/**
 * Images de transition exigees entre deux captures. Tourner un cube d'un quart
 * de tour devant une camera a 30 img/s en produit largement plus ; le poser ou
 * trembler, non.
 */
const IMAGES_MOUVEMENT_REQUISES = 4;


function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`element introuvable : ${id}`);
  return el;
}

export class App {
  private camera: Camera;
  private overlay: GridOverlay;
  private solver: SolverClient;
  private speaker = new Speaker();
  private lock = new ScreenLock();

  private work = document.createElement('canvas');
  private workCtx = this.work.getContext('2d', { willReadFrequently: true })!;
  private detecteur = new FaceDetector();
  private lissage = new LatticeSmoother();
  private cadreTrouve = false;
  /** Depuis quand le cube est vu sans interruption (0 = pas vu). */
  private vuDepuis = 0;
  private compteurImages = 0;
  /** Derniere lecture consolidee, pour juger la stabilite. */
  private consolidePrecedent: CellSample[] | null = null;

  private ecran: Ecran = 'accueil';
  private running = false;
  private frameHandle: number | null = null;

  // --- scan ---
  private etape = 0;
  /**
   * 18 images : plus la fenetre est longue, mieux la mediane temporelle mange
   * les reflets, qui se deplacent quand la main bouge. Le cout est negligeable
   * (on trie 18 valeurs pour 9 cases).
   */
  private accumulateur = new TemporalAccumulator(18, 0.3);
  private derniere: CellSample[] | null = null;
  private stabilite = 0;
  private derniereBaisseExposition = 0;
  /** Faces deja enregistrees, pour exiger un changement avant la suivante. */
  private capturesBrutes: CellSample[][] = [];
  private instantDerniereCapture = 0;
  /** Vue au moment de la derniere capture : sert a exiger un vrai changement. */
  private vueDerniereCapture: CellSample[] | null = null;
  /** Images consecutives ou la vue a franchement change depuis cette capture. */
  private imagesDepuisChangement = 0;
  /** Images de transition (cube en mouvement) vues depuis la derniere capture. */
  private imagesDeMouvement = 0;
  private echantillons: (RGB | null)[] = new Array(54).fill(null);
  private centresLin: (Lin | null)[] = new Array(6).fill(null);
  /** Lectures brutes des 9 cases, par face, telles que vues a la camera. */
  private echantillonsParFace: (RGB[] | null)[] = new Array(6).fill(null);
  private relecture: ScanStep | null = null;
  /** Nombre de relectures automatiques deja demandees pour ce scan. */
  private relecturesDemandees = 0;
  /** Face que l'utilisateur peut choisir de relire depuis la verification. */
  private faceARelire: ScanStep | null = null;
  private capturesFaites = new Set<number>();

  // --- resolution ---
  private session: SolveSession | null = null;
  /** Cubes legaux compatibles avec le scan ; l'utilisateur tranche. */
  private lecturesPossibles: string[] = [];
  private lectureChoisie = 0;
  private modeRotation = false;
  /** Etat lu au moment ou la resolution a commence, pour le diagnostic. */
  private etatInitialResolution = '';
  /**
   * Prise supposee de l'utilisateur : l'orientation dans laquelle il tient son
   * cube. Elle n'est PAS devinee — c'est l'application qui la lui dicte, et qui
   * ne la change que lorsqu'elle y est obligee.
   *
   * Mesure sur 25 solutions reelles : n'autoriser que le dessus impose 20,2
   * reorientations pour 20,5 mouvements — une avant chaque geste. En acceptant
   * aussi la face DEVANT, on tombe a 15,2, soit un quart de moins. Les faces de
   * droite et d'arriere descendraient a 9,6 mais demanderaient de se
   * representer une rotation vue de biais : c'est la projection mentale qui
   * fait les erreurs, on s'arrete donc aux deux faces qu'on regarde en face.
   */
  private prise = IDENTITY_ORIENTATION;
  private couleurs: Record<Face, string> = {
    U: '#f5f5f2',
    R: '#c8321f',
    F: '#149c4e',
    D: '#f2ce22',
    L: '#e8701a',
    B: '#1b4fbf',
  };
  /**
   * Nom de la couleur de chaque face, tel qu'on le DIT a l'utilisateur.
   * Les valeurs par defaut correspondent aux couleurs par defaut ci-dessus :
   * sans elles, le mode demo — qui ne passe jamais par `analyserScan` — n'aurait
   * aucun nom a annoncer.
   */
  private nomsCouleur: Record<Face, string> = {
    U: 'blanc',
    R: 'rouge',
    F: 'vert',
    D: 'jaune',
    L: 'orange',
    B: 'bleu',
  };
  /** Couleurs telles que mesurees, pour le diagnostic. */
  private couleursMesurees: Record<Face, string> = {
    U: '#f5f5f2',
    R: '#c8321f',
    F: '#149c4e',
    D: '#f2ce22',
    L: '#e8701a',
    B: '#1b4fbf',
  };
  private cube3d: Cube3D | null = null;
  private hint3d: Cube3D | null = null;
  /** Les 6 cubes de l'ecran « Comment scanner ? ». */
  private parcours3d: Cube3D[] = [];
  private net: CubeNet | null = null;
  private etatLu: Facelets = SOLVED_FACELETS;
  private demo = false;
  private demoCube: Facelets = SOLVED_FACELETS;
  private solutionId = 0;
  private dernierMouvementAnnonce = '';

  // --- mesures ---
  private fpsCompteur = 0;
  private fpsDernier = performance.now();

  constructor() {
    this.camera = new Camera($('video') as HTMLVideoElement);
    this.overlay = new GridOverlay($('stage-overlay-host'));
    this.solver = new SolverClient();
    this.solver.ready.then(() => {
      const el = $('statut-solveur');
      el.textContent = `solveur pret (${this.solver.initialisationMs} ms)`;
      el.classList.add('pret');
    });
    this.brancherInterface();
    this.construireProgression();
    this.montrer('accueil');
    window.addEventListener('resize', () => this.redimensionner());
  }

  // ---------------------------------------------------------------- interface

  private brancherInterface(): void {
    $('btn-demarrer').addEventListener('click', () => void this.demarrerCamera());
    $('btn-demo').addEventListener('click', () => this.demarrerDemo());
    $('btn-capturer').addEventListener('click', () => this.capturerMaintenant());
    $('btn-refaire').addEventListener('click', () => this.refaireEtape());
    $('btn-passer').addEventListener('click', () => {
      // porte de sortie : la relecture n'est jamais imposee, on peut en sortir
      this.relecture = null;
      void this.analyserScan();
    });
    $('btn-resoudre').addEventListener('click', () => void this.resoudre());
    $('btn-rescanner').addEventListener('click', () => this.relancerScan());
    $('btn-relire').addEventListener('click', () => this.lancerRelecture());
    $('btn-diagnostic').addEventListener('click', () => void this.copierDiagnostic());
    $('btn-suivant').addEventListener('click', () => this.avancerManuel());
    $('btn-precedent').addEventListener('click', () => this.reculerManuel());
    $('btn-nouveau').addEventListener('click', () => this.relancerScan());
    $('btn-relancer-calcul').addEventListener('click', () => this.lancerCalcul());
    $('btn-resync').addEventListener('click', () => this.relancerScan());
    $('btn-recommencer').addEventListener('click', () => this.relancerScan());
    $('btn-torche').addEventListener('click', () => void this.basculerTorche());
    $('btn-camera').addEventListener('click', () => void this.changerCamera());
    $('btn-voix').addEventListener('click', () => this.basculerVoix());
    $('btn-diag-resolution').addEventListener('click', () => void this.copierDiagnosticResolution());
    $('btn-tourner-face').addEventListener('click', () => this.basculerModeRotation());
    $('btn-autre-lecture').addEventListener('click', () => this.autreLecture());
    $('btn-fin-oui').addEventListener('click', () => this.confirmerFin(true));
    $('btn-fin-non').addEventListener('click', () => this.confirmerFin(false));
    $('btn-parcours').addEventListener('click', () => this.montrerParcours());
    $('btn-parcours-retour').addEventListener('click', () => this.montrer('accueil'));
    $('btn-parcours-scanner').addEventListener('click', () => void this.demarrerCamera());
  }

  /**
   * Ecran « Comment scanner ? » : les 6 gestes rejoues en boucle.
   *
   * Montrer la destination ne suffit pas — un utilisateur qui ne voit pas le
   * MOUVEMENT fait volontiers l'inverse. Ici chaque carte rejoue son geste
   * depuis l'orientation reelle du cube a cette etape.
   */
  private montrerParcours(): void {
    const hote = $('parcours-liste');
    if (!this.parcours3d.length) {
      hote.innerHTML = '';
      const vues = vuesDuParcours(SCAN_PLAN.map((s) => s.rotation));
      for (const [i, etape] of SCAN_PLAN.entries()) {
        const carte = document.createElement('div');
        carte.className = 'parcours-carte';

        const rang = document.createElement('span');
        rang.className = 'parcours-rang';
        rang.textContent = `${i + 1} / 6`;
        carte.appendChild(rang);

        const scene = document.createElement('div');
        scene.className = 'parcours-cube';
        carte.appendChild(scene);

        const titre = document.createElement('p');
        titre.className = 'parcours-titre';
        titre.textContent = etape.titre;
        carte.appendChild(titre);

        const detail = document.createElement('p');
        detail.className = 'parcours-detail';
        detail.textContent = etape.detail;
        carte.appendChild(detail);

        hote.appendChild(carte);

        const cube = new Cube3D(scene);
        cube.setColors(this.couleurs);
        cube.setState(SOLVED_FACELETS);
        cube.setViewMatrix(vues[Math.max(0, i - 1)]);
        this.parcours3d.push(cube);
      }
    }
    for (const [i, cube] of this.parcours3d.entries()) {
      // Chaque carte demarre a un instant different : six cubes qui basculent
      // a l'unisson se lisent comme un clignotement, pas comme six gestes.
      const rotation = SCAN_PLAN[i].rotation;
      if (rotation) cube.demonstrateGesture(rotation, 2800 + i * 160);
    }
    this.montrer('parcours');
  }

  private montrer(ecran: Ecran): void {
    if (this.ecran === 'parcours' && ecran !== 'parcours') {
      for (const cube of this.parcours3d) cube.stopDemo();
    }
    this.ecran = ecran;
    const ids: Record<Ecran, string> = {
      accueil: 'ecran-accueil',
      parcours: 'ecran-parcours',
      scan: 'ecran-scan',
      verif: 'ecran-verif',
      resolution: 'ecran-resolution',
      fin: 'ecran-fin',
    };
    for (const [cle, id] of Object.entries(ids)) {
      const el = $(id);
      if (cle === ecran) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    }
    $('btn-recommencer').hidden = ecran === 'accueil';
    document.body.classList.toggle('mode-demo', this.demo);
    /**
     * La camera ne sert QU'AU SCAN.
     *
     * Une fois les six faces lues, l'application connait le cube et la solution
     * entiere : plus rien de ce qu'elle affiche ne depend d'une image. La garder
     * allumee pendant la resolution n'apportait qu'un confort — l'avancement
     * automatique — au prix d'un badge d'etat, de messages de cadrage et d'une
     * video qui bouge, c'est-a-dire du bruit permanent a cote de la consigne.
     */
    const stage = $('stage');
    if (ecran === 'scan') $('ecran-scan').prepend(stage);
    stage.hidden = ecran !== 'scan' || this.demo;
    this.redimensionner();
  }

  private construireProgression(): void {
    const host = $('scan-faces');
    host.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'face-pastille';
      el.textContent = String(i + 1);
      el.dataset.etape = String(i);
      host.appendChild(el);
    }
  }

  private majProgression(): void {
    const host = $('scan-faces');
    for (const el of Array.from(host.children) as HTMLElement[]) {
      const i = Number(el.dataset.etape);
      el.classList.toggle('faite', this.capturesFaites.has(i));
      el.classList.toggle('courante', i === this.etape && !this.relecture);
      if (this.capturesFaites.has(i)) {
        const face = SCAN_PLAN[i].face;
        el.style.background = this.couleursConnues(face) ?? '';
        el.textContent = '';
      } else {
        el.style.background = '';
        el.textContent = String(i + 1);
      }
    }
  }

  private couleursConnues(face: Face): string | null {
    const idx = FACES.indexOf(face);
    const lin = this.centresLin[idx];
    if (!lin) return null;
    const rgb = this.echantillons[idx * 9 + 4];
    return rgb ? rgbToCss(rgb) : null;
  }

  private message(id: string, texte: string, ton: '' | 'ok' | 'alerte' | 'attention' = ''): void {
    const el = $(id);
    el.textContent = texte;
    el.className = `message${ton ? ' ' + ton : ''}`;
  }

  private redimensionner(): void {
    const stage = $('stage');
    const r = stage.getBoundingClientRect();
    if (r.width > 0) this.overlay.resize(r.width, r.height);
  }

  // ------------------------------------------------------------------ camera

  private async demarrerCamera(): Promise<void> {
    const etat = $('accueil-etat');
    if (!navigator.mediaDevices?.getUserMedia) {
      etat.textContent =
        "Ce navigateur ne donne pas acces a la camera. Essaie le mode demo, ou ouvre la page en HTTPS.";
      return;
    }
    etat.textContent = 'Autorisation de la camera…';
    try {
      await this.camera.start({ facingMode: 'environment' });
    } catch (error) {
      etat.textContent = `Camera refusee ou indisponible (${
        error instanceof Error ? error.name : 'erreur'
      }). Verifie l'autorisation du navigateur, ou utilise le mode demo.`;
      return;
    }
    etat.textContent = '';
    this.demo = false;
    const caps = this.camera.capabilities();
    ($('btn-torche') as HTMLButtonElement).hidden = !caps.torch;
    ($('btn-camera') as HTMLButtonElement).hidden = false;
    ($('btn-voix') as HTMLButtonElement).hidden = !this.speaker.available;
    void this.lock.acquire();
    this.reinitialiserScan();
    this.montrer('scan');
    this.demarrerBoucle();
  }

  private async basculerTorche(): Promise<void> {
    const ok = await this.camera.setTorch(!this.camera.torchEnabled);
    $('btn-torche').classList.toggle('actif', ok && this.camera.torchEnabled);
  }

  private async changerCamera(): Promise<void> {
    const cams = await this.camera.listCameras();
    if (cams.length < 2) return;
    const actuel = this.camera.track?.getSettings().deviceId;
    const index = cams.findIndex((c) => c.deviceId === actuel);
    const suivant = cams[(index + 1) % cams.length];
    await this.camera.start({ deviceId: suivant.deviceId });
    this.redimensionner();
  }

  private basculerVoix(): void {
    this.speaker.enabled = !this.speaker.enabled;
    $('btn-voix').classList.toggle('actif', this.speaker.enabled);
    $('btn-voix').textContent = this.speaker.enabled ? '🔊' : '🔈';
    if (this.speaker.enabled) this.speaker.say('Annonces activees');
  }

  // ------------------------------------------------------------- boucle video

  private demarrerBoucle(): void {
    if (this.running) return;
    this.running = true;
    const video = this.camera.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const boucle = () => {
      if (!this.running) return;
      this.traiterImage();
      if (video.requestVideoFrameCallback) {
        this.frameHandle = video.requestVideoFrameCallback(boucle);
      } else {
        this.frameHandle = requestAnimationFrame(boucle);
      }
    };
    boucle();
  }

  private arreterBoucle(): void {
    this.running = false;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  /** Geometrie de l'affichage : object-fit "cover" recadre l'image source. */
  private geometrie(): { largeurAffichee: number; hauteurAffichee: number; echelle: number; offX: number; offY: number } | null {
    const video = this.camera.video;
    const r = $('stage').getBoundingClientRect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || r.width < 10) return null;
    const echelle = Math.max(r.width / vw, r.height / vh);
    return {
      largeurAffichee: r.width,
      hauteurAffichee: r.height,
      echelle,
      offX: (r.width - vw * echelle) / 2,
      offY: (r.height - vh * echelle) / 2,
    };
  }

  /** Cadre par defaut, utilise tant que le cube n'est pas repere. */
  private cadreParDefaut(largeur: number, hauteur: number): GridRect {
    const cote = Math.min(largeur, hauteur) * 0.55;
    return { x: (largeur - cote) / 2, y: (hauteur - cote) / 2, width: cote, height: cote };
  }

  private traiterImage(): void {
    const now = performance.now();
    this.fpsCompteur++;
    if (now - this.fpsDernier > 1000) {
      $('statut-fps').textContent = `${this.fpsCompteur} img/s`;
      this.fpsCompteur = 0;
      this.fpsDernier = now;
    }

    const geo = this.geometrie();
    if (!geo) return;
    const video = this.camera.video;

    const largeur = Math.min(LARGEUR_ANALYSE, video.videoWidth);
    const k = largeur / video.videoWidth;
    const hauteur = Math.round(video.videoHeight * k);
    if (this.work.width !== largeur || this.work.height !== hauteur) {
      this.work.width = largeur;
      this.work.height = hauteur;
    }
    this.workCtx.drawImage(video, 0, 0, largeur, hauteur);
    const image = this.workCtx.getImageData(0, 0, largeur, hauteur);

    // --- ou est le cube ? ---
    // On exige plus de cases pour ACCROCHER une face que pour la garder :
    // c'est ce qui evite de se verrouiller sur un motif du decor tout en
    // continuant a suivre un cube partiellement masque par les doigts.
    // Une fois le cube accroche, on ne relance la recherche qu'une image sur
    // deux : le lissage tient l'intervalle, et on rend la moitie du temps de
    // calcul a la fluidite. Tant qu'on cherche, en revanche, on cherche a
    // chaque image pour accrocher au plus vite.
    const chercher = !this.cadreTrouve || this.compteurImages++ % 2 === 0;
    const detection = chercher
      ? this.detecteur.detect(image.data, largeur, hauteur, {
          minMatched: this.cadreTrouve ? 5 : 7,
        })
      : this.lissage.valeur;
    const reseau = chercher ? this.lissage.push(detection) : this.lissage.valeur;
    this.cadreTrouve = !!reseau && this.lissage.perdu < 8;

    const versEcran = (r: GridRect): GridRect => ({
      x: (r.x / k) * geo.echelle + geo.offX,
      y: (r.y / k) * geo.echelle + geo.offY,
      width: (r.width / k) * geo.echelle,
      height: (r.height / k) * geo.echelle,
    });

    if (!this.cadreTrouve) {
      this.vuDepuis = 0;
      this.derniere = null;
      this.consolidePrecedent = null;
      this.stabilite = 0;
      this.accumulateur.reset();
      // Perdre la face EST une preuve de mouvement — c'est meme le cas le plus
      // frequent quand la main tourne le cube. Sans cette ligne, le verrou
      // anti-doublon ne se libererait jamais apres une rotation franche.
      this.imagesDeMouvement++;
      const repli = this.cadreParDefaut(geo.largeurAffichee, geo.hauteurAffichee);
      this.overlay.draw({ rect: repli, cells: null, progress: 0, status: 'attente' });
      if (this.ecran === 'scan') {
        this.message(
          'scan-message',
          'Je ne vois pas de face de cube. Rapproche-le de la camera et presente une face bien a plat.',
          'attention',
        );
      }
      return;
    }

    if (!this.vuDepuis) this.vuDepuis = now;
    const d = reseau!;
    const cells = sampleLattice(
      image.data,
      largeur,
      hauteur,
      d.cells,
      { x: d.ux, y: d.uy },
      { x: d.vx, y: d.vy },
    );
    const rectAffichage = versEcran(d.rect);

    if (this.ecran === 'scan') this.pendantScan(cells, rectAffichage, d, geo, k);

  }

  // -------------------------------------------------------------------- scan

  private reinitialiserScan(): void {
    this.etape = 0;
    this.relecture = null;
    this.relecturesDemandees = 0;
    this.capturesFaites.clear();
    this.echantillons.fill(null);
    this.centresLin.fill(null);
    this.echantillonsParFace.fill(null);
    this.accumulateur.reset();
    this.lissage.reset();
    this.derniere = null;
    this.consolidePrecedent = null;
    this.vuDepuis = 0;
    this.capturesBrutes = [];
    this.instantDerniereCapture = 0;
    this.vueDerniereCapture = null;
    this.imagesDepuisChangement = 0;
    this.imagesDeMouvement = 0;
    this.stabilite = 0;
    this.majEtape();
    this.majProgression();
  }

  private get etapeCourante(): ScanStep {
    return this.relecture ?? SCAN_PLAN[this.etape];
  }

  private majEtape(): void {
    const step = this.etapeCourante;
    const cible = $('relecture-cible');
    ($('btn-passer') as HTMLButtonElement).hidden = !this.relecture;
    if (this.relecture) {
      $('scan-titre').textContent = 'Relis une face';
      $('scan-detail').textContent =
        "La lecture de cette face n'etait pas sure. Presente-la a nouveau, bien a plat.";
      cible.hidden = false;
      // On DIT quelle face : sans cela, l'utilisateur ne peut pas deviner
      // laquelle relire, et l'ecran devient une impasse.
      ($('relecture-couleur') as HTMLElement).style.background =
        this.couleurs[step.face] ?? '#888';
    } else {
      $('scan-titre').textContent = step.titre;
      $('scan-detail').textContent = step.detail;
      cible.hidden = true;
    }
    $('scan-badge').textContent = this.relecture ? 'relecture' : `${this.etape + 1} / 6`;
    this.afficherIndice(step);
    this.message('scan-message', '');
    this.majProgression();
  }

  /**
   * Petit cube 3D montrant le GESTE a faire, en boucle.
   *
   * Montrer seulement la face d'arrivee ne suffit pas : l'utilisateur voit
   * bien OU il doit arriver, mais pas COMMENT — et fait alors le mouvement
   * inverse une fois sur deux. On rejoue donc le geste depuis l'orientation
   * ou le cube se trouve reellement a cet instant.
   */
  private afficherIndice(step: ScanStep): void {
    const host = $('scan-hint');
    if (!this.hint3d) {
      host.innerHTML = '';
      this.hint3d = new Cube3D(host);
    }
    this.hint3d.setColors(this.couleurs);
    this.hint3d.setState(SOLVED_FACELETS);

    if (this.relecture) {
      // Pas de geste a montrer : la face demandee peut etre n'importe laquelle.
      this.hint3d.stopDemo();
      this.hint3d.faceCamera(step.orientation.faceMapInv.F);
      return;
    }

    const vues = vuesDuParcours(SCAN_PLAN.map((s) => s.rotation));
    const i = this.etape;
    if (i <= 0 || !step.rotation) {
      this.hint3d.stopDemo();
      this.hint3d.setViewMatrix(vues[0]);
      return;
    }
    // On part de l'orientation PRECEDENTE et on rejoue le geste jusqu'a elle.
    this.hint3d.setViewMatrix(vues[i - 1]);
    this.hint3d.demonstrateGesture(step.rotation);
  }

  private pendantScan(
    cells: CellSample[],
    rect: GridRect,
    detection: Detection,
    geo: { echelle: number; offX: number; offY: number },
    k: number,
  ): void {
    const maintenant = performance.now();
    const qualite = assessFace(cells);

    // Un grand ecart entre deux images = le cube a bouge ou tourne : on vide
    // l'accumulateur, sinon la mediane temporelle melangerait deux faces.
    const saut = this.derniere ? maxCellDelta(cells, this.derniere) : 999;
    this.derniere = cells;
    if (saut > SEUIL_MOUVEMENT) {
      // Tourner le cube provoque forcement plusieurs images de transition.
      // C'est ce signal-la, et non un simple ecart de couleurs, qui prouve que
      // la main a agi : sur une image delavee, deux mesures de la MEME face
      // peuvent differer plus que n'importe quel seuil de couleur.
      this.imagesDeMouvement++;
      this.accumulateur.reset();
      this.consolidePrecedent = null;
      this.stabilite = 0;
    } else {
      this.accumulateur.push(cells);
    }

    // Stabilite jugee sur la lecture CONSOLIDEE : la main tremble, la mediane
    // temporelle non. C'est le changement qui rend la capture possible a main
    // levee avec un reflet mouvant.
    const consolide = this.accumulateur.consolidate();
    if (consolide && this.accumulateur.size >= IMAGES_MINIMALES) {
      const ecart = this.consolidePrecedent
        ? maxCellDelta(consolide, this.consolidePrecedent)
        : 999;
      this.consolidePrecedent = consolide;
      if (ecart < SEUIL_STABILITE) this.stabilite++;
      else this.stabilite = Math.max(0, this.stabilite - 1);
    }

    // Verrou anti-doublon : la face doit avoir CHANGE depuis les captures
    // precedentes, sinon on enregistre plusieurs fois la meme avant que la
    // main ait tourne le cube. Comparaison a luminosite normalisee, sans quoi
    // un simple changement de lumiere ferait passer la meme face pour neuve.
    let changement = 999;
    for (const passee of this.capturesBrutes) {
      changement = Math.min(changement, maxCellDeltaNormalise(cells, passee));
    }
    const tropTot = maintenant - this.instantDerniereCapture < DELAI_ENTRE_CAPTURES;

    // Le cube a-t-il VRAIMENT bouge depuis la derniere capture ? Tant que non,
    // aucune nouvelle capture : c'est la seule facon d'empecher d'enregistrer
    // deux fois la meme face pendant que la main tourne encore.
    if (this.vueDerniereCapture) {
      const bouge = maxCellDeltaNormalise(cells, this.vueDerniereCapture);
      if (bouge >= SEUIL_LIBERATION) this.imagesDepuisChangement++;
      else this.imagesDepuisChangement = 0;
      // DEUX preuves exigees, car chacune seule se laisse tromper : l'ecart de
      // couleurs par une image delavee, le mouvement par un simple recadrage.
      if (
        this.imagesDepuisChangement >= IMAGES_CHANGEMENT &&
        this.imagesDeMouvement >= IMAGES_MOUVEMENT_REQUISES
      ) {
        this.vueDerniereCapture = null;
      }
    }
    const pasEncoreTourne = this.vueDerniereCapture !== null;
    // Le verrou s'appuie sur les 9 cases, pas sur le seul centre : en lumiere
    // faible, un centre orange et un centre rouge se ressemblent assez pour
    // faire refuser a tort une face nouvelle (mesure : 0,0104 contre 0,0005
    // pour une meme couleur sous deux eclairages — marge trop mince pour
    // bloquer quoi que ce soit).
    const memeFace = changement < SEUIL_CHANGEMENT;
    // point d'observation pour le diagnostic en conditions reelles (dev)
    if (import.meta.env.DEV) {
      (window as unknown as { __scanDebug?: unknown }).__scanDebug = {
        changement: Math.round(changement),
        centre: cells[4].rgb,
        centresCaptures: this.capturesBrutes.map((c) => c[4].rgb),
        stabilite: this.stabilite,
        images: this.accumulateur.size,
      };
    }

    if (qualite.burnt > 1 && maintenant - this.derniereBaisseExposition > 2500) {
      this.derniereBaisseExposition = maintenant;
      void this.camera.nudgeExposure(-1);
    }

    // La qualite d'image ne doit jamais conduire a une impasse : une face
    // blanche sature legitimement, un reflet peut etre impossible a eviter. On
    // laisse quelques secondes pour incliner le cube, puis on capture quand
    // meme — sans jamais DURCIR l'exigence de stabilite, ce qui reviendrait a
    // demander plus de calme precisement quand c'est le plus difficile.
    const patience = maintenant - this.vuDepuis;
    const assez = this.accumulateur.size >= IMAGES_MINIMALES;
    const stable = this.stabilite >= STABILITE_REQUISE;
    const bout = patience > PATIENCE_MAX && assez;
    const pret = assez && (stable || bout) && (qualite.ok || patience > 2000);

    this.overlay.draw({
      rect,
      cells,
      progress:
        memeFace || tropTot || pasEncoreTourne
          ? 0
          : Math.min(1, this.stabilite / STABILITE_REQUISE),
      status:
        !qualite.ok ? 'probleme' : memeFace || pasEncoreTourne ? 'attente' : stable ? 'stable' : 'attente',
      lattice: this.reseauEcran(detection, geo, k),
    });

    if (pasEncoreTourne) {
      this.message('scan-message', `Face enregistree. ${this.etapeCourante.titre}.`, 'ok');
    } else if (memeFace && !tropTot) {
      this.message('scan-message', `${this.etapeCourante.titre} — cette face est deja enregistree.`);
    } else if (!qualite.ok) {
      this.message('scan-message', qualite.reason, 'attention');
    } else if (this.stabilite > 0) {
      this.message('scan-message', 'Ne bouge plus…');
    } else {
      this.message('scan-message', '');
    }

    if (pret && !memeFace && !tropTot && !pasEncoreTourne) this.capturer();
  }

  /** Les 9 centres du reseau, convertis en coordonnees d'affichage. */
  private reseauEcran(
    d: Detection,
    geo: { echelle: number; offX: number; offY: number },
    k: number,
  ): { cells: { x: number; y: number }[]; ux: number; uy: number; vx: number; vy: number } {
    const px = (x: number) => (x / k) * geo.echelle + geo.offX;
    const py = (y: number) => (y / k) * geo.echelle + geo.offY;
    const e = geo.echelle / k;
    return {
      cells: d.cells.map((c) => ({ x: px(c.x), y: py(c.y) })),
      ux: d.ux * e,
      uy: d.uy * e,
      vx: d.vx * e,
      vy: d.vy * e,
    };
  }

  private capturerMaintenant(): void {
    if (this.ecran !== 'scan') return;
    if (this.accumulateur.size === 0 && this.derniere) this.accumulateur.push(this.derniere);
    // le bouton manuel passe outre les garde-fous : l'utilisateur assume
    this.capturer();
  }


  private capturer(): void {
    const cells = this.accumulateur.consolidate();
    if (!cells) return;

    // Aucun refus supplementaire ici : deux garde-fous ont ete essayes puis
    // retires parce qu'ils bloquaient l'utilisateur au lieu de l'aider.
    //  - "ces couleurs ne sont pas celles d'un cube" : sous une lampe chaude et
    //    faible, un bleu de cube se mesure [12,32,66] et se faisait rejeter.
    //  - "ce centre est deja enregistre" : orange sombre et rouge sombre sont
    //    trop proches pour trancher (0,0104 contre 0,0005).
    // Ce qui reste : la specificite du detecteur (0 faux positif sur 40 scenes
    // sans cube), la comparaison des 9 cases, et la validation physique.
    const step = this.etapeCourante;
    const centre = cells[4].rgb;
    const centreLin = toLinear(centre);
    const faceIndex = FACES.indexOf(step.face);

    const cibles = faceletsOfStep(step);
    if (this.relecture) {
      this.rangerAvecMeilleureRotation(cells, cibles);
    } else {
      for (let i = 0; i < 9; i++) this.echantillons[cibles[i]] = cells[i].rgb;
    }
    this.centresLin[faceIndex] = centreLin;
    this.echantillonsParFace[faceIndex] = cells.map((c) => c.rgb);
    this.couleurs[step.face] = rgbToCss(centre);

    this.accumulateur.reset();
    this.stabilite = 0;
    this.derniere = null;
    this.consolidePrecedent = null;
    this.vuDepuis = 0;
    this.capturesBrutes.push(cells);
    this.instantDerniereCapture = performance.now();
    this.vueDerniereCapture = cells;
    this.imagesDepuisChangement = 0;
    this.imagesDeMouvement = 0;

    if (this.relecture) {
      this.relecture = null;
      this.message('scan-message', 'Face relue.', 'ok');
      void this.analyserScan();
      return;
    }

    this.capturesFaites.add(this.etape);
    this.message('scan-message', `Face ${this.etape + 1} enregistree.`, 'ok');
    if (this.etape >= SCAN_PLAN.length - 1) {
      void this.analyserScan();
    } else {
      this.etape++;
      this.majEtape();
    }
  }

  /**
   * Lors d'une relecture, l'utilisateur peut tres bien presenter la face
   * tournee d'un quart de tour par rapport au scan initial. On essaie les 4
   * rotations et on garde celle qui rend le cube le plus coherent.
   */
  private rangerAvecMeilleureRotation(cells: CellSample[], cibles: number[]): void {
    const rotations = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8],
      [6, 3, 0, 7, 4, 1, 8, 5, 2],
      [8, 7, 6, 5, 4, 3, 2, 1, 0],
      [2, 5, 8, 1, 4, 7, 0, 3, 6],
    ];
    let meilleur = rotations[0];
    let meilleurScore = -Infinity;
    const sauvegarde = cibles.map((c) => this.echantillons[c]);

    for (const rot of rotations) {
      for (let i = 0; i < 9; i++) this.echantillons[cibles[i]] = cells[rot[i]].rgb;
      const echs = this.echantillons.map((s) => s ?? { r: 0, g: 0, b: 0 });
      const res = classifyCube(echs);
      const valide = validate(res.labels.join('')).ok;
      const confiance = res.confidence.reduce((a, b) => a + b, 0) / 54;
      const score = (valide ? 10 : 0) + confiance;
      if (score > meilleurScore) {
        meilleurScore = score;
        meilleur = rot;
      }
    }
    for (let i = 0; i < 9; i++) this.echantillons[cibles[i]] = cells[meilleur[i]].rgb;
    void sauvegarde;
  }

  private refaireEtape(): void {
    this.accumulateur.reset();
    this.stabilite = 0;
    this.derniere = null;
    this.capturesBrutes = [];
    // On REFAIT la meme face : exiger un mouvement bloquerait l'utilisateur.
    this.vueDerniereCapture = null;
    this.imagesDepuisChangement = 0;
    this.imagesDeMouvement = 0;
    if (!this.relecture) this.capturesFaites.delete(this.etape);
    this.message('scan-message', 'Recommence la capture de cette face.');
    this.majProgression();
  }

  // ------------------------------------------------------------- verification

  /**
   * Deux faces scannees identiques ? Les 6 centres d'un cube sont forcement de
   * 6 couleurs differentes : c'est une certitude physique, independante de
   * toute la chaine de lecture. Si deux centres se ressemblent, une face a ete
   * montree deux fois — autant le dire tout de suite plutot que de resoudre un
   * cube impossible.
   */
  private facesEnDouble(): [number, number] | null {
    for (let a = 0; a < 6; a++) {
      const ca = this.echantillons[a * 9 + 4];
      if (!ca) continue;
      for (let b = a + 1; b < 6; b++) {
        const cb = this.echantillons[b * 9 + 4];
        if (!cb) continue;
        if (sameStickerColor(ca, cb)) return [a, b];
      }
    }
    return null;
  }

  private async analyserScan(): Promise<void> {
    const double = this.facesEnDouble();
    const echs = this.echantillons.map((s) => s ?? { r: 128, g: 128, b: 128 });
    const res = classifyCube(echs);
    let labels = res.labels;
    let changed: number[] = [];
    let note = '';
    this.lecturesPossibles = [];
    this.lectureChoisie = 0;

    if (!validate(labels.join('')).ok) {
      const rep = repairReading(res);
      if (rep) {
        labels = rep.labels;
        changed = rep.changed;
        note = rep.description;
      }
    }

    // Toujours invalide ? En usage reel, l'explication la plus frequente n'est
    // pas une couleur mal lue — le compteur montre bien 9 stickers de chaque —
    // mais un GESTE fait dans l'autre sens : la face presentee n'est pas celle
    // que le parcours attendait, ou elle est tournee. On cherche donc le
    // placement des 6 faces qui rend le cube physiquement valide.
    // Les lettres produites par le classifieur ne sont que des NOMS de groupes
    // de couleur : elles n'affirment rien sur la geometrie. C'est ici qu'on
    // decide quelle face va ou — et si le flux video est en miroir.
    //
    // La comparaison est faite MEME quand la lecture directe est valide : une
    // capture en miroir tombe parfois valide par hasard, et resterait alors
    // fausse en silence.
    const faces = SCAN_PLAN.map((step) => {
      const base = FACES.indexOf(step.face) * 9;
      return res.labels.slice(base, base + 9) as string[];
    });
    /**
     * Le placement rebaptise chaque face d'apres la couleur de son centre. La
     * palette d'affichage, elle, est produite par le classifieur et indexee sur
     * les noms d'ORIGINE. Sans appliquer le meme renommage, tous les stickers
     * d'un groupe se retrouvent peints avec la couleur d'un autre — les neuf
     * bleus affiches en vert, par exemple, alors que l'etat du cube est juste.
     */
    let renommage: Record<Face, string> | null = null;
    if (!validate(labels.join('')).ok) {
      const arrangement = findValidArrangement(faces);
      if (!arrangement) {
        /*
         * Aucun placement n'explique ce scan.
         *
         * On le DIT, plutot que de livrer la lecture brute : depuis le controle
         * de chiralite des coins, un echec ici signifie que les couleurs lues ne
         * peuvent former aucun cube reel. Le solveur partirait alors chercher
         * une solution qui n'existe pas — il n'en trouve aucune, abandonne au
         * bout de quinze secondes, et l'utilisateur rescanne sans comprendre.
         */
        note =
          'Aucun placement ne peut expliquer ces six faces : la lecture contient' +
          ' forcement une erreur. Corrige les stickers signales, ou rescanne.';
      }
      if (arrangement) {
        labels = arrangement.facelets.split('') as Face[];
        renommage = arrangement.renommage;
        changed = [];
        const morceaux: string[] = [];
        if (arrangement.deplacees) {
          morceaux.push(
            `${arrangement.deplacees} face(s) n'etaient pas a la place prevue`,
          );
        }
        if (arrangement.tournees) {
          morceaux.push(`${arrangement.tournees} face(s) etaient tournees`);
        }
        /*
         * Ce message etait rassurant (« remis en place automatiquement »)
         * alors qu'il decrit le moment le plus fragile de toute la chaine.
         *
         * Quand le scan suit le parcours guide, il n'y a RIEN a deviner : le
         * placement est connu, mesure a 0 deplacement et 0 rotation. Des que
         * l'ordre differe, l'application doit deduire la position de chaque
         * face a partir de la seule geometrie — et ce raisonnement, mesure sur
         * des scans simules a deux faces deplacees, se trompe dans 3,5 % des
         * cas en produisant un cube legal mais faux. L'utilisateur suit alors
         * vingt mouvements pour rien.
         *
         * On le dit donc comme un AVERTISSEMENT, avec le seul conseil qui
         * supprime le risque au lieu de le reduire : refaire le scan en suivant
         * les gestes proposes.
         */
        note = morceaux.length
          ? `J'ai du DEVINER la position de tes faces : ${morceaux.join(' et ')}.` +
            ' Verifie bien la grille avant de resoudre. Pour supprimer ce doute,' +
            ' rescanne en suivant les gestes proposes — la position est alors connue,' +
            ' plus devinee.'
          : '';
        // Quand ces six faces s'assemblent AUSSI en un autre cube legal, le
        // placement retenu n'est qu'une hypothese. Mesure sur 200 scans
        // simules a deux faces deplacees : les 7 arrangements faux etaient
        // TOUS ambigus. Le dire attrape donc la totalite des cas ou l'on
        // resoudrait en silence un cube qui n'est pas celui de l'utilisateur.
        // L'information manque REELLEMENT pour trancher : plusieurs cubes
        // legaux expliquent ces six faces, et aucune contrainte physique ne
        // les separe (mesure : 0 des 13 cubes faux sur 300 scans ne violait le
        // schema de couleurs). Le seul juge est l'utilisateur, cube en main.
        // On lui propose donc les candidats au lieu d'en imposer un.
        this.lecturesPossibles = [arrangement.facelets, ...(arrangement.alternatives ?? [])];
        this.lectureChoisie = 0;
        if (arrangement.alternatives?.length) {
          note +=
            ` Attention : ces six faces s'assemblent aussi en ${arrangement.alternatives.length} autre(s) cube(s).` +
            ' Compare la grille a ton cube — si elle ne correspond pas, appuie sur « Autre lecture ».' +
            ' Si aucune ne correspond, rescanne.';
        }
      }
    }

    const validation = validate(labels.join(''));
    /**
     * On encadre les lectures les MOINS NETTES, pas celles sous un seuil fixe.
     *
     * La confiance sature a 1 des que la lecture est nette : elle ne pouvait
     * designer personne, et aucun sticker n'etait jamais signale. La marge, qui
     * ne sature pas, corrige cela — mais sa distribution depend de la prise de
     * vue. Mesure sur deux scans reels : mediane 0,840 pour l'un, 0,653 pour
     * l'autre. Un seuil absolu de 0,70 encadrait 11 stickers sur le premier et
     * 30 sur le second — plus de la moitie du cube, ce qui ne designe plus rien.
     *
     * On prend donc les SIX plus limites, quelles que soient leurs valeurs :
     * un repere constant, jamais alarmant, et toujours pointe sur le risque
     * reel. Purement visuel : cela ne change aucune decision.
     */
    const douteux = res.marge
      .map((m, i) => ({ m, i }))
      .sort((a, b) => a.m - b.m)
      .slice(0, STICKERS_SIGNALES)
      .map((x) => x.i);
    const facesDouteuses = suspectFaces(res.confidence, 0.22);

    this.etatLu = labels.join('');
    // On AFFICHE la couleur franche du cube, pas la couleur mesuree : dans une
    // lumiere faible, les mesures sont delavees et le patron devient
    // invérifiable a l'oeil. La mesure brute reste accessible via le bouton de
    // diagnostic.
    for (const f of FACES) {
      // `renommage[f]` est le groupe de couleur qui occupe desormais la
      // position f ; c'est SA couleur qu'il faut peindre — et c'est SA
      // reference que le suivi doit utiliser pour cette position.
      const groupe = (renommage?.[f] ?? f) as Face;
      this.couleurs[f] = rgbToCss(res.paletteRgb[groupe]);
      this.couleursMesurees[f] = rgbToCss(res.referenceRgb[groupe]);
      this.nomsCouleur[f] = NOMS_COULEUR[res.paletteIndex[groupe]] ?? '?';
    }

    // Apres les 6 faces, on ne reprend JAMAIS la main : on va toujours a la
    // verification. L'utilisateur y voit tout, corrige d'un appui, et peut
    // demander lui-meme une relecture. Rediriger d'autorite vers un nouveau
    // scan, c'est l'enfermer dans une demande qu'il n'arrive pas a satisfaire —
    // exactement la boucle sans fin remontee en usage reel.
    const suspecte = double ? double[1] : facesDouteuses.length ? facesDouteuses[0] : -1;
    this.faceARelire =
      suspecte >= 0 ? (SCAN_PLAN.find((s) => FACES.indexOf(s.face) === suspecte) ?? null) : null;

    const messages = validation.issues.map((i) => i.message);
    if (double) {
      messages.unshift(
        'Deux faces scannees ont le meme centre : une face a ete montree deux fois.',
      );
    }
    this.montrerVerification(validation.ok, [...douteux, ...changed], note, messages);
  }

  private montrerVerification(
    valide: boolean,
    aSurligner: number[],
    note: string,
    problemes: string[],
  ): void {
    // Le choix n'est propose que s'il existe : sinon le bouton n'est que du
    // bruit, et laisserait croire a un doute la ou il n'y en a pas.
    ($('btn-autre-lecture') as HTMLButtonElement).hidden = this.lecturesPossibles.length < 2;

    this.montrerAncrage();

    const host = $('net-host');
    if (!this.net) {
      host.innerHTML = '';
      this.net = new CubeNet(host, this.etatLu, this.couleurs, {
        onRotationFinie: () => {
          this.modeRotation = false;
          ($('btn-tourner-face') as HTMLButtonElement).setAttribute('aria-pressed', 'false');
        },
        onChange: (etat) => {
          this.etatLu = etat;
          this.majLegende();
          const v = validate(etat);
          this.net?.highlight(v.ok ? [] : v.issues.flatMap((i) => i.facelets), 'erreur');
          this.message(
            'verif-message',
            v.ok ? 'Cube coherent.' : v.issues.map((i) => i.message).join(' '),
            v.ok ? 'ok' : 'alerte',
          );
          ($('btn-resoudre') as HTMLButtonElement).disabled = !v.ok;
        },
      });
    }
    this.net.setColors(this.couleurs);
    this.net.setState(this.etatLu);
    this.net.highlight(aSurligner, valide ? 'doute' : 'erreur');
    this.majLegende();

    ($('btn-resoudre') as HTMLButtonElement).disabled = !valide;
    // Quand le cube reste incoherent, les mesures brutes sont la seule chose
    // qui permette de comprendre pourquoi : on les met sous la main, et dans
    // la console, sans rien demander a l'utilisateur.
    const bloc = $('bloc-diagnostic') as HTMLDetailsElement;
    bloc.hidden = valide;
    if (!valide) {
      const texte = this.texteDiagnostic();
      ($('diagnostic-texte') as HTMLTextAreaElement).value = texte;
      console.log('DIAGNOSTIC RUBIKSCAM', texte);
    }
    const relire = $('btn-relire') as HTMLButtonElement;
    relire.hidden = valide || !this.faceARelire;
    if (this.faceARelire) {
      ($('relire-couleur') as HTMLElement).style.background =
        this.couleurs[this.faceARelire.face] ?? '#888';
    }
    if (valide && !aSurligner.length) {
      this.message('verif-message', 'Lecture coherente. Tu peux resoudre.', 'ok');
    } else if (valide) {
      // Le cube est physiquement valide : le doute ne porte que sur quelques
      // lectures. On ne veut pas alarmer inutilement.
      this.message(
        'verif-message',
        `Lecture coherente.${note ? ' ' + note : ''} Les lectures les moins nettes sont` +
          ' encadrees : jette-leur un oeil, puis resous.',
        'ok',
      );
    } else {
      this.message('verif-message', problemes.join(' ') || 'Cube incoherent.', 'alerte');
    }
    this.montrer('verif');
  }

  /** Relecture d'une face, declenchee par l'utilisateur depuis la verification. */
  private lancerRelecture(): void {
    if (!this.faceARelire) return;
    this.relecture = this.faceARelire;
    this.relecturesDemandees++;
    this.capturesBrutes = [];
    this.instantDerniereCapture = 0;
    this.vueDerniereCapture = null;
    this.imagesDepuisChangement = 0;
    this.imagesDeMouvement = 0;
    this.majEtape();
    this.message('scan-message', '');
    this.montrer('scan');
    if (this.camera.active) this.demarrerBoucle();
  }

  /**
   * Exporte les mesures brutes du scan. Sans ces chiffres, diagnostiquer une
   * mauvaise lecture revient a deviner d'apres une capture d'ecran : la couleur
   * affichee a deja traverse tout le traitement. Ici on donne l'entree.
   */
  /**
   * Bascule vers un autre cube compatible avec le scan.
   *
   * Quand plusieurs cubes legaux expliquent les six faces vues, aucune regle
   * ne permet de choisir : c'est l'utilisateur, cube en main, qui tranche en
   * un geste — plutot que de resoudre en silence un cube qui n'est pas le sien.
   */
  private autreLecture(): void {
    if (this.lecturesPossibles.length < 2) return;
    this.lectureChoisie = (this.lectureChoisie + 1) % this.lecturesPossibles.length;
    this.etatLu = this.lecturesPossibles[this.lectureChoisie];
    this.net?.setState(this.etatLu);
    this.majLegende();
    const v = validate(this.etatLu);
    this.net?.highlight(v.ok ? [] : v.issues.flatMap((i) => i.facelets), 'erreur');
    ($('btn-resoudre') as HTMLButtonElement).disabled = !v.ok;
    this.message(
      'verif-message',
      `Lecture ${this.lectureChoisie + 1} sur ${this.lecturesPossibles.length}.` +
        ' Compare avec ton cube ; appuie encore pour voir la suivante.',
      v.ok ? 'ok' : 'alerte',
    );
  }

  /**
   * Comment tenir son cube pour comparer le patron.
   *
   * C'etait la piece manquante. Le patron dessine les 54 stickers, mais ne dit
   * pas dans quelle position tenir le cube : l'utilisateur compare alors les
   * COULEURS de chaque face, jamais leurs positions relatives. Or un placement
   * faux garde exactement les memes couleurs, les memes pieces et les memes
   * faces opposees — mesure : il ne differe que par la POSITION, sur 36
   * stickers sur 54 en mediane. Enorme, mais invisible sans repere.
   *
   * Avec l'ancrage, la comparaison devient positionnelle, et l'ecart saute aux
   * yeux avant d'avoir fait vingt mouvements pour rien.
   */
  private montrerAncrage(): void {
    const el = $('verif-ancrage');
    const pastille = (f: Face) =>
      `<span class="ancrage-pastille" style="background:${this.couleurs[f]}"></span>`;
    el.innerHTML =
      `Pour comparer : tiens ton cube avec le ${pastille('U')} <strong>vers le haut</strong>` +
      ` et le ${pastille('F')} <strong>face a toi</strong>.` +
      ' Le patron decrit alors exactement ton cube — verifie quelques stickers,' +
      ' pas seulement les couleurs.';
  }

  /**
   * Active le mode « tourner une face ».
   *
   * Sans lui, une face enregistree de travers ne pouvait etre corrigee qu'en
   * changeant huit stickers un par un, dans le bon ordre — autant dire jamais.
   * Or le placement automatique signale regulierement des faces tournees :
   * c'est exactement la correction qui manquait.
   */
  private basculerModeRotation(): void {
    this.modeRotation = !this.modeRotation;
    const btn = $('btn-tourner-face') as HTMLButtonElement;
    btn.setAttribute('aria-pressed', String(this.modeRotation));
    this.net?.setModeRotation(this.modeRotation);
    this.message(
      'verif-message',
      this.modeRotation
        ? 'Touche une face pour la faire pivoter d un quart de tour. Une seule fois :' +
          ' le mode se desactive ensuite.'
        : '',
      'ok',
    );
  }

  /**
   * La face que l'utilisateur vient d'amener en haut, telle qu'elle DOIT etre.
   *
   * C'est la seule verification qui ne coute rien : il regarde deja cette face
   * pour la mettre en haut. Sans elle, une erreur d'execution ne se decouvre
   * qu'au bout de vingt mouvements — le cube a alors diverge depuis longtemps
   * et plus rien n'est rattrapable.
   *
   * Les neuf couleurs sont vraies a une rotation pres : selon la facon dont il
   * a tourne son cube, la face peut apparaitre pivotee. C'est sans importance —
   * un etat FAUX ne contient presque jamais les memes neuf couleurs.
   */
  private montrerFaceAttendue(
    move: string | null,
    position: PositionFace,
    reorienter: boolean,
  ): void {
    const bloc = $('move-attendu') as HTMLElement;
    const devant = $('move-devant') as HTMLElement;
    const session = this.session;
    bloc.hidden = !move || !session;
    devant.hidden = !move || !session;
    if (!move || !session) return;

    // La prise est celle que l'application dicte. En NOMMANT la couleur qui
    // doit se retrouver devant, on fixe aussi la rotation : l'apercu devient
    // exact au lieu d'etre vrai « a une rotation pres ». C'est cette ambiguite
    // qui faisait croire a une divergence alors que le cube etait juste.
    const tourne = applyPermStr(session.cube, this.prise.perm);

    devant.hidden = !reorienter;
    if (reorienter) {
      // Le second ancrage nomme l'AUTRE axe : ce qui va devant quand la face du
      // mouvement monte au plafond, ce qui monte au plafond quand elle vient
      // devant. Les deux ensemble fixent une seule position possible.
      const versDevant = position === 'dessus';
      const autre = this.couleurs[(versDevant ? tourne[22] : tourne[4]) as Face];
      devant.innerHTML =
        `et le <span class="ancrage-pastille" style="background:${autre}"></span> <strong>${
          versDevant ? 'face a toi' : 'vers le plafond'
        }</strong>`;
    }

    // On montre LA FACE QU'ON VA TOURNER, vue droit dans les yeux.
    const debut = position === 'devant' ? 18 : 0;
    $('move-attendu-titre').textContent =
      position === 'devant'
        ? 'la face devant toi doit ressembler EXACTEMENT a'
        : 'le dessus doit ressembler EXACTEMENT a';
    const grille = $('move-attendu-grille');
    grille.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('span');
      c.className = 'attendu-case';
      c.style.background = this.couleurs[tourne[debut + i] as Face] ?? '#444';
      grille.appendChild(c);
    }
  }

  /**
   * L'etat exact au moment ou l'utilisateur constate une divergence.
   *
   * Sans lui, un « ca ne correspond plus » ne peut etre que discute. Avec, on
   * peut rejouer la solution depuis l'etat scanne, verifier ou elle mene, et
   * comparer a ce que l'utilisateur a sous les yeux — donc trancher.
   */
  private async copierDiagnosticResolution(): Promise<void> {
    const session = this.session;
    if (!session) return;
    const donnees = {
      version: 1,
      contexte: 'resolution',
      /** Cube tel qu'il a ete lu au scan, avant tout mouvement. */
      etatScanne: this.etatInitialResolution,
      /** Solution complete calculee sur cet etat. */
      solution: session.solution,
      /** Mouvements deja valides par l'utilisateur. */
      index: session.index,
      /** Etat que l'application croit avoir maintenant. */
      etatCourant: session.cube,
      /** Le mouvement affiche a l'instant, et sa couleur annoncee. */
      mouvement: session.currentMove,
      couleurs: this.couleurs,
      nomsCouleur: this.nomsCouleur,
    };
    const texte = JSON.stringify(donnees);
    try {
      await navigator.clipboard.writeText(texte);
      this.message('resolution-message', 'Diagnostic copie. Colle-le dans la conversation.', 'ok');
    } catch {
      this.message('resolution-message', texte, 'attention');
    }
  }

  private texteDiagnostic(): string {
    const arrondi = (c: RGB | null) =>
      c ? [Math.round(c.r), Math.round(c.g), Math.round(c.b)] : null;
    const donnees = {
      version: 1,
      camera: {
        avant: this.camera.isFrontFacing,
        largeur: this.camera.video.videoWidth,
        hauteur: this.camera.video.videoHeight,
      },
      // 54 mesures brutes, dans l'ordre des facettes U R F D L B
      echantillons: this.echantillons.map(arrondi),
      // 9 mesures par face, telles que vues a la camera
      parFace: this.echantillonsParFace.map((f) => f?.map(arrondi) ?? null),
      couleursMesurees: this.couleursMesurees,
      lecture: this.etatLu,
      valide: validate(this.etatLu).ok,
      problemes: validate(this.etatLu).issues.map((i) => i.message),
    };
    return JSON.stringify(donnees);
  }

  private async copierDiagnostic(): Promise<void> {
    const texte = this.texteDiagnostic();
    try {
      await navigator.clipboard.writeText(texte);
      this.message('verif-message', 'Diagnostic copie. Colle-le dans la conversation.', 'ok');
    } catch {
      this.message(
        'verif-message',
        'Copie refusee par le navigateur : le texte est juste en dessous, selectionne-le.',
        'attention',
      );
    }
    const bloc = $('bloc-diagnostic') as HTMLDetailsElement;
    bloc.hidden = false;
    bloc.open = true;
    ($('diagnostic-texte') as HTMLTextAreaElement).value = texte;
  }

  /**
   * Compteur par couleur. Un cube a exactement 9 stickers de chaque couleur :
   * afficher le compte transforme la correction manuelle, qui releve sinon de
   * la devinette, en simple mise a niveau de deux nombres.
   */
  private majLegende(): void {
    const host = $('legende');
    host.innerHTML = '';
    for (const f of FACES) {
      const n = [...this.etatLu].filter((c) => c === f).length;
      const item = document.createElement('span');
      item.className = 'legende-item' + (n === 9 ? '' : ' faux');
      const pastille = document.createElement('span');
      pastille.className = 'legende-pastille';
      pastille.style.background = this.couleurs[f];
      item.appendChild(pastille);
      item.appendChild(document.createTextNode(`${n} / 9`));
      host.appendChild(item);
    }
  }

  private relancerScan(): void {
    this.speaker.stop();
    this.cube3d?.stopDemo();
    if (this.demo) {
      this.demarrerDemo();
      return;
    }
    this.reinitialiserScan();
    // La camera a ete eteinte au passage a la resolution : on la rallume.
    if (!this.camera.active) {
      void this.demarrerCamera();
      return;
    }
    this.montrer('scan');
    this.demarrerBoucle();
  }

  // -------------------------------------------------------------- resolution

  private async resoudre(): Promise<void> {
    if (!validate(this.etatLu).ok) return;
    this.message('verif-message', 'Calcul de la solution…');
    ($('btn-resoudre') as HTMLButtonElement).disabled = true;

    // A partir d'ici, la camera n'a plus rien a apporter : l'etat du cube et la
    // solution entiere sont connus. On l'ETEINT pour de bon — le voyant qui
    // s'eteint dit a l'utilisateur, mieux que n'importe quel texte, qu'il n'a
    // plus a se soucier de cadrage ni d'eclairage.
    //
    // `allowDeviation: false` reste par prudence : si le suivi devait un jour
    // etre rebranche, une image ne doit jamais pouvoir reecrire l'etat.
    if (!this.demo) this.camera.stop();
    this.etatInitialResolution = this.etatLu;
    this.prise = IDENTITY_ORIENTATION;
    const session = new SolveSession(this.etatLu, [], IDENTITY_ORIENTATION, {
      allowDeviation: false,
    });
    this.session = session;
    this.preparerEcranResolution();
    this.montrer('resolution');

    this.lancerCalcul();
  }

  /**
   * Lancer — ou relancer — le calcul de la solution sur l'etat deja lu.
   *
   * Separe de `resoudre()` parce que l'echec du solveur doit avoir une SORTIE.
   * Le message disait « Reessaie » alors qu'aucun bouton ne le permettait :
   * l'ecran de resolution n'offrait que « Je suis perdu », qui jette le scan
   * entier sans confirmation. Nommer une action qui n'existe pas laisse
   * l'utilisateur bloque devant un cube lu correctement.
   *
   * Mesure : un cube que `validate()` accepte se resout en 54 ms en mediane,
   * 773 ms au pire sur 300 cubes, et jamais plus de 5 s. Un echec ici n'est
   * donc pas un calcul trop long : c'est un worker qui n'a pas repondu. Le
   * relancer sur un worker neuf est exactement le bon geste, et il ne coute
   * rien puisque l'etat lu est intact.
   */
  private lancerCalcul(): void {
    const session = this.session;
    if (!session) return;
    ($('btn-relancer-calcul') as HTMLElement).hidden = true;
    this.message('resolution-message', '');
    const id = ++this.solutionId;
    this.solver.solve(this.etatLu, {
      onSolution: (moves) => {
        if (id !== this.solutionId) return;
        session.setSolution(moves);
        this.majResolution(true);
      },
      onError: (msg) => {
        if (id !== this.solutionId) return;
        this.message(
          'resolution-message',
          `Le solveur n'a pas repondu (${msg}). Ta lecture est bonne :` +
            ' appuie sur « Relancer le calcul ».',
          'alerte',
        );
        ($('btn-relancer-calcul') as HTMLElement).hidden = false;
      },
    });
  }

  private preparerEcranResolution(): void {
    const host = $('cube-host');
    if (!this.cube3d) {
      host.innerHTML = '';
      this.cube3d = new Cube3D(host);
    }
    this.cube3d.setColors(this.couleurs);
    this.cube3d.setState(this.session!.cube);
    this.dernierMouvementAnnonce = '';
    this.majResolution(true);
  }

  private majResolution(complet = false): void {
    const session = this.session;
    if (!session) return;

    if (session.finished || session.solved) {
      if (session.solved) {
        this.terminer();
        return;
      }
    }

    // UN mouvement a la fois. Afficher un groupe de trois puis n'en avancer
    // qu'un — ou l'inverse — desynchronise l'etat en silence et definitivement.
    const move = session.currentMove;
    // Quelle prise adopter, et ou la face s'y trouve : une seule regle, une
    // seule fois, dans `prochainePrise` — importee aussi par les tests, pour
    // qu'ils ne puissent plus en verifier une copie.
    let position: PositionFace = 'dessus';
    let reorienter = false;
    if (move) {
      const choix = prochainePrise(this.prise, move);
      this.prise = choix.prise;
      position = choix.position;
      reorienter = choix.reorienter;
    }
    const consigne = move
      ? consignePour(move, this.couleurs, this.nomsCouleur, position)
      : null;

    /*
     * Trois etats, et non deux.
     *
     * Tant que le solveur n'a pas repondu, `currentMove` est nul ET le cube
     * n'est pas resolu : l'afficher comme « TERMINE » est un mensonge visible
     * — l'utilisateur voit son cube melange sous un titre de fin.
     */
    const enAttenteDeSolution = !move && !session.solved;
    if (!consigne) {
      const b = $('move-bandeau') as HTMLElement;
      b.hidden = false;
      b.style.background = 'transparent';
      b.style.color = '#ffffff';
      $('move-nom').textContent = enAttenteDeSolution ? 'un instant' : 'termine';
      ($('move-position') as HTMLElement).hidden = true;
      ($('move-garde') as HTMLElement).hidden = true;
    }

    const bandeau = $('move-bandeau') as HTMLElement;
    // Le bandeau de couleur n'apparait QUE lorsqu'il faut changer de prise.
    // Le reste du temps l'utilisateur garde son cube en main : le lui redire a
    // chaque mouvement noierait la seule information qui compte, le geste.
    bandeau.hidden = !reorienter || !consigne;
    if (consigne && reorienter) {
      bandeau.style.background = consigne.couleur;
      bandeau.style.color = clair(consigne.couleur) ? '#0b0f18' : '#ffffff';
      $('move-nom').textContent = consigne.nom;
      // La face du mouvement ne va pas toujours au sommet : depuis que la prise
      // la plus proche est choisie, elle peut aussi arriver DEVANT. Annoncer
      // « vers le plafond » dans ce cas contredirait le geste demande.
      $('move-position').textContent = motPosition(consigne.position);
    }
    ($('move-position') as HTMLElement).hidden = !reorienter;

    const garde = $('move-garde') as HTMLElement;
    garde.hidden = reorienter || !consigne;

    $('move-dessin').innerHTML = consigne
      ? pictogramme(consigne.sens, consigne.couleur, consigne.position)
      : '';
    $('move-geste').textContent = consigne
      ? consigne.geste
      : enAttenteDeSolution
        ? 'Je calcule la solution…'
        : 'Ton cube est resolu.';
    $('move-notation').textContent = consigne ? consigne.notation : '—';
    this.montrerFaceAttendue(move, position, reorienter);

    const restant = Math.max(0, session.solution.length - session.index);
    // « Il te reste N » plutot que « 8 / 21 » : un recalcul remet l'index a zero
    // et ferait repartir un compteur indexe dessus sous les yeux de l'utilisateur.
    $('move-restant').textContent = restant
      ? `il te reste ${restant} mouvement${restant > 1 ? 's' : ''}`
      : '';
    $('move-compteur').textContent = restant ? `${restant} restants` : enAttenteDeSolution ? '' : 'fini';

    if (complet) this.message('resolution-message', '');

    const progression = session.solution.length
      ? (session.index / session.solution.length) * 100
      : 0;
    ($('progression') as HTMLElement).style.width = `${progression}%`;

    if (this.cube3d) {
      this.cube3d.setState(session.cube);
      this.cube3d.setColors(this.couleurs);
      const absolu = move;
      if (absolu) {
        /*
         * Le cube affiche montre EXACTEMENT ce que la consigne demande : la
         * couleur nommee vers le haut, et l'etage du haut qui tourne.
         *
         * Il etait auparavant oriente par `session.orientation`, c'est-a-dire
         * par ce que la camera croyait voir. Depuis qu'elle est eteinte apres
         * le scan, cette orientation ne bouge plus : le modele restait fige
         * pendant que la consigne annoncait une autre couleur en haut. Le
         * dessin contredisait le texte.
         *
         * On choisit donc la prise qui amene la face du mouvement au sommet —
         * il en existe quatre, equivalentes — et on incline la vue pour que ce
         * dessus soit bien lisible.
         */
        const prise = ORIENTATIONS.find((o) => o.faceMapInv.U === absolu[0]);
        if (prise) {
          this.cube3d.setViewMatrix(
            multiplier(matriceVue(-26, -34), matriceOrientation(prise)),
          );
        }
        this.cube3d.demonstrate(absolu);
      } else {
        this.cube3d.stopDemo();
      }
    }

    if (move && move !== this.dernierMouvementAnnonce) {
      this.dernierMouvementAnnonce = move;
      // La voix dit les DEUX temps, comme l'ecran : la couleur a amener en
      // haut, puis le geste. Aucun nom de face, aucun point de vue suppose.
      this.speaker.announceMove(`${consigne!.voix1}, ${consigne!.voix2}`);
    }
  }

  private avancerManuel(): void {
    const session = this.session;
    if (!session) return;
    // UN mouvement : exactement celui que la consigne affichait. Avancer d'un
    // groupe alors que l'ecran n'en montrait qu'un desynchronise l'etat en
    // silence, et plus rien ensuite ne peut le rattraper.
    const move = session.currentMove;
    if (!move) return;
    session.advance(1);
    if (this.demo) this.demoCube = session.cube;
    if (this.cube3d) {
      this.cube3d.stopDemo();
      void (async () => {
        await this.cube3d?.animateMove(move, 220);
        this.majResolution(true);
      })();
    } else {
      this.majResolution(true);
    }
    if (session.solved) this.terminer();
  }

  private reculerManuel(): void {
    this.session?.back(1);
    if (this.demo && this.session) this.demoCube = this.session.cube;
    this.majResolution(true);
  }

  /**
   * Fin de parcours — et la question qu'il faut poser.
   *
   * L'application ne PEUT PAS savoir si le cube est resolu : elle a suivi son
   * propre modele, mis a jour a chaque appui sur « Fait ». Si la lecture de
   * depart etait fausse, ou si un mouvement a ete valide sans etre fait, ce
   * modele est resolu alors que le cube ne l'est pas.
   *
   * Afficher « Cube resolu » dans ce cas serait un mensonge, et laisserait
   * l'utilisateur sans recours apres vingt mouvements. On demande donc, et on
   * dit quoi faire si la reponse est non.
   */
  private terminer(): void {
    const session = this.session;
    this.cube3d?.stopDemo();
    $('fin-titre').textContent = 'Ton cube est-il resolu ?';
    $('fin-detail').textContent = session
      ? `${session.solution.length} mouvements suivis.`
      : '';
    $('fin-aide').hidden = true;
    ($('btn-fin-oui') as HTMLButtonElement).hidden = false;
    ($('btn-fin-non') as HTMLButtonElement).hidden = false;
    this.montrer('fin');
  }

  private confirmerFin(resolu: boolean): void {
    $('fin-titre').textContent = resolu ? 'Cube resolu 🎉' : 'Alors on recommence';
    $('fin-aide').hidden = resolu;
    ($('btn-fin-oui') as HTMLButtonElement).hidden = true;
    ($('btn-fin-non') as HTMLButtonElement).hidden = true;
    if (resolu) this.speaker.say('Cube resolu');
  }

  // -------------------------------------------------------------------- demo

  private demarrerDemo(): void {
    this.demo = true;
    this.arreterBoucle();
    this.camera.stop();
    const melange = randomScramble(22);
    this.demoCube = applyAlg(SOLVED_FACELETS, melange);
    this.etatLu = this.demoCube;
    ($('btn-voix') as HTMLButtonElement).hidden = !this.speaker.available;
    this.montrerVerification(true, [], '', []);
    this.message(
      'verif-message',
      `Mode demo : cube melange par ${melange.length} mouvements. Appuie sur « Resoudre », puis sur « Fait ✓ » pour derouler.`,
      'ok',
    );
    void invertAlg;
    void visibleFace;
  }
}
