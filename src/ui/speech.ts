/** Annonce vocale des mouvements : permet de garder les yeux sur le cube. */

const NOMS: Record<string, string> = {
  U: 'face du haut',
  D: 'face du bas',
  R: 'face de droite',
  L: 'face de gauche',
  F: 'face avant',
  B: 'face arriere',
};

export class Speaker {
  enabled = false;
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (typeof speechSynthesis === 'undefined') return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice = voices.find((v) => v.lang.startsWith('fr')) ?? null;
    };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  get available(): boolean {
    return typeof speechSynthesis !== 'undefined';
  }

  say(text: string): void {
    if (!this.enabled || !this.available) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = 'fr-FR';
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }

  announceMove(move: string): void {
    const face = NOMS[move[0]] ?? move[0];
    const sens = move.endsWith('2')
      ? 'demi-tour'
      : move.endsWith("'")
        ? 'sens inverse des aiguilles'
        : 'sens des aiguilles';
    this.say(`${face}, ${sens}`);
  }

  stop(): void {
    if (this.available) speechSynthesis.cancel();
  }
}
