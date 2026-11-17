import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { getPlDerivedView } from './combatHelpers';

export type RoomRole = 'gm' | 'pl';

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
    updated_at: new Date().toISOString(),
  };
}

// 构造写入 room_logs 的战报行
export function buildLogInsertPayload(params: {
  roomCode: string;
  clientId: string;
  senderName: string;
  senderRole: RoomRole;
  log: any;
}) {
  const { roomCode, clientId, senderName, senderRole, log } = params;
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

// 幂等合并新收到的日志列表
export function mergeIncomingLogs(prevLogs: any[], incoming: any[], maxLogs = 80) {
  const seen = new Set(prevLogs.map((l) => String(l.id)));
  const fresh = incoming.filter((l) => !seen.has(String(l.id)));
  if (fresh.length === 0) return prevLogs;
  return [...fresh, ...prevLogs].slice(0, maxLogs);
}

export async function createRoomInSupabase(code: string, roomState: any) {
  if (!supabase) return { ok: false as const, error: '当前未配置 Supabase 环境变量（单机模式）' };
  const cleanCode = code.trim();
  if (!cleanCode) return { ok: false as const, error: '请输入有效的房间码' };

  const { data: existing, error: checkErr } = await supabase
    .from('rooms')
    .select('code')
    .eq('code', cleanCode)
    .maybeSingle();

  if (checkErr) return { ok: false as const, error: checkErr.message };
  if (existing) return { ok: false as const, error: `房间【${cleanCode}】已存在，请换个房间码或直接加入` };

  const { error: insErr } = await supabase.from('rooms').insert({
    code: cleanCode,
    state: roomState,
    updated_at: new Date().toISOString(),
  });

  if (insErr) return { ok: false as const, error: insErr.message };
  return { ok: true as const, code: cleanCode };
}

export async function joinRoomInSupabase(code: string) {
  if (!supabase) return { ok: false as const, error: '当前未配置 Supabase 环境变量（单机模式）' };
  const cleanCode = code.trim();
  if (!cleanCode) return { ok: false as const, error: '请输入房间码' };

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
      .limit(50),
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
}

export async function pushRoomStateToSupabase(roomCode: string, roomState: any) {
  if (!supabase || !roomCode) return;
  await supabase
    .from('rooms')
    .update({ state: roomState, updated_at: new Date().toISOString() })
    .eq('code', roomCode);
}

export async function pushCharacterToSupabase(payload: RoomCharacterRow) {
  if (!supabase || !payload.room_code) return;
  await supabase.from('room_characters').upsert(payload, { onConflict: 'id' });
}

export async function removeCharacterFromSupabase(roomCode: string, clientId: string) {
  if (!supabase || !roomCode || !clientId) return;
  await supabase.from('room_characters').delete().eq('id', `${roomCode}::${clientId}`);
}

export async function pushLogsToSupabase(rows: any[]) {
  if (!supabase || rows.length === 0) return;
  await supabase.from('room_logs').upsert(rows, { onConflict: 'id' });
}

export function subscribeRoomRealtime(
  roomCode: string,
  handlers: {
    onRoomState: (nextState: any) => void;
    onLogInsert: (row: any) => void;
    onCharacterChange: (
      eventType: 'INSERT' | 'UPDATE' | 'DELETE',
      newRow: RoomCharacterRow | null,
      oldRow: Partial<RoomCharacterRow> | null
    ) => void;
  }
): () => void {
  if (!supabase || !roomCode) return () => {};

  const channel: RealtimeChannel = supabase
    .channel(`ed4-room-${roomCode}`)
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
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}

export const SUPABASE_SETUP_SQL = `create table if not exists public.rooms (
  code text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.room_logs (
  id text primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  sender_id text not null default '',
  sender_name text not null default '',
  sender_role text not null default 'pl',
  text text not null default '',
  detail text not null default '',
  type text not null default '',
  blind_text text not null default '',
  time text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.room_characters (
  id text primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  client_id text not null,
  nickname text not null default '',
  role text not null default 'pl',
  char_name text not null default '',
  race_id text not null default 'human',
  discipline_id text not null default 'warrior',
  circle integer not null default 1,
  current_damage integer not null default 0,
  blood_damage integer not null default 0,
  wounds integer not null default 0,
  eff_uncon integer not null default 30,
  eff_death integer not null default 40,
  karma_current integer not null default 0,
  karma_max integer not null default 0,
  init_step integer not null default 5,
  dex_val integer not null default 10,
  pd integer not null default 8,
  md integer not null default 8,
  pa integer not null default 0,
  ma integer not null default 0,
  statuses jsonb not null default '{}'::jsonb,
  options jsonb not null default '{}'::jsonb,
  spells_summary jsonb not null default '[]'::jsonb,
  gear_summary jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter publication supabase_realtime add table public.rooms, public.room_logs, public.room_characters;

alter table public.rooms enable row level security;
alter table public.room_logs enable row level security;
alter table public.room_characters enable row level security;

create policy "rooms_anon_all" on public.rooms for all using (true) with check (true);
create policy "room_logs_anon_all" on public.room_logs for all using (true) with check (true);
create policy "room_characters_anon_all" on public.room_characters for all using (true) with check (true);`;
