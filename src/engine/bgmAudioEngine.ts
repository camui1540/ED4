import { clampNumber, shouldTriggerTailFade, type BgmPlayMode } from './bgmPlaylist';

export const BGM_AUDIO_CONFIG = {
  FADE_DURATION: 0.75,
  LONG_FADE_DURATION: 6.0,
  FILTER_FREQ_NORMAL: 20000,
  FILTER_FREQ_MUFFLED: 800,
  FILTER_TRANSITION_TIME: 0.25,
} as const;

export type AudioEngineCallbacks = {
  onStateChange: (state: { isPlaying: boolean; isMuffled: boolean }) => void;
  onTimeUpdate: (info: { currentTime: number; duration: number; progress: number }) => void;
  onEnded?: () => void;
  onError?: () => void;
  onAutoplayBlocked?: () => void;
};

export type BgmAudioState = {
  src: string;
  title: string;
  playMode: BgmPlayMode;
  isLongFade: boolean;
  callbacks: AudioEngineCallbacks;
  audioCtx: AudioContext | null;
  audioEl: HTMLAudioElement | null;
  sourceNode: MediaElementAudioSourceNode | null;
  filterNode: BiquadFilterNode | null;
  gainNode: GainNode | null;
  isInitialized: boolean;
  isPlaying: boolean;
  isMuffled: boolean;
  isTailFading: boolean;
  fadeTimerId: ReturnType<typeof setTimeout> | null;
  boundTimeUpdate: (() => void) | null;
  boundEnded: (() => void) | null;
  boundError: (() => void) | null;
  pendingSeekListener: (() => void) | null;
};

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

export function createBgmAudio(
  src: string,
  callbacks: AudioEngineCallbacks,
  title = '',
  playMode: BgmPlayMode = 'loop',
  isLongFade = false
): BgmAudioState {
  return {
    src,
    title,
    playMode,
    isLongFade,
    callbacks,
    audioCtx: null,
    audioEl: null,
    sourceNode: null,
    filterNode: null,
    gainNode: null,
    isInitialized: false,
    isPlaying: false,
    isMuffled: false,
    isTailFading: false,
    fadeTimerId: null,
    boundTimeUpdate: null,
    boundEnded: null,
    boundError: null,
    pendingSeekListener: null,
  };
}

export function getBgmFadeSec(audio: BgmAudioState): number {
  return audio.isLongFade
    ? BGM_AUDIO_CONFIG.LONG_FADE_DURATION
    : BGM_AUDIO_CONFIG.FADE_DURATION;
}

function initBgmAudioGraph(audio: BgmAudioState): void {
  if (audio.isInitialized) return;

  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  audio.audioCtx = new AudioCtx();

  audio.audioEl = new Audio();
  audio.audioEl.crossOrigin = 'anonymous';
  if (audio.src) audio.audioEl.src = audio.src;
  audio.audioEl.loop = audio.playMode === 'loop';
  audio.audioEl.preload = 'metadata';

  audio.boundEnded = () => {
    audio.callbacks.onEnded?.();
  };
  audio.audioEl.addEventListener('ended', audio.boundEnded);

  audio.sourceNode = audio.audioCtx.createMediaElementSource(audio.audioEl);
  audio.filterNode = audio.audioCtx.createBiquadFilter();
  audio.filterNode.type = 'lowpass';
  audio.filterNode.frequency.setValueAtTime(
    audio.isMuffled ? BGM_AUDIO_CONFIG.FILTER_FREQ_MUFFLED : BGM_AUDIO_CONFIG.FILTER_FREQ_NORMAL,
    audio.audioCtx.currentTime
  );
  audio.filterNode.Q.setValueAtTime(0.707, audio.audioCtx.currentTime);

  audio.gainNode = audio.audioCtx.createGain();
  audio.gainNode.gain.setValueAtTime(0.0001, audio.audioCtx.currentTime);

  audio.sourceNode.connect(audio.filterNode);
  audio.filterNode.connect(audio.gainNode);
  audio.gainNode.connect(audio.audioCtx.destination);

  audio.boundTimeUpdate = () => {
    const el = audio.audioEl!;
    const currentTime = el.currentTime || 0;
    const duration = el.duration || 0;
    const remaining = duration - currentTime;

    const tailDecision = shouldTriggerTailFade({
      isLongFade: audio.isLongFade,
      isPlaying: audio.isPlaying,
      isTailFading: audio.isTailFading,
      duration,
      currentTime,
      longFadeDuration: BGM_AUDIO_CONFIG.LONG_FADE_DURATION,
    });

    if (tailDecision === 'start_tail_fade') {
      audio.isTailFading = true;
      rampParam(audio.gainNode!.gain, 0.0001, remaining, audio.audioCtx!.currentTime);
    } else if (tailDecision === 'cancel_tail_fade') {
      audio.isTailFading = false;
      if (audio.isPlaying) {
        rampParam(audio.gainNode!.gain, 1.0, getBgmFadeSec(audio), audio.audioCtx!.currentTime);
      }
    }

    audio.callbacks.onTimeUpdate({
      currentTime,
      duration,
      progress: duration > 0 ? currentTime / duration : 0,
    });
  };

  audio.boundError = () => {
    audio.isPlaying = false;
    audio.callbacks.onStateChange({ isPlaying: false, isMuffled: audio.isMuffled });
    audio.callbacks.onError?.();
  };

  audio.audioEl.addEventListener('timeupdate', audio.boundTimeUpdate);
  audio.audioEl.addEventListener('loadedmetadata', audio.boundTimeUpdate);
  audio.audioEl.addEventListener('error', audio.boundError);
  audio.isInitialized = true;
}

export function setBgmPlayMode(audio: BgmAudioState, mode: BgmPlayMode): void {
  audio.playMode = mode;
  if (audio.audioEl) audio.audioEl.loop = mode === 'loop';
}

export function setBgmLongFade(audio: BgmAudioState, fade: boolean): void {
  audio.isLongFade = fade;
}

export function setBgmTrack(audio: BgmAudioState, url: string, title = ''): void {
  const isSameUrl = audio.src === url;
  audio.src = url;
  audio.title = title;
  if (audio.pendingSeekListener && audio.audioEl) {
    audio.audioEl.removeEventListener('loadedmetadata', audio.pendingSeekListener);
    audio.pendingSeekListener = null;
  }
  if (!isSameUrl && audio.isInitialized && audio.audioEl && audio.gainNode && audio.audioCtx) {
    if (audio.fadeTimerId) clearTimeout(audio.fadeTimerId);
    audio.fadeTimerId = null;
    audio.isTailFading = false;
    audio.isPlaying = false;
    audio.audioEl.pause();
    audio.audioEl.crossOrigin = 'anonymous';
    audio.audioEl.src = url;
    audio.audioEl.loop = audio.playMode === 'loop';
    audio.gainNode.gain.cancelScheduledValues(audio.audioCtx.currentTime);
    audio.gainNode.gain.setValueAtTime(0.0001, audio.audioCtx.currentTime);
    audio.callbacks.onTimeUpdate({ currentTime: 0, duration: 0, progress: 0 });
    audio.callbacks.onStateChange({ isPlaying: false, isMuffled: audio.isMuffled });
  }
}

function applyBgmSeek(audio: BgmAudioState, currentTime: number): void {
  const el = audio.audioEl;
  if (!el) return;
  if (audio.pendingSeekListener) {
    el.removeEventListener('loadedmetadata', audio.pendingSeekListener);
    audio.pendingSeekListener = null;
  }
  const seek = () => {
    try {
      el.currentTime = Math.max(0, currentTime);
    } catch {
      // 忽略尚未就绪的 seek 异常
    }
  };
  if (el.readyState >= 1) {
    seek();
  } else {
    audio.pendingSeekListener = () => {
      audio.pendingSeekListener = null;
      seek();
    };
    el.addEventListener('loadedmetadata', audio.pendingSeekListener, { once: true });
  }
}

export async function playBgm(
  audio: BgmAudioState,
  fadeDuration = getBgmFadeSec(audio),
  seekTime?: number
): Promise<boolean> {
  if (!audio.src) return false;
  initBgmAudioGraph(audio);
  const ctx = audio.audioCtx!;
  const el = audio.audioEl!;
  const gain = audio.gainNode!;

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // 忽略尚未触发用户手势时的 resume 限制
    }
  }

  if (seekTime !== undefined) applyBgmSeek(audio, seekTime);

  if (audio.fadeTimerId) clearTimeout(audio.fadeTimerId);
  audio.fadeTimerId = null;
  audio.isTailFading = false;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  rampParam(gain.gain, 1.0, fadeDuration, ctx.currentTime);

  try {
    await el.play();
    audio.isPlaying = true;
    audio.callbacks.onStateChange({ isPlaying: true, isMuffled: audio.isMuffled });
    return true;
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    audio.isPlaying = false;
    audio.callbacks.onStateChange({ isPlaying: false, isMuffled: audio.isMuffled });
    if (name === 'NotAllowedError') {
      audio.callbacks.onAutoplayBlocked?.();
    } else if (name !== 'AbortError') {
      audio.callbacks.onError?.();
    }
    return false;
  }
}

export function pauseBgm(audio: BgmAudioState, fadeDuration = getBgmFadeSec(audio)): void {
  if (!audio.isInitialized || !audio.audioEl || !audio.gainNode || !audio.audioCtx) return;
  if (!audio.isPlaying && audio.audioEl.paused) return;

  if (audio.fadeTimerId) clearTimeout(audio.fadeTimerId);
  audio.fadeTimerId = null;
  audio.isPlaying = false;
  audio.isTailFading = false;
  audio.callbacks.onStateChange({ isPlaying: false, isMuffled: audio.isMuffled });

  if (fadeDuration <= 0) {
    audio.gainNode.gain.cancelScheduledValues(audio.audioCtx.currentTime);
    audio.gainNode.gain.setValueAtTime(0.0001, audio.audioCtx.currentTime);
    audio.audioEl.pause();
  } else {
    rampParam(audio.gainNode.gain, 0.0001, fadeDuration, audio.audioCtx.currentTime);
    audio.fadeTimerId = setTimeout(() => {
      audio.audioEl?.pause();
    }, fadeDuration * 1000);
  }
}

export function toggleBgmMuffled(audio: BgmAudioState): boolean {
  audio.isMuffled = !audio.isMuffled;
  if (audio.isInitialized && audio.filterNode && audio.audioCtx) {
    const target = audio.isMuffled
      ? BGM_AUDIO_CONFIG.FILTER_FREQ_MUFFLED
      : BGM_AUDIO_CONFIG.FILTER_FREQ_NORMAL;
    rampParam(
      audio.filterNode.frequency,
      target,
      BGM_AUDIO_CONFIG.FILTER_TRANSITION_TIME,
      audio.audioCtx.currentTime,
      true
    );
  }
  audio.callbacks.onStateChange({ isPlaying: audio.isPlaying, isMuffled: audio.isMuffled });
  return audio.isMuffled;
}

export function seekBgmByRatio(audio: BgmAudioState, ratio: number): void {
  if (!audio.audioEl || !audio.audioEl.duration) return;
  audio.audioEl.currentTime = clampNumber(ratio, 0, 1) * audio.audioEl.duration;
}

export function getBgmCurrentTime(audio: BgmAudioState): number {
  return audio.audioEl?.currentTime || 0;
}

export function destroyBgmAudio(audio: BgmAudioState): void {
  if (audio.fadeTimerId) {
    clearTimeout(audio.fadeTimerId);
    audio.fadeTimerId = null;
  }
  if (audio.audioEl) {
    if (audio.boundTimeUpdate) {
      audio.audioEl.removeEventListener('timeupdate', audio.boundTimeUpdate);
      audio.audioEl.removeEventListener('loadedmetadata', audio.boundTimeUpdate);
    }
    if (audio.boundEnded) audio.audioEl.removeEventListener('ended', audio.boundEnded);
    if (audio.boundError) audio.audioEl.removeEventListener('error', audio.boundError);
    if (audio.pendingSeekListener) {
      audio.audioEl.removeEventListener('loadedmetadata', audio.pendingSeekListener);
    }
    audio.audioEl.pause();
    audio.audioEl.removeAttribute('src');
    audio.audioEl.load();
  }
  try {
    audio.sourceNode?.disconnect();
    audio.filterNode?.disconnect();
    audio.gainNode?.disconnect();
  } catch {
    // 忽略已断开节点的异常
  }
  if (audio.audioCtx && audio.audioCtx.state !== 'closed') {
    audio.audioCtx.close().catch(() => {});
  }
  audio.sourceNode = null;
  audio.filterNode = null;
  audio.gainNode = null;
  audio.audioEl = null;
  audio.audioCtx = null;
  audio.boundTimeUpdate = null;
  audio.boundEnded = null;
  audio.boundError = null;
  audio.pendingSeekListener = null;
  audio.isInitialized = false;
  audio.isPlaying = false;
  audio.isTailFading = false;
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
