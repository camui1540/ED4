export type BgmPlayMode = 'loop' | 'once' | 'next';

export interface BgmTrack {
  id: string;
  title: string;
  url: string;
  addedAt: number;
}

export const BGM_PLAYLIST_STORAGE_KEY = 'ed4_bgm_playlist_v1';

export function clampNumber(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function isValidAudioUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^https?:\/\/\S+/i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
  if (/^\/[^\s]*/.test(trimmed)) return true;
  return false;
}

export function deriveTrackTitle(url: string, customTitle?: string): string {
  const explicit = (customTitle || '').trim();
  if (explicit) return explicit;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed, 'https://local.placeholder');
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';
    const decoded = decodeURIComponent(last).replace(/\.[a-z0-9]{1,8}$/i, '').trim();
    if (decoded) return decoded;
  } catch {
    // 忽略 URL 解析失败，降级使用原始字符串
  }
  return '未命名曲目';
}

export function createTrackId(url: string): string {
  const randomPart = Math.random().toString(36).slice(2, 8);
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) | 0;
  }
  return `bgm_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}_${randomPart}`;
}

export function addTrackToPlaylist(
  tracks: BgmTrack[],
  input: { title?: string; url: string }
): { ok: true; tracks: BgmTrack[]; track: BgmTrack } | { ok: false; error: string } {
  const cleanUrl = input.url.trim();
  if (!isValidAudioUrl(cleanUrl)) {
    return { ok: false, error: '请输入有效的音频直链 URL（需以 http://、https:// 或 / 开头）' };
  }

  const resolvedTitle = deriveTrackTitle(cleanUrl, input.title);
  const existingIdx = tracks.findIndex((t) => t.url === cleanUrl);
  if (existingIdx >= 0) {
    const updated: BgmTrack = {
      ...tracks[existingIdx],
      title: input.title?.trim() ? resolvedTitle : tracks[existingIdx].title,
    };
    const nextTracks = tracks.map((t, idx) => (idx === existingIdx ? updated : t));
    return { ok: true, tracks: nextTracks, track: updated };
  }

  const newTrack: BgmTrack = {
    id: createTrackId(cleanUrl),
    title: resolvedTitle,
    url: cleanUrl,
    addedAt: Date.now(),
  };
  return { ok: true, tracks: [...tracks, newTrack], track: newTrack };
}

export function removeTrackFromPlaylist(tracks: BgmTrack[], id: string): BgmTrack[] {
  return tracks.filter((t) => t.id !== id);
}

export function getNextTrackInPlaylist(tracks: BgmTrack[], currentUrl: string): BgmTrack | null {
  if (tracks.length === 0) return null;
  const curIdx = tracks.findIndex((t) => t.url === currentUrl);
  if (curIdx < 0) return tracks[0];
  return tracks[(curIdx + 1) % tracks.length];
}

export function serializePlaylistJson(tracks: BgmTrack[]): string {
  const clean = tracks.map((t) => ({
    title: t.title,
    url: t.url,
  }));
  return JSON.stringify(clean, null, 2);
}

export function parseImportedPlaylistJson(
  rawJson: string,
  existingTracks: BgmTrack[] = []
): { ok: true; tracks: BgmTrack[]; addedCount: number } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: '歌单 JSON 格式无效，请检查文件内容' };
  }

  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as any).tracks)
      ? (parsed as any).tracks
      : null;

  if (!rawList) {
    return { ok: false, error: '歌单 JSON 应为曲目数组或包含 tracks 数组的对象' };
  }

  let nextTracks = [...existingTracks];
  let addedCount = 0;

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rawUrl = String((item as any).url || '').trim();
    if (!isValidAudioUrl(rawUrl)) continue;
    const beforeLen = nextTracks.length;
    const res = addTrackToPlaylist(nextTracks, {
      title: typeof (item as any).title === 'string' ? (item as any).title : '',
      url: rawUrl,
    });
    if (res.ok) {
      nextTracks = res.tracks;
      if (nextTracks.length > beforeLen) addedCount += 1;
    }
  }

  if (addedCount === 0 && rawList.length > 0 && existingTracks.length === nextTracks.length) {
    const hasAnyValid = rawList.some(
      (item: any) => item && typeof item === 'object' && isValidAudioUrl(String(item.url || ''))
    );
    if (!hasAnyValid) {
      return { ok: false, error: '歌单中未包含有效的音频直链 URL' };
    }
  }

  return { ok: true, tracks: nextTracks, addedCount };
}

export function loadPlaylistFromStorage(): BgmTrack[] {
  try {
    const raw = window.localStorage.getItem(BGM_PLAYLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.url === 'string' && isValidAudioUrl(item.url))
      .map((item) => ({
        id: typeof item.id === 'string' && item.id ? item.id : createTrackId(item.url),
        title: deriveTrackTitle(item.url, typeof item.title === 'string' ? item.title : ''),
        url: item.url.trim(),
        addedAt: typeof item.addedAt === 'number' ? item.addedAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

export function savePlaylistToStorage(tracks: BgmTrack[]): void {
  try {
    window.localStorage.setItem(BGM_PLAYLIST_STORAGE_KEY, JSON.stringify(tracks));
  } catch {
    // 忽略本地存储受限场景
  }
}

export function formatBgmTime(current: number, duration: number): string {
  const fmt = (sec: number) => {
    const s = Math.max(0, Math.floor(sec || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  return duration > 0 ? `${fmt(current)} / ${fmt(duration)}` : fmt(current);
}

export function shouldTriggerTailFade(params: {
  isLongFade: boolean;
  isPlaying: boolean;
  isTailFading: boolean;
  duration: number;
  currentTime: number;
  longFadeDuration: number;
}): 'start_tail_fade' | 'cancel_tail_fade' | 'none' {
  const { isLongFade, isPlaying, isTailFading, duration, currentTime, longFadeDuration } = params;
  const remaining = duration - currentTime;

  if (
    isLongFade &&
    isPlaying &&
    duration > longFadeDuration * 2 &&
    remaining <= longFadeDuration &&
    remaining > 0.1
  ) {
    return isTailFading ? 'none' : 'start_tail_fade';
  }

  if (isTailFading && (!isLongFade || remaining > longFadeDuration)) {
    return 'cancel_tail_fade';
  }

  return 'none';
}
