import { clampNumber, shouldTriggerTailFade, type BgmPlayMode } from './bgmPlaylist';

export const BGM_AUDIO_CONFIG = {
  FADE_DURATION: 0.75,
  LONG_FADE_DURATION: 6.0,
  FILTER_FREQ_NORMAL: 20000,
  FILTER_FREQ_MUFFLED: 800,
  FILTER_TRANSITION_TIME: 0.25,
} as const;

export interface AudioEngineCallbacks {
  onStateChange: (state: { isPlaying: boolean; isMuffled: boolean }) => void;
  onTimeUpdate: (info: { currentTime: number; duration: number; progress: number }) => void;
  onEnded?: () => void;
  onError?: () => void;
  onAutoplayBlocked?: () => void;
}

function rampParam(
  param: AudioParam,
  target: number,
  duration: number,
  now: number,
  exponential = false
) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(Math.max(0.0001, param.value), now);
  if (exponential) {
    param.exponentialRampToValueAtTime(target, now + duration);
  } else {
    param.linearRampToValueAtTime(target, now + duration);
  }
}

/**
 * 保留油猴脚本 1.3.4 中的核心 Web Audio 引擎：
 * AudioContext + 800Hz BiquadFilterNode (Muffled 穿墙) + GainNode 0.75s / 6s 头尾淡入淡出
 */
export class BgmAudioEngine {
  src: string;
  title: string;
  playMode: BgmPlayMode;
  isLongFade: boolean;
  callbacks: AudioEngineCallbacks;

  audioCtx: AudioContext | null = null;
  audioEl: HTMLAudioElement | null = null;
  sourceNode: MediaElementAudioSourceNode | null = null;
  filterNode: BiquadFilterNode | null = null;
  gainNode: GainNode | null = null;

  isInitialized = false;
  isPlaying = false;
  isMuffled = false;
  isTailFading = false;
  fadeTimerId: ReturnType<typeof setTimeout> | null = null;
  private boundTimeUpdate: (() => void) | null = null;
  private boundEnded: (() => void) | null = null;
  private boundError: (() => void) | null = null;
  private pendingSeekListener: (() => void) | null = null;

  constructor(
    src: string,
    callbacks: AudioEngineCallbacks,
    title = '',
    playMode: BgmPlayMode = 'loop',
    isLongFade = false
  ) {
    this.src = src;
    this.title = title;
    this.playMode = playMode;
    this.isLongFade = isLongFade;
    this.callbacks = callbacks;
  }

  getFadeSec(): number {
    return this.isLongFade
      ? BGM_AUDIO_CONFIG.LONG_FADE_DURATION
      : BGM_AUDIO_CONFIG.FADE_DURATION;
  }

  initAudioGraph(): void {
    if (this.isInitialized) return;

    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioCtx();

    this.audioEl = new Audio();
    this.audioEl.crossOrigin = 'anonymous';
    if (this.src) {
      this.audioEl.src = this.src;
    }
    this.audioEl.loop = this.playMode === 'loop';
    this.audioEl.preload = 'metadata';

    this.boundEnded = () => {
      this.callbacks.onEnded?.();
    };
    this.audioEl.addEventListener('ended', this.boundEnded);

    this.sourceNode = this.audioCtx.createMediaElementSource(this.audioEl);

    this.filterNode = this.audioCtx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(
      this.isMuffled ? BGM_AUDIO_CONFIG.FILTER_FREQ_MUFFLED : BGM_AUDIO_CONFIG.FILTER_FREQ_NORMAL,
      this.audioCtx.currentTime
    );
    this.filterNode.Q.setValueAtTime(0.707, this.audioCtx.currentTime);

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(0.0001, this.audioCtx.currentTime);

    this.sourceNode.connect(this.filterNode);
    this.filterNode.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);

    this.boundTimeUpdate = () => {
      if (!this.audioEl || !this.gainNode || !this.audioCtx) return;
      const currentTime = this.audioEl.currentTime || 0;
      const duration = this.audioEl.duration || 0;
      const remaining = duration - currentTime;

      const tailDecision = shouldTriggerTailFade({
        isLongFade: this.isLongFade,
        isPlaying: this.isPlaying,
        isTailFading: this.isTailFading,
        duration,
        currentTime,
        longFadeDuration: BGM_AUDIO_CONFIG.LONG_FADE_DURATION,
      });

      if (tailDecision === 'start_tail_fade') {
        this.isTailFading = true;
        rampParam(this.gainNode.gain, 0.0001, remaining, this.audioCtx.currentTime);
      } else if (tailDecision === 'cancel_tail_fade') {
        this.isTailFading = false;
        if (this.isPlaying) {
          rampParam(this.gainNode.gain, 1.0, this.getFadeSec(), this.audioCtx.currentTime);
        }
      }

      this.callbacks.onTimeUpdate({
        currentTime,
        duration,
        progress: duration > 0 ? currentTime / duration : 0,
      });
    };

    this.boundError = () => {
      this.isPlaying = false;
      this.callbacks.onStateChange({ isPlaying: false, isMuffled: this.isMuffled });
      this.callbacks.onError?.();
    };

    this.audioEl.addEventListener('timeupdate', this.boundTimeUpdate);
    this.audioEl.addEventListener('loadedmetadata', this.boundTimeUpdate);
    this.audioEl.addEventListener('error', this.boundError);

    this.isInitialized = true;
  }

  setPlayMode(mode: BgmPlayMode): void {
    this.playMode = mode;
    if (this.audioEl) {
      this.audioEl.loop = mode === 'loop';
    }
  }

  setLongFade(fade: boolean): void {
    this.isLongFade = fade;
  }

  setTrack(url: string, title = ''): void {
    const isSameUrl = this.src === url;
    this.src = url;
    this.title = title;
    if (this.pendingSeekListener && this.audioEl) {
      this.audioEl.removeEventListener('loadedmetadata', this.pendingSeekListener);
      this.pendingSeekListener = null;
    }
    if (!isSameUrl && this.isInitialized && this.audioEl && this.gainNode && this.audioCtx) {
      if (this.fadeTimerId) clearTimeout(this.fadeTimerId);
      this.fadeTimerId = null;
      this.isTailFading = false;
      this.isPlaying = false;
      this.audioEl.pause();
      this.audioEl.crossOrigin = 'anonymous';
      this.audioEl.src = url;
      this.audioEl.loop = this.playMode === 'loop';
      this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.gainNode.gain.setValueAtTime(0.0001, this.audioCtx.currentTime);
      this.callbacks.onTimeUpdate({ currentTime: 0, duration: 0, progress: 0 });
      this.callbacks.onStateChange({ isPlaying: false, isMuffled: this.isMuffled });
    }
  }

  applySeek(currentTime?: number): void {
    if (currentTime === undefined || !this.audioEl) return;
    if (this.pendingSeekListener) {
      this.audioEl.removeEventListener('loadedmetadata', this.pendingSeekListener);
      this.pendingSeekListener = null;
    }
    const seek = () => {
      if (!this.audioEl) return;
      try {
        this.audioEl.currentTime = Math.max(0, currentTime);
      } catch {
        // 忽略尚未就绪的 seek 异常
      }
    };
    if (this.audioEl.readyState >= 1) {
      seek();
    } else {
      this.pendingSeekListener = () => {
        this.pendingSeekListener = null;
        seek();
      };
      this.audioEl.addEventListener('loadedmetadata', this.pendingSeekListener, { once: true });
    }
  }

  async play(fadeDuration = this.getFadeSec(), seekTime?: number): Promise<boolean> {
    if (!this.src) return false;
    this.initAudioGraph();
    if (!this.audioCtx || !this.audioEl || !this.gainNode) return false;

    if (this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch {
        // 忽略尚未触发用户手势时的 resume 限制
      }
    }

    if (seekTime !== undefined) {
      this.applySeek(seekTime);
    }

    if (this.fadeTimerId) clearTimeout(this.fadeTimerId);
    this.fadeTimerId = null;
    this.isTailFading = false;
    this.gainNode.gain.setValueAtTime(0.0001, this.audioCtx.currentTime);
    rampParam(this.gainNode.gain, 1.0, fadeDuration, this.audioCtx.currentTime);

    try {
      await this.audioEl.play();
      this.isPlaying = true;
      this.callbacks.onStateChange({ isPlaying: true, isMuffled: this.isMuffled });
      return true;
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      this.isPlaying = false;
      this.callbacks.onStateChange({ isPlaying: false, isMuffled: this.isMuffled });
      if (name === 'NotAllowedError') {
        this.callbacks.onAutoplayBlocked?.();
      } else if (name !== 'AbortError') {
        this.callbacks.onError?.();
      }
      return false;
    }
  }

  pause(fadeDuration = this.getFadeSec()): void {
    if (!this.isInitialized || !this.audioEl || !this.gainNode || !this.audioCtx) return;
    if (!this.isPlaying && this.audioEl.paused) return;

    if (this.fadeTimerId) clearTimeout(this.fadeTimerId);
    this.fadeTimerId = null;
    this.isPlaying = false;
    this.isTailFading = false;
    this.callbacks.onStateChange({ isPlaying: false, isMuffled: this.isMuffled });

    if (fadeDuration <= 0) {
      this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.gainNode.gain.setValueAtTime(0.0001, this.audioCtx.currentTime);
      this.audioEl.pause();
    } else {
      rampParam(this.gainNode.gain, 0.0001, fadeDuration, this.audioCtx.currentTime);
      this.fadeTimerId = setTimeout(() => {
        this.audioEl?.pause();
      }, fadeDuration * 1000);
    }
  }

  toggleMuffled(): boolean {
    this.isMuffled = !this.isMuffled;
    if (this.isInitialized && this.filterNode && this.audioCtx) {
      const target = this.isMuffled
        ? BGM_AUDIO_CONFIG.FILTER_FREQ_MUFFLED
        : BGM_AUDIO_CONFIG.FILTER_FREQ_NORMAL;
      rampParam(
        this.filterNode.frequency,
        target,
        BGM_AUDIO_CONFIG.FILTER_TRANSITION_TIME,
        this.audioCtx.currentTime,
        true
      );
    }
    this.callbacks.onStateChange({ isPlaying: this.isPlaying, isMuffled: this.isMuffled });
    return this.isMuffled;
  }

  seekByRatio(ratio: number): void {
    if (!this.audioEl || !this.audioEl.duration) return;
    this.audioEl.currentTime = clampNumber(ratio, 0, 1) * this.audioEl.duration;
  }

  getCurrentTime(): number {
    return this.audioEl?.currentTime || 0;
  }

  destroy(): void {
    if (this.fadeTimerId) {
      clearTimeout(this.fadeTimerId);
      this.fadeTimerId = null;
    }
    if (this.audioEl) {
      if (this.boundTimeUpdate) {
        this.audioEl.removeEventListener('timeupdate', this.boundTimeUpdate);
        this.audioEl.removeEventListener('loadedmetadata', this.boundTimeUpdate);
      }
      if (this.boundEnded) {
        this.audioEl.removeEventListener('ended', this.boundEnded);
      }
      if (this.boundError) {
        this.audioEl.removeEventListener('error', this.boundError);
      }
      if (this.pendingSeekListener) {
        this.audioEl.removeEventListener('loadedmetadata', this.pendingSeekListener);
      }
      this.audioEl.pause();
      this.audioEl.removeAttribute('src');
      this.audioEl.load();
    }
    try {
      this.sourceNode?.disconnect();
      this.filterNode?.disconnect();
      this.gainNode?.disconnect();
    } catch {
      // 忽略已断开节点的异常
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
    this.sourceNode = null;
    this.filterNode = null;
    this.gainNode = null;
    this.audioEl = null;
    this.audioCtx = null;
    this.boundTimeUpdate = null;
    this.boundEnded = null;
    this.boundError = null;
    this.pendingSeekListener = null;
    this.isInitialized = false;
    this.isPlaying = false;
    this.isTailFading = false;
  }
}

export function unlockBrowserAudio(): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      ctx.resume().then(() => ctx.close().catch(() => {})).catch(() => {});
    }
    document.createElement('audio').play().catch(() => {});
  } catch {
    // 忽略浏览器音频解锁异常
  }
}
