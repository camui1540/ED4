import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronUp,
  Download,
  ListMusic,
  Move,
  Pause,
  Play,
  Plus,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  createBgmAudio,
  destroyBgmAudio,
  getBgmCurrentTime,
  getBgmFadeSec,
  pauseBgm,
  playBgm,
  seekBgmByRatio,
  setBgmLongFade,
  setBgmPlayMode,
  setBgmTrack,
  toggleBgmMuffled,
  unlockBrowserAudio,
  type BgmAudioState,
} from '../engine/bgmAudioEngine';
import { downloadBlob } from '../engine/browserUtils';
import {
  addTrackToPlaylist,
  clampNumber,
  formatBgmTime,
  getNextTrackInPlaylist,
  loadPlaylistFromStorage,
  parseImportedPlaylistJson,
  removeTrackFromPlaylist,
  savePlaylistToStorage,
  serializePlaylistJson,
  type BgmPlayMode,
  type BgmTrack,
} from '../engine/bgmPlaylist';
import { supabase, type RoomSession } from '../engine/supabaseSync';
import { inputCls } from './uiShared';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface BgmPlayerProps {
  roomSession: RoomSession;
}

const btnCls =
  'inline-flex h-7 items-center justify-center gap-1 rounded border border-border bg-secondary px-2 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50';
const btnActiveCls =
  'inline-flex h-7 items-center justify-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50';

export function BgmPlayer({ roomSession }: BgmPlayerProps) {
  const isConnected = Boolean(roomSession.connected && roomSession.roomCode && supabase);
  const isPlLocked = roomSession.role === 'pl';
  const liveRole: 'GM' | 'PL' = roomSession.role === 'pl' ? 'PL' : 'GM';

  const [playlist, setPlaylist] = useState<BgmTrack[]>(() => loadPlaylistFromStorage());
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const [libraryNotice, setLibraryNotice] = useState('');

  const [currentTrack, setCurrentTrack] = useState<{ url: string; title: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuffled, setIsMuffled] = useState(false);
  const [playMode, setPlayMode] = useState<BgmPlayMode>('loop');
  const [isLongFade, setIsLongFade] = useState(false);
  const [hasPeers, setHasPeers] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const [timeState, setTimeState] = useState({ currentTime: 0, duration: 0, progress: 0 });
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekPreviewRatio, setSeekPreviewRatio] = useState(0);

  const [isFloating, setIsFloating] = useState(false);
  const [floatPos, setFloatPos] = useState<{ left: number; top: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const engineRef = useRef<BgmAudioState | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const floatingCardRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const noticeTimerRef = useRef<number | null>(null);

  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const currentTrackRef = useRef(currentTrack);
  currentTrackRef.current = currentTrack;
  const playModeRef = useRef(playMode);
  playModeRef.current = playMode;
  const isLongFadeRef = useRef(isLongFade);
  isLongFadeRef.current = isLongFade;
  const isPlLockedRef = useRef(isPlLocked);
  isPlLockedRef.current = isPlLocked;
  const isSeekingRef = useRef(isSeeking);
  isSeekingRef.current = isSeeking;

  const showNotice = useCallback((msg: string) => {
    setLibraryNotice(msg);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setLibraryNotice(''), 2600);
  }, []);

  useEffect(() => {
    savePlaylistToStorage(playlist);
  }, [playlist]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const broadcastBgmEvent = useCallback(
    (payload: {
      url: string;
      action: 'play' | 'pause';
      title?: string;
      currentTime?: number;
      fade: boolean;
    }) => {
      if (!channelRef.current || isPlLockedRef.current) return;
      channelRef.current.send({
        type: 'broadcast',
        event: 'bgm',
        payload,
      });
    },
    []
  );

  const handleEndedRef = useRef<() => void>(() => {});

  const ensureEngine = useCallback((): BgmAudioState => {
    if (engineRef.current) return engineRef.current;

    const eng = createBgmAudio(
      currentTrackRef.current?.url || '',
      {
        onStateChange: ({ isPlaying: playing, isMuffled: muffled }) => {
          setIsPlaying(playing);
          setIsMuffled(muffled);
          if (playing) {
            setAudioError(false);
            setAutoplayBlocked(false);
          }
        },
        onTimeUpdate: (info) => {
          if (!isSeekingRef.current) {
            setTimeState(info);
          }
        },
        onEnded: () => {
          handleEndedRef.current();
        },
        onError: () => {
          setAudioError(true);
          setIsPlaying(false);
        },
        onAutoplayBlocked: () => {
          setAutoplayBlocked(true);
          setIsPlaying(false);
        },
      },
      currentTrackRef.current?.title || '',
      playModeRef.current,
      isLongFadeRef.current
    );
    engineRef.current = eng;
    return eng;
  }, []);

  const playTrackInternal = useCallback(
    async (
      track: { url: string; title: string },
      options?: { seekTime?: number; broadcast?: boolean }
    ) => {
      const eng = ensureEngine();
      setAudioError(false);
      setAutoplayBlocked(false);
      setCurrentTrack(track);
      currentTrackRef.current = track;
      setBgmPlayMode(eng, playModeRef.current);
      setBgmLongFade(eng, isLongFadeRef.current);
      setBgmTrack(eng, track.url, track.title);

      const ok = await playBgm(eng, getBgmFadeSec(eng), options?.seekTime);
      if (options?.broadcast && !isPlLockedRef.current) {
        broadcastBgmEvent({
          url: track.url,
          action: 'play',
          title: track.title,
          currentTime: options?.seekTime ?? 0,
          fade: isLongFadeRef.current,
        });
      }
      return ok;
    },
    [broadcastBgmEvent, ensureEngine]
  );

  handleEndedRef.current = () => {
    const eng = engineRef.current;
    if (!eng || isPlLockedRef.current) return;

    const mode = playModeRef.current;
    const activeTrack = currentTrackRef.current;

    if (mode === 'once') {
      pauseBgm(eng, 0);
      setIsPlaying(false);
      if (activeTrack) {
        broadcastBgmEvent({
          url: activeTrack.url,
          action: 'pause',
          fade: isLongFadeRef.current,
        });
      }
    } else if (mode === 'next') {
      pauseBgm(eng, 0);
      const nextTrack = getNextTrackInPlaylist(
        playlistRef.current,
        activeTrack?.url || eng.src
      );
      if (nextTrack) {
        void playTrackInternal(
          { url: nextTrack.url, title: nextTrack.title },
          { seekTime: 0, broadcast: true }
        );
      } else {
        setIsPlaying(false);
      }
    }
  };

  // 切换房间或退出房间时，清理音频实例与退订 trpg-bgm-${roomCode} Broadcast/Presence 频道
  useEffect(() => {
    if (!isConnected || !supabase || !roomSession.roomCode) {
      setHasPeers(false);
      return;
    }

    const roomCode = roomSession.roomCode;
    const bgmChannel = supabase.channel(`trpg-bgm-${roomCode}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = bgmChannel;

    const broadcastCurrent = () => {
      const eng = engineRef.current;
      const track = currentTrackRef.current;
      if (liveRole === 'GM' && track && eng && eng.isPlaying) {
        bgmChannel.send({
          type: 'broadcast',
          event: 'bgm',
          payload: {
            url: track.url,
            action: 'play',
            title: track.title,
            currentTime: getBgmCurrentTime(eng),
            fade: isLongFadeRef.current,
          },
        });
      }
    };

    bgmChannel
      .on('presence', { event: 'sync' }, () => {
        const count = Object.values(bgmChannel.presenceState()).flat().length;
        setHasPeers(count > 1);
        broadcastCurrent();
      })
      .on('presence', { event: 'join' }, () => {
        setHasPeers(true);
        broadcastCurrent();
      })
      .on('broadcast', { event: 'sync_req' }, () => {
        setHasPeers(true);
        broadcastCurrent();
      })
      .on('broadcast', { event: 'bgm_fade' }, ({ payload }) => {
        if (liveRole === 'PL' && payload) {
          const nextFade = Boolean(payload.fade);
          isLongFadeRef.current = nextFade;
          setIsLongFade(nextFade);
          if (engineRef.current) setBgmLongFade(engineRef.current, nextFade);
        }
      })
      .on('broadcast', { event: 'bgm' }, ({ payload }) => {
        setHasPeers(true);
        if (liveRole !== 'PL' || !payload) return;
        if (payload.fade !== undefined) {
          const nextFade = Boolean(payload.fade);
          isLongFadeRef.current = nextFade;
          setIsLongFade(nextFade);
          if (engineRef.current) setBgmLongFade(engineRef.current, nextFade);
        }
        if (payload.action === 'play' && payload.url) {
          const safeTitle = String(payload.title || '新曲目 (GM推送)');
          const seekTime =
            typeof payload.currentTime === 'number' ? payload.currentTime : undefined;
          void playTrackInternal(
            { url: String(payload.url), title: safeTitle },
            { seekTime, broadcast: false }
          );
        } else if (payload.action === 'pause' && engineRef.current) {
          pauseBgm(engineRef.current);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          bgmChannel.track({ role: liveRole, clientId: roomSession.clientId });
          if (liveRole === 'PL') {
            bgmChannel.send({ type: 'broadcast', event: 'sync_req', payload: {} });
          }
        }
      });

    return () => {
      channelRef.current = null;
      setHasPeers(false);
      supabase?.removeChannel(bgmChannel);
      if (engineRef.current) {
        destroyBgmAudio(engineRef.current);
        engineRef.current = null;
      }
      setIsPlaying(false);
      setAudioError(false);
      setAutoplayBlocked(false);
      setTimeState({ currentTime: 0, duration: 0, progress: 0 });
      if (liveRole === 'PL') {
        setCurrentTrack(null);
      }
    };
  }, [
    isConnected,
    liveRole,
    playTrackInternal,
    roomSession.clientId,
    roomSession.roomCode,
  ]);

  // 组件卸载时彻底销毁音频资源
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        destroyBgmAudio(engineRef.current);
        engineRef.current = null;
      }
    };
  }, []);

  // 悬浮窗口位置边界约束与视口尺寸变化同步
  const clampFloatPosition = useCallback((left: number, top: number) => {
    const rect = floatingCardRef.current?.getBoundingClientRect();
    const width = rect?.width || 380;
    const height = rect?.height || 180;
    return {
      left: clampNumber(left, 8, Math.max(8, window.innerWidth - width - 8)),
      top: clampNumber(top, 8, Math.max(8, window.innerHeight - height - 8)),
    };
  }, []);

  useEffect(() => {
    if (!isFloating) return;
    const handleResize = () => {
      setFloatPos((prev) => {
        const rect = floatingCardRef.current?.getBoundingClientRect();
        const width = rect?.width || 380;
        const height = rect?.height || 180;
        const base = prev || {
          left: window.innerWidth - width - 20,
          top: window.innerHeight - height - 20,
        };
        return clampFloatPosition(base.left, base.top);
      });
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    const ro =
      typeof ResizeObserver !== 'undefined' && floatingCardRef.current
        ? new ResizeObserver(() => handleResize())
        : null;
    if (ro && floatingCardRef.current) {
      ro.observe(floatingCardRef.current);
    }
    return () => {
      window.removeEventListener('resize', handleResize);
      ro?.disconnect();
    };
  }, [clampFloatPosition, isFloating, libraryOpen, playlist.length]);

  const handleToggleFloat = () => {
    setIsFloating((prev) => {
      const next = !prev;
      if (next && !floatPos) {
        setFloatPos({
          left: Math.max(8, window.innerWidth - 380 - 20),
          top: Math.max(8, window.innerHeight - 210),
        });
      }
      return next;
    });
  };

  const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isFloating) return;
    if ((e.target as HTMLElement).closest('button, input, select, label')) return;
    const rect = floatingCardRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const handleDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const nextPos = clampFloatPosition(
      e.clientX - dragOffsetRef.current.x,
      e.clientY - dragOffsetRef.current.y
    );
    setFloatPos(nextPos);
  };

  const handleDragPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handlePlayPause = async () => {
    if (isPlLocked) return;
    const eng = ensureEngine();
    const active = currentTrack || (playlist[0] ? { url: playlist[0].url, title: playlist[0].title } : null);
    if (!active) {
      setLibraryOpen(true);
      setLibraryError('请先添加至少一条音频直链再播放');
      return;
    }

    if (eng.isPlaying) {
      pauseBgm(eng);
      broadcastBgmEvent({
        url: active.url,
        action: 'pause',
        fade: isLongFade,
      });
    } else {
      if (!currentTrack || eng.src !== active.url) {
        await playTrackInternal(active, { seekTime: 0, broadcast: true });
      } else {
        const curTime = getBgmCurrentTime(eng);
        await playBgm(eng, getBgmFadeSec(eng));
        broadcastBgmEvent({
          url: active.url,
          action: 'play',
          title: active.title,
          currentTime: curTime,
          fade: isLongFade,
        });
      }
    }
  };

  const handleToggleMuffled = () => {
    const eng = ensureEngine();
    const muffled = toggleBgmMuffled(eng);
    setIsMuffled(muffled);
  };

  const handleChangePlayMode = (nextMode: BgmPlayMode) => {
    if (isPlLocked) return;
    setPlayMode(nextMode);
    playModeRef.current = nextMode;
    if (engineRef.current) setBgmPlayMode(engineRef.current, nextMode);
  };

  const handleToggleFade = () => {
    if (isPlLocked) return;
    const nextFade = !isLongFade;
    setIsLongFade(nextFade);
    isLongFadeRef.current = nextFade;
    if (engineRef.current) setBgmLongFade(engineRef.current, nextFade);
    if (isConnected && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'bgm_fade',
        payload: { fade: nextFade },
      });
    }
  };

  const handleAddTrack = (e: React.FormEvent) => {
    e.preventDefault();
    setLibraryError('');
    const res = addTrackToPlaylist(playlist, { title: newTitle, url: newUrl });
    if (!res.ok) {
      setLibraryError(res.error);
      return;
    }
    setPlaylist(res.tracks);
    setNewTitle('');
    setNewUrl('');
    showNotice(`已收录「${res.track.title}」`);
  };

  const handleRemoveTrack = (track: BgmTrack) => {
    setPlaylist((prev) => removeTrackFromPlaylist(prev, track.id));
  };

  const handleExportPlaylist = () => {
    downloadBlob('ed4-bgm-playlist.json', serializePlaylistJson(playlist), 'application/json;charset=utf-8');
    showNotice(`已导出 ${playlist.length} 首曲目`);
  };

  const handleImportPlaylistFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLibraryError('');
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      const res = parseImportedPlaylistJson(content, playlist);
      if (!res.ok) {
        setLibraryError(res.error);
        return;
      }
      setPlaylist(res.tracks);
      showNotice(`导入完成，新增 ${res.addedCount} 首曲目`);
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleUnlockAutoplay = async () => {
    unlockBrowserAudio();
    const eng = engineRef.current;
    if (eng && currentTrackRef.current) {
      setAutoplayBlocked(false);
      await playBgm(eng, getBgmFadeSec(eng));
    }
  };

  const progressRatio = isSeeking ? seekPreviewRatio : timeState.progress;
  const displayTitle =
    currentTrack?.title ||
    (isPlLocked ? '等待 GM 广播曲目...' : 'BGM 广播电台|点击曲库选曲');
  const liveStatusLabel = isConnected
    ? hasPeers
      ? `Live: ${liveRole}`
      : `Live: ${liveRole} (待机)`
    : 'Live: OFF';

  const cardElement = (
    <section
      ref={isFloating ? floatingCardRef : undefined}
      aria-label="BGM 广播播放器"
      style={
        isFloating && floatPos
          ? {
              left: `${floatPos.left}px`,
              top: `${floatPos.top}px`,
            }
          : undefined
      }
      className={
        isFloating
          ? 'tactile-card fixed z-50 flex w-[380px] max-w-[calc(100vw-24px)] flex-col gap-2 p-3 shadow-lg print:hidden'
          : 'tactile-card flex shrink-0 flex-col gap-2 p-3'
      }
    >
      {/* 标题栏（悬浮时支持自由拖拽） */}
      <div
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        onPointerCancel={handleDragPointerUp}
        title={isFloating ? '拖拽移动悬浮播放器' : currentTrack?.title || 'BGM 广播播放器'}
        className={`flex items-center justify-between gap-2 border-b border-border pb-1.5 ${
          isFloating ? 'cursor-move select-none touch-none' : ''
        }`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {isFloating && <Move className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span
            className="truncate font-serif text-xs font-semibold text-card-foreground"
            title={displayTitle}
          >
            {displayTitle}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {liveStatusLabel}
        </span>
      </div>

      {/* 主控制按钮行 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void handlePlayPause()}
          disabled={isPlLocked}
          aria-pressed={isPlaying}
          title={isPlLocked ? 'PL 端由 GM 统一控制播放与暂停' : isPlaying ? '暂停' : '播放'}
          className={isPlaying ? btnActiveCls : btnCls}
        >
          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          <span>{audioError ? 'Error' : isPlaying ? 'Pause' : 'Play'}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleMuffled}
          aria-pressed={isMuffled}
          title="800Hz 穿墙低通滤波开关"
          className={isMuffled ? btnActiveCls : btnCls}
        >
          {isMuffled ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          <span>{isMuffled ? 'Muffled: ON' : 'Muffled: OFF'}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleFloat}
          aria-pressed={isFloating}
          title={isFloating ? '停靠回侧边栏' : '自由悬浮拖拽'}
          className={isFloating ? btnActiveCls : btnCls}
        >
          <span>{isFloating ? 'Dock' : 'Float'}</span>
        </button>

        {!isPlLocked && (
          <>
            <select
              aria-label="播放模式"
              value={playMode}
              onChange={(e) => handleChangePlayMode(e.target.value as BgmPlayMode)}
              title="播放模式"
              className="h-7 cursor-pointer rounded border border-input bg-background px-1.5 text-[11px] text-foreground focus:border-ring outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            >
              <option value="loop">循环播放</option>
              <option value="once">只播一次</option>
              <option value="next">顺序连播</option>
            </select>

            <button
              type="button"
              onClick={handleToggleFade}
              aria-pressed={isLongFade}
              title="头尾 6 秒淡入淡出"
              className={isLongFade ? btnActiveCls : btnCls}
            >
              <span>{isLongFade ? 'Fade: 6s' : 'Fade: OFF'}</span>
            </button>

            <button
              type="button"
              onClick={() => setLibraryOpen((o) => !o)}
              aria-expanded={libraryOpen}
              title="展开或收起多 R2 曲库列表"
              className={libraryOpen ? btnActiveCls : btnCls}
            >
              <ListMusic className="h-3 w-3" />
              <span>曲库 ({playlist.length})</span>
              {libraryOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </>
        )}
      </div>

      {/* PL 端自动播放被浏览器策略拦截时的快速解锁入口 */}
      {autoplayBlocked && (
        <button
          type="button"
          onClick={() => void handleUnlockAutoplay()}
          className="w-full rounded border border-primary bg-primary/15 px-2 py-1 text-center text-[11px] font-medium text-foreground hover:bg-primary/25 cursor-pointer"
        >
          浏览器拦截了自动播放，点击恢复 GM 同步音频
        </button>
      )}

      {/* 底部进度条与时间 */}
      <div className="flex items-center gap-2">
        <input
          type="range"
          aria-label="音频播放进度"
          min={0}
          max={1000}
          step={1}
          disabled={isPlLocked || !currentTrack}
          value={Math.round(clampNumber(progressRatio, 0, 1) * 1000)}
          onPointerDown={() => {
            if (isPlLocked) return;
            setIsSeeking(true);
            setSeekPreviewRatio(timeState.progress);
          }}
          onChange={(e) => {
            if (isPlLocked) return;
            const ratio = parseFloat(e.target.value) / 1000;
            setSeekPreviewRatio(ratio);
            if (engineRef.current) seekBgmByRatio(engineRef.current, ratio);
          }}
          onPointerUp={() => setIsSeeking(false)}
          onPointerCancel={() => setIsSeeking(false)}
          onBlur={() => setIsSeeking(false)}
          className="h-1.5 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatBgmTime(timeState.currentTime, timeState.duration)}
        </span>
      </div>

      {/* 仅 GM 可见：可折叠的多 R2 曲库列表面板 */}
      {!isPlLocked && libraryOpen && (
        <div className="mt-0.5 space-y-2 border-t border-border pt-2">
          <form onSubmit={handleAddTrack} className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              <input
                type="text"
                aria-label="曲名"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="曲名（留空自动识别）"
                className={`${inputCls} min-w-[110px] flex-1`}
              />
              <button
                type="submit"
                className="inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer whitespace-nowrap"
              >
                <Plus className="h-3 w-3" />
                <span>添加曲目</span>
              </button>
            </div>
            <input
              type="url"
              aria-label="音频直链 URL"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="粘贴任意 R2 / 音频直链 URL (https://...)"
              className={`${inputCls} w-full font-mono text-[11px]`}
            />
          </form>

          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              点击曲目即播并广播给全房 PL
            </span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={handleExportPlaylist} className={btnCls}>
                <Download className="h-3 w-3" />
                <span>导出 JSON</span>
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className={btnCls}
              >
                <Upload className="h-3 w-3" />
                <span>导入 JSON</span>
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportPlaylistFile}
                className="hidden"
              />
            </div>
          </div>

          {libraryError && (
            <div role="alert" className="rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {libraryError}
            </div>
          )}
          {libraryNotice && (
            <div role="status" className="rounded border border-primary/50 bg-primary/10 px-2 py-1 text-[11px] text-foreground">
              {libraryNotice}
            </div>
          )}

          {playlist.length === 0 ? (
            <div className="rounded border border-dashed border-border py-3 text-center text-[11px] text-muted-foreground">
              曲库为空，可添加多个 R2 存储桶音频直链或导入 JSON 歌单
            </div>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto pr-0.5">
              {playlist.map((track) => {
                const isActive = currentTrack?.url === track.url;
                return (
                  <li
                    key={track.id}
                    className={`flex items-center justify-between gap-1.5 rounded border px-2 py-1 text-xs ${
                      isActive
                        ? 'border-primary bg-primary/15 text-foreground'
                        : 'border-border bg-background/70 text-card-foreground'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        void playTrackInternal(
                          { url: track.url, title: track.title },
                          { seekTime: 0, broadcast: true }
                        )
                      }
                      title={`${track.title}\n${track.url}`}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left cursor-pointer hover:text-primary"
                    >
                      <Play className={`h-3 w-3 shrink-0 ${isActive && isPlaying ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="truncate font-medium">{track.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${track.title}`}
                      onClick={() => handleRemoveTrack(track)}
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-secondary text-muted-foreground transition-colors hover:bg-muted hover:text-destructive cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );

  if (isFloating && typeof document !== 'undefined') {
    return (
      <>
        <div className="tactile-card flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <span className="truncate text-muted-foreground">
            BGM 悬浮播放中：{displayTitle}
          </span>
          <button type="button" onClick={handleToggleFloat} className={btnCls}>
            Dock
          </button>
        </div>
        {createPortal(cardElement, document.body)}
      </>
    );
  }

  return cardElement;
}
