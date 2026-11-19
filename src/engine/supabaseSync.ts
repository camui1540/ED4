import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { formatTime, getPlDerivedView } from './combatHelpers';

export type RoomRole = 'gm' | 'pl';

export type BlindRollBroadcastPayload = {
  id: string;
  type: 'BLIND_ROLL';
  sender: string;
  timestamp: number;
};

export interface RoomSession {
  connected: boolean;
  roomCode: string;
  role: RoomRole | null;
  nickname: string;
  clientId: string;
}

export interface RoomCharacterRow {
  id: string;
  room_code: string;
  client_id: string;
  nickname: string;
  role: RoomRole;
  char_name: string;
  race_id: string;
  discipline_id: string;
  circle: number;
  current_damage: number;
  blood_damage: number;
  wounds: number;
  eff_uncon: number;
  eff_death: number;
  karma_current: number;
  karma_max: number;
  init_step: number;
  dex_val: number;
  pd: number;
  md: number;
  pa: number;
  ma: number;
  statuses: Record<string, boolean>;
  options: Record<string, boolean>;
  spells_summary: Array<{ nameCn: string; threads: number; wovenThreads: number }>;
  gear_summary: Array<{ name: string; effect: string }>;
  background?: string;
  updated_at: string;
}

const metaEnv: Record<string, string | undefined> =
  typeof import.meta !== 'undefined' && (import.meta as any).env ? (import.meta as any).env : {};

const SUPABASE_URL = (metaEnv.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (metaEnv.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && /^https?:\/\//i.test(SUPABASE_URL)
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

let memoryClientId = '';

// 每个标签页分配独立 clientId，避免同机双开测试时身份冲突
export function getSessionClientId(): string {
  if (memoryClientId) return memoryClientId;
  try {
    const existing = window.sessionStorage.getItem('ed4_client_id');
    if (existing) {
      memoryClientId = existing;
      return existing;
    }
    const created = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem('ed4_client_id', created);
    memoryClientId = created;
    return created;
  } catch {
    memoryClientId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return memoryClientId;
  }
}

// 默认生成 6 位数字房间码（支持玩家自定义任意字符或中文房间码）
export function generateRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function extractRoomCodeFromUrl(search?: string): string {
  const raw =
    search !== undefined
      ? search
      : typeof window !== 'undefined'
        ? window.location.search
        : '';
  if (!raw) return '';
  return (new URLSearchParams(raw).get('room') || '').trim();
}

export function buildRoomInviteUrl(roomCode: string): string {
  const clean = roomCode.trim();
  if (typeof window === 'undefined') return `?room=${encodeURIComponent(clean)}`;
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?room=${encodeURIComponent(clean)}`;
}

// 序列化房间共享核心战斗状态用于去重比对
export function serializeRoomCore(source: any): string {
  return JSON.stringify({
    round: Number(source.round) || 1,
    turnIndex: Number(source.turnIndex) || 0,
    initiativeList: Array.isArray(source.initiativeList) ? source.initiativeList : [],
    monsters: Array.isArray(source.monsters) ? source.monsters : [],
    pendingReaction: source.pendingReaction ?? null,
    gmBlind: Boolean(source.gmBlind),
  });
}

// 构造写入 rooms.state 的共享战斗快照
export function buildRoomStatePayload(state: any, clientId: string) {
  return {
    round: Number(state.round) || 1,
    turnIndex: Number(state.turnIndex) || 0,
    initiativeList: Array.isArray(state.initiativeList) ? state.initiativeList : [],
    monsters: Array.isArray(state.monsters) ? state.monsters : [],
    pendingReaction: state.pendingReaction || null,
    gmBlind: Boolean(state.gmBlind),
    updatedBy: clientId,
    updatedAt: Date.now(),
  };
}

// 构造写入 room_characters 的实时角色状态快照
export function buildCharacterSyncPayload(params: {
  roomCode: string;
  clientId: string;
  nickname: string;
  role: RoomRole;
  pl: any;
}): RoomCharacterRow {
  const { roomCode, clientId, nickname, role, pl } = params;
  const d = getPlDerivedView(pl);
  const spellsSummary = (pl.spells || [])
    .filter((s: any) => s.inMatrix !== false)
    .map((s: any) => ({
      nameCn: s.nameCn || s.nameEn || '法术',
      threads: Number(s.threads) || 0,
      wovenThreads: Number(s.wovenThreads) || 0,
    }));
  const gearSummary = [...(pl.gear || []), ...(pl.threadItems || [])]
    .filter((item: any) => item && item.equipped !== false)
    .map((item: any) => ({
      name: String(item.name || ''),
      effect: String(item.effect || ''),
    }));

  return {
    id: `${roomCode}::${clientId}`,
    room_code: roomCode,
    client_id: clientId,
    nickname: nickname.trim() || (role === 'gm' ? 'GM' : pl.name || '玩家'),
    role,
    char_name: String(pl.name || '未命名角色'),
    race_id: String(pl.raceId || 'human'),
    discipline_id: String(pl.disciplineId || 'warrior'),
    circle: Number(pl.circle) || 1,
    current_damage: Number(pl.currentDamage) || 0,
    blood_damage: Number(pl.bloodDamage) || 0,
    wounds: Number(pl.wounds) || 0,
    eff_uncon: d.effUncon,
    eff_death: d.effDeath,
    karma_current: Number(pl.karmaCurrent) || 0,
    karma_max: d.karmaMax,
    init_step: d.initStep,
    dex_val: d.attrs.DEX,
    pd: d.pd,
    md: d.md,
    pa: d.pa,
    ma: d.ma,
    statuses: { ...(pl.statuses || {}) },
    options: { ...(pl.options || {}) },
    spells_summary: spellsSummary,
    gear_summary: gearSummary,
    background: String(pl.background || ''),
    updated_at: new Date().toISOString(),
  };
}

// 构造写入 room_logs 的战报行（暗骰兜底脱敏，严禁写入点数明细）
export function buildLogInsertPayload(params: {
  roomCode: string;
  clientId: string;
  senderName: string;
  senderRole: RoomRole;
  log: any;
}) {
  const { roomCode, clientId, senderName, senderRole, log } = params;
  if (log.isBlindRoll) {
    return {
      id: String(log.id),
      room_code: roomCode,
      sender_id: clientId,
      sender_name: 'GM',
      sender_role: 'gm' as RoomRole,
      text: 'GM 进行了暗骰',
      detail: '',
      type: 'BLIND_ROLL',
      blind_text: '',
      time: String(log.time || ''),
    };
  }
  return {
    id: String(log.id),
    room_code: roomCode,
    sender_id: clientId,
    sender_name: senderName,
    sender_role: senderRole,
    text: String(log.text || ''),
    detail: String(log.detail || ''),
    type: String(log.type || ''),
    blind_text: String(log.blindText || ''),
    time: String(log.time || ''),
  };
}

// 发送端构造极简扁平暗骰广播消息（剥离所有点数、Step 与明细）
export function buildBlindRollPayload(log: { id: string }, sender = 'GM'): BlindRollBroadcastPayload {
  return {
    id: String(log.id),
    type: 'BLIND_ROLL',
    sender,
    timestamp: Date.now(),
  };
}

// 玩家端将 BLIND_ROLL 广播转为极简战报行
export function mapBlindRollToLog(payload: Partial<BlindRollBroadcastPayload> | null) {
  const ts = typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now();
  return {
    id: String(payload?.id || `blind_${ts}`),
    time: formatTime(new Date(ts)),
    text: 'GM 进行了暗骰',
    detail: '',
    type: 'BLIND_ROLL',
  };
}

// 统一映射远端 room_logs 记录并按角色与脱敏开关过滤
export function mapRemoteLogRow(row: any, role: RoomRole | null, gmBlind: boolean) {
  if (row?.type === 'BLIND_ROLL') {
    return {
      id: String(row.id),
      time: row.time || formatTime(),
      text: 'GM 进行了暗骰',
      detail: '',
      type: 'BLIND_ROLL',
    };
  }
  const masked = role === 'pl' && gmBlind && Boolean(row?.blind_text);
  return {
    id: String(row.id),
    time: row.time || formatTime(),
    text: masked
      ? row.blind_text
      : row.sender_name && !String(row.text || '').startsWith(row.sender_name)
        ? `[${row.sender_name}] ${row.text}`
        : row.text,
    detail: masked ? '（GM脱敏模式已隐藏具体抗性与阈值）' : row.detail || '',
    type: row.type || '',
  };
}

// 幂等合并 room_characters Postgres Changes 增量
export function mergeCharacterList(
  prev: RoomCharacterRow[],
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  newRow?: RoomCharacterRow | null,
  oldRow?: Partial<RoomCharacterRow> | null
): RoomCharacterRow[] {
  if (eventType === 'DELETE') {
    const delId = oldRow?.id;
    const delClient = oldRow?.client_id;
    return prev.filter((c) => c.id !== delId && (!delClient || c.client_id !== delClient));
  }
  if (!newRow) return prev;
  const idx = prev.findIndex((c) => c.id === newRow.id || c.client_id === newRow.client_id);
  if (idx >= 0) {
    return prev.map((c, i) => (i === idx ? newRow : c));
  }
  return [...prev, newRow];
}

export const CLOUD_ROOM_LOG_LIMIT = 30;

export type RoomRealtimeHandle = {
  unsubscribe: () => void;
  broadcastRoomState: (roomState: any) => void;
  broadcastLog: (row: any) => void;
  broadcastBlindRoll: (payload: BlindRollBroadcastPayload) => void;
  broadcastCharSync: (row: RoomCharacterRow) => void;
  broadcastCharLeave: (clientId: string) => void;
};

// 从 Presence 状态提取当前在线 clientId 集合
export function extractOnlineClientIds(presenceState: Record<string, unknown[]>): Set<string> {
  return new Set(
    Object.entries(presenceState)
      .filter(([, metas]) => Array.isArray(metas) && metas.length > 0)
      .map(([key]) => key)
  );
}

// 判断 Presence 状态中是否存在在线页面（可排除指定 clientId）
export function hasLivePresenceInState(
  presenceState: Record<string, unknown[]>,
  ignoreClientId?: string
): boolean {
  const ids = extractOnlineClientIds(presenceState);
  if (ignoreClientId) ids.delete(ignoreClientId);
  return ids.size > 0;
}

// 按当前在线 Presence 过滤成员列表，剔除已关闭页面的残留记录（始终保留自身）
export function filterCharactersByPresence(
  characters: RoomCharacterRow[],
  onlineClientIds: Set<string>,
  selfClientId: string
): RoomCharacterRow[] {
  return characters.filter((c) => c.client_id === selfClientId || onlineClientIds.has(c.client_id));
}

// 提取超出云端上限的旧战报 ID（入参按最新在前排序）
export function selectOverflowLogIds(
  rows: Array<{ id: string }>,
  limit = CLOUD_ROOM_LOG_LIMIT
): string[] {
  if (rows.length <= limit) return [];
  return rows.slice(limit).map((r) => String(r.id));
}

// 幂等合并新收到的日志列表（本地默认不截断，保留全部历史）
export function mergeIncomingLogs(prevLogs: any[], incoming: any[], maxLogs?: number) {
  const seen = new Set(prevLogs.map((l) => String(l.id)));
  const fresh = incoming.filter((l) => !seen.has(String(l.id)));
  if (fresh.length === 0) return prevLogs;
  const merged = [...fresh, ...prevLogs];
  return typeof maxLogs === 'number' ? merged.slice(0, maxLogs) : merged;
}

// 静默探测房间频道 Presence（不加入 track），判断当前是否仍有页面停留在房间内
export async function probeRoomHasLivePresence(
  roomCode: string,
  timeoutMs = 1500
): Promise<{ ok: boolean; hasActive: boolean }> {
  if (!supabase || !roomCode) return { ok: false, hasActive: false };

  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const probeChannel = supabase.channel(`ed4-room-${roomCode}`);

    const finish = (result: { ok: boolean; hasActive: boolean }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      supabase?.removeChannel(probeChannel);
      resolve(result);
    };

    timer = setTimeout(() => {
      finish({ ok: false, hasActive: false });
    }, timeoutMs) as unknown as number;

    probeChannel
      .on('presence', { event: 'sync' }, () => {
        const state = probeChannel.presenceState() as Record<string, unknown[]>;
        finish({ ok: true, hasActive: hasLivePresenceInState(state) });
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          finish({ ok: false, hasActive: false });
        }
      });
  });
}

export async function createRoomInSupabase(code: string, roomState: any) {
  if (!supabase) return { ok: false as const, error: '当前未配置 Supabase 环境变量（单机模式）' };
  const cleanCode = code.trim();
  if (!cleanCode) return { ok: false as const, error: '请输入有效的房间码' };

  try {
    const { data: existing, error: checkErr } = await supabase
      .from('rooms')
      .select('code')
      .eq('code', cleanCode)
      .maybeSingle();

    if (checkErr) return { ok: false as const, error: checkErr.message };

    if (existing) {
      const [{ data: chars, error: charsErr }, probe] = await Promise.all([
        supabase.from('room_characters').select('id').eq('room_code', cleanCode),
        probeRoomHasLivePresence(cleanCode),
      ]);
      if (charsErr) return { ok: false as const, error: charsErr.message };

      const hasLiveMembers = probe.ok ? probe.hasActive : (chars || []).length > 0;
      if (hasLiveMembers) {
        return { ok: false as const, error: `房间【${cleanCode}】已存在，请换个房间码或直接加入` };
      }

      // 房间无在线页面：清理残留成员记录并重置房间状态复用该房号
      if (chars && chars.length > 0) {
        await supabase.from('room_characters').delete().eq('room_code', cleanCode);
      }
      const { error: updErr } = await supabase
        .from('rooms')
        .update({ state: roomState, updated_at: new Date().toISOString() })
        .eq('code', cleanCode);
      if (updErr) return { ok: false as const, error: updErr.message };
      return { ok: true as const, code: cleanCode };
    }

    const { error: insErr } = await supabase.from('rooms').insert({
      code: cleanCode,
      state: roomState,
      updated_at: new Date().toISOString(),
    });

    if (insErr) return { ok: false as const, error: insErr.message };
    return { ok: true as const, code: cleanCode };
  } catch (err: any) {
    return { ok: false as const, error: err?.message || '创建房间失败，请检查网络连接' };
  }
}

export async function joinRoomInSupabase(code: string) {
  if (!supabase) return { ok: false as const, error: '当前未配置 Supabase 环境变量（单机模式）' };
  const cleanCode = code.trim();
  if (!cleanCode) return { ok: false as const, error: '请输入房间码' };

  try {
    const { data: room, error: roomErr } = await supabase
      .from('rooms')
      .select('code, state')
      .eq('code', cleanCode)
      .maybeSingle();

    if (roomErr) return { ok: false as const, error: roomErr.message };
    if (!room) return { ok: false as const, error: `未找到房间【${cleanCode}】，请确认房间码是否正确` };

    const [{ data: logsData }, { data: charsData }] = await Promise.all([
      supabase
        .from('room_logs')
        .select('*')
        .eq('room_code', cleanCode)
        .order('created_at', { ascending: false })
        .limit(CLOUD_ROOM_LOG_LIMIT),
      supabase
        .from('room_characters')
        .select('*')
        .eq('room_code', cleanCode),
    ]);

    return {
      ok: true as const,
      code: room.code,
      roomState: room.state || null,
      logs: logsData || [],
      characters: (charsData || []) as RoomCharacterRow[],
    };
  } catch (err: any) {
    return { ok: false as const, error: err?.message || '加入房间失败，请检查网络连接' };
  }
}

export async function pushRoomStateToSupabase(roomCode: string, roomState: any) {
  if (!supabase || !roomCode) return;
  try {
    await supabase
      .from('rooms')
      .update({ state: roomState, updated_at: new Date().toISOString() })
      .eq('code', roomCode);
  } catch {
    // 忽略网络抖动
  }
}

export async function pushCharacterToSupabase(payload: RoomCharacterRow) {
  if (!supabase || !payload.room_code) return;
  try {
    const { error } = await supabase.from('room_characters').upsert(payload, { onConflict: 'id' });
    if (error && error.message.includes('background')) {
      const { background: _omit, ...compatPayload } = payload;
      await supabase.from('room_characters').upsert(compatPayload, { onConflict: 'id' });
    }
  } catch {
    // 忽略网络抖动
  }
}

// 若房间已无成员记录则释放房间行
export async function deleteRoomIfEmpty(roomCode: string) {
  if (!supabase || !roomCode) return;
  try {
    const { data: remaining } = await supabase
      .from('room_characters')
      .select('id')
      .eq('room_code', roomCode);
    if ((remaining || []).length > 0) return;
    await supabase.from('rooms').delete().eq('code', roomCode);
  } catch {
    // 忽略网络或外键约束异常，建房时仍可按无在线页面回收房号
  }
}

export async function removeCharacterFromSupabase(roomCode: string, clientId: string) {
  if (!supabase || !roomCode || !clientId) return;
  try {
    await supabase.from('room_characters').delete().eq('id', `${roomCode}::${clientId}`);
    await deleteRoomIfEmpty(roomCode);
  } catch {
    // 忽略网络抖动
  }
}

// 页面关闭时发送 keepalive DELETE 清理自身成员记录
export function sendLeaveBeacon(roomCode: string, clientId: string) {
  if (!isSupabaseConfigured || !roomCode || !clientId || typeof fetch !== 'function') return;
  const rowId = encodeURIComponent(`${roomCode}::${clientId}`);
  try {
    void fetch(`${SUPABASE_URL}/rest/v1/room_characters?id=eq.${rowId}`, {
      method: 'DELETE',
      keepalive: true,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
  } catch {
    // 忽略页面卸载期异常
  }
}

// 清理房间超出云端上限（默认 30 条）的旧战报
export async function pruneCloudRoomLogs(roomCode: string, limit = CLOUD_ROOM_LOG_LIMIT) {
  if (!supabase || !roomCode) return;
  try {
    const { data } = await supabase
      .from('room_logs')
      .select('id')
      .eq('room_code', roomCode)
      .order('created_at', { ascending: false })
      .range(limit, limit + 199);
    const staleIds = (data || []).map((r: any) => String(r.id)).filter(Boolean);
    if (staleIds.length > 0) {
      await supabase.from('room_logs').delete().eq('room_code', roomCode).in('id', staleIds);
    }
  } catch {
    // 忽略裁剪网络异常
  }
}

export async function pushLogsToSupabase(rows: any[]) {
  if (!supabase || rows.length === 0) return;
  try {
    await supabase.from('room_logs').upsert(rows, { onConflict: 'id' });
    const roomCodes = Array.from(new Set(rows.map((r) => String(r.room_code || '')).filter(Boolean)));
    await Promise.all(roomCodes.map((code) => pruneCloudRoomLogs(code, CLOUD_ROOM_LOG_LIMIT)));
  } catch {
    // 忽略网络抖动
  }
}

export function subscribeRoomRealtime(
  roomCode: string,
  clientId: string,
  handlers: {
    onRoomState: (nextState: any) => void;
    onLogInsert: (row: any) => void;
    onBlindRoll?: (payload: BlindRollBroadcastPayload) => void;
    onCharacterChange: (
      eventType: 'INSERT' | 'UPDATE' | 'DELETE',
      newRow: RoomCharacterRow | null,
      oldRow: Partial<RoomCharacterRow> | null
    ) => void;
    onPresenceSync?: (onlineClientIds: Set<string>) => void;
    onSyncRequest?: (requesterId: string) => void;
    onSubscribed?: () => void;
  }
): RoomRealtimeHandle {
  const noopHandle: RoomRealtimeHandle = {
    unsubscribe: () => {},
    broadcastRoomState: () => {},
    broadcastLog: () => {},
    broadcastBlindRoll: () => {},
    broadcastCharSync: () => {},
    broadcastCharLeave: () => {},
  };
  if (!supabase || !roomCode) return noopHandle;

  let hasTracked = false;

  const channel: RealtimeChannel = supabase
    .channel(`ed4-room-${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: clientId },
      },
    })
    .on('broadcast', { event: 'ROOM_STATE' }, ({ payload }) => {
      if (payload) handlers.onRoomState(payload);
    })
    .on('broadcast', { event: 'ROOM_LOG' }, ({ payload }) => {
      if (payload) handlers.onLogInsert(payload);
    })
    .on('broadcast', { event: 'BLIND_ROLL' }, ({ payload }) => {
      if (payload && payload.type === 'BLIND_ROLL') {
        handlers.onBlindRoll?.(payload as BlindRollBroadcastPayload);
      }
    })
    .on('broadcast', { event: 'CHAR_SYNC' }, ({ payload }) => {
      if (payload && payload.client_id) {
        handlers.onCharacterChange('UPDATE', payload as RoomCharacterRow, null);
      }
    })
    .on('broadcast', { event: 'CHAR_LEAVE' }, ({ payload }) => {
      if (payload && (payload.id || payload.client_id)) {
        handlers.onCharacterChange('DELETE', null, payload as Partial<RoomCharacterRow>);
      }
    })
    .on('broadcast', { event: 'SYNC_REQ' }, ({ payload }) => {
      if (payload?.clientId && payload.clientId !== clientId) {
        handlers.onSyncRequest?.(String(payload.clientId));
      }
    })
    .on('presence', { event: 'sync' }, () => {
      if (!hasTracked) return;
      handlers.onPresenceSync?.(extractOnlineClientIds(channel.presenceState() as Record<string, unknown[]>));
    })
    .on('presence', { event: 'join' }, ({ key }) => {
      if (key && key !== clientId) {
        handlers.onSyncRequest?.(String(key));
      }
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (!key || key === clientId) return;
      const present = channel.presenceState()[key];
      if (!present || present.length === 0) {
        handlers.onCharacterChange('DELETE', null, {
          id: `${roomCode}::${key}`,
          client_id: String(key),
        });
      }
    })
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` },
      (payload) => {
        if (payload.new && (payload.new as any).state) {
          handlers.onRoomState((payload.new as any).state);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'room_logs', filter: `room_code=eq.${roomCode}` },
      (payload) => {
        if (payload.new) handlers.onLogInsert(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_characters', filter: `room_code=eq.${roomCode}` },
      (payload) => {
        handlers.onCharacterChange(
          payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          (payload.new as RoomCharacterRow) || null,
          (payload.old as Partial<RoomCharacterRow>) || null
        );
      }
    )
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.track({ clientId, joinedAt: Date.now() });
          hasTracked = true;
          handlers.onPresenceSync?.(extractOnlineClientIds(channel.presenceState() as Record<string, unknown[]>));
          channel.send({ type: 'broadcast', event: 'SYNC_REQ', payload: { clientId } });
        } catch {
          // 忽略实时频道追踪异常
        }
        handlers.onSubscribed?.();
      }
    });

  const safeSend = (event: string, payload: any) => {
    try {
      void channel.send({ type: 'broadcast', event, payload });
    } catch {
      // 忽略广播发送异常
    }
  };

  return {
    unsubscribe: () => {
      try {
        void channel.untrack();
      } catch {
        // 忽略取消追踪异常
      }
      supabase?.removeChannel(channel);
    },
    broadcastRoomState: (roomState: any) => safeSend('ROOM_STATE', roomState),
    broadcastLog: (row: any) => safeSend('ROOM_LOG', row),
    broadcastBlindRoll: (payload: BlindRollBroadcastPayload) => safeSend('BLIND_ROLL', payload),
    broadcastCharSync: (row: RoomCharacterRow) => safeSend('CHAR_SYNC', row),
    broadcastCharLeave: (leaveClientId: string) =>
      safeSend('CHAR_LEAVE', { id: `${roomCode}::${leaveClientId}`, client_id: leaveClientId }),
  };
}
