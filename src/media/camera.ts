/**
 * Acces camera, pense pour telephone ET ordinateur.
 * Priorite a la camera arriere sur mobile (l'utilisateur et l'objectif voient
 * alors la meme face du cube, ce qui supprime toute ambiguite gauche/droite).
 */

export interface CameraCapabilities {
  torch: boolean;
  zoom: boolean;
  exposure: boolean;
  facingModes: string[];
}

export interface CameraStartOptions {
  deviceId?: string;
  facingMode?: 'environment' | 'user';
  width?: number;
  height?: number;
}

export class Camera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private torchOn = false;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.setAttribute('playsinline', '');
  }

  get active(): boolean {
    return !!this.stream;
  }

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  get facingMode(): string {
    const settings = this.track?.getSettings();
    return (settings?.facingMode as string) ?? '';
  }

  /** Vrai si l'image doit etre presentee en miroir (camera frontale). */
  get isFrontFacing(): boolean {
    const mode = this.facingMode;
    if (mode) return mode === 'user';
    // sur ordinateur, facingMode est souvent absent : la webcam fait face
    return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  async start(options: CameraStartOptions = {}): Promise<void> {
    this.stop();
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        ...(options.deviceId
          ? { deviceId: { exact: options.deviceId } }
          : { facingMode: { ideal: options.facingMode ?? 'environment' } }),
        width: { ideal: options.width ?? 1280 },
        height: { ideal: options.height ?? 720 },
        frameRate: { ideal: 30, max: 60 },
      },
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      // repli : contraintes minimales (certains appareils refusent l'ideal)
      if (options.deviceId) throw error;
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => undefined);
    await this.waitForDimensions();
  }

  private waitForDimensions(): Promise<void> {
    if (this.video.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.video.removeEventListener('loadedmetadata', done);
        resolve();
      };
      this.video.addEventListener('loadedmetadata', done);
      setTimeout(done, 3000);
    });
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.torchOn = false;
  }

  capabilities(): CameraCapabilities {
    const track = this.track;
    const caps = (track?.getCapabilities?.() ?? {}) as Record<string, unknown>;
    return {
      torch: 'torch' in caps,
      zoom: 'zoom' in caps,
      exposure: 'exposureCompensation' in caps || 'exposureTime' in caps,
      facingModes: (caps.facingMode as string[]) ?? [],
    };
  }

  async listCameras(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  async setTorch(on: boolean): Promise<boolean> {
    const track = this.track;
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      this.torchOn = on;
      return true;
    } catch {
      return false;
    }
  }

  get torchEnabled(): boolean {
    return this.torchOn;
  }

  /**
   * Tente de baisser l'exposition. Les reflets et les blancs brules sont la
   * premiere cause d'erreur de lecture : quand l'appareil le permet, mieux vaut
   * sous-exposer legerement que perdre l'information dans la saturation.
   */
  async nudgeExposure(direction: -1 | 1): Promise<boolean> {
    const track = this.track;
    if (!track) return false;
    const caps = (track.getCapabilities?.() ?? {}) as Record<string, any>;
    const settings = (track.getSettings?.() ?? {}) as Record<string, any>;
    try {
      if (caps.exposureCompensation) {
        const { min, max, step } = caps.exposureCompensation;
        const current = settings.exposureCompensation ?? 0;
        const next = Math.max(min, Math.min(max, current + direction * (step || 0.3) * 3));
        await track.applyConstraints({ advanced: [{ exposureCompensation: next } as any] });
        return true;
      }
      if (caps.exposureTime && caps.exposureMode?.includes('manual')) {
        const { min, max } = caps.exposureTime;
        const current = settings.exposureTime ?? (min + max) / 2;
        const next = Math.max(min, Math.min(max, current * (direction < 0 ? 0.7 : 1.4)));
        await track.applyConstraints({
          advanced: [{ exposureMode: 'manual', exposureTime: next } as any],
        });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}

/** Empeche l'ecran de s'eteindre pendant la resolution. */
export class ScreenLock {
  private sentinel: WakeLockSentinel | null = null;

  async acquire(): Promise<void> {
    try {
      this.sentinel = await navigator.wakeLock?.request('screen');
      document.addEventListener('visibilitychange', this.onVisibility);
    } catch {
      /* non supporte : sans consequence */
    }
  }

  private onVisibility = async () => {
    if (document.visibilityState === 'visible' && !this.sentinel) {
      try {
        this.sentinel = await navigator.wakeLock?.request('screen');
      } catch {
        /* ignore */
      }
    }
  };

  release(): void {
    this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }
}
