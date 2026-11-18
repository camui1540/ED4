import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Moon, Sun, Wifi, WifiOff } from 'lucide-react';
import ED4Engine from './engine/ed4_engine.js';
import {
  applyDamageToMonsterPure,
  applyDamageToPlPure,
  applyImportedCharacter,
  createInitialState,
  createMonsterInstance,
  formatTime,
  getEffectiveActionMod,
  getMonsterEffectiveDef,
  getPlDerivedView,
  sortInitiativeList,
} from './engine/combatHelpers';
import { PlSheetView } from './components/PlSheetView';
import { GmMonsterView } from './components/GmMonsterView';
import { StepTableView } from './components/StepTableView';
import { RightSidebar } from './components/RightSidebar';
import { ExportModal, ManualModal, RoomModal, SpellJsonModal } from './components/Modals';
import { SpellEffectModal, type SpellBuffTargetChoice } from './components/SpellEffectModal';
import {
  buildActiveBuffEntry,
  computeSpellDurationPlan,
  computeSpellEffectPlan,
  enrichSpellWithDb,
  getExtraThreadRuleInfo,
  getWeaponBuffEffects,
  hydrateSpellsWithDb,
  isRangedWeaponName,
  resolveCastingDn,
  resolveWeavingRollOutcome,
  type ActiveBuff,
} from './engine/spellRules';
import { PrintSheetView, type PdfPrintMode } from './components/PrintSheetView';
import {
  downloadExcelBuffer,
  downloadTextFile,
  exportCharacterExcelBuffer,
  extractPortraitFromXlsxBuffer,
  getExportBaseName,
  serializeCharacterToTxt,
} from './engine/characterExport';
import {
  buildCharacterSyncPayload,
  buildLogInsertPayload,
  buildRoomInviteUrl,
  buildRoomStatePayload,
  createRoomInSupabase,
  extractRoomCodeFromUrl,
  getSessionClientId,
  isSupabaseConfigured,
  joinRoomInSupabase,
  mergeCharacterList,
  mergeIncomingLogs,
  pushCharacterToSupabase,
  pushLogsToSupabase,
  pushRoomStateToSupabase,
  removeCharacterFromSupabase,
  subscribeRoomRealtime,
  type RoomCharacterRow,
  type RoomRole,
  type RoomSession,
} from './engine/supabaseSync';

export default function App() {
  const [state, setState] = useState(() => {
    const init = createInitialState();
    try {
      const raw = localStorage.getItem('ed4_pl_sheet');
      if (raw) {
        const savedPl = JSON.parse(raw);
        if (savedPl && typeof savedPl === 'object') {
          return {
            ...init,
            pl: {
              ...init.pl,
              ...savedPl,
              armor: { ...init.pl.armor, ...(savedPl.armor || {}) },
              shield: { ...init.pl.shield, ...(savedPl.shield || {}) },
              options: { ...init.pl.options, ...(savedPl.options || {}) },
              statuses: { ...init.pl.statuses, ...(savedPl.statuses || {}) },
              legend: { ...init.pl.legend, ...(savedPl.legend || {}) },
              wealth: { ...init.pl.wealth, ...(savedPl.wealth || {}) },
              spells: hydrateSpellsWithDb(savedPl.spells || []),
              activeBuffs: Array.isArray(savedPl.activeBuffs) ? savedPl.activeBuffs : [],
              background: savedPl.background ?? '',
            },
          };
        }
      }
    } catch {
      // 忽略本地存储读取异常
    }
    return init;
  });
  const [spellJsonOpen, setSpellJsonOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [spellEffectModal, setSpellEffectModal] = useState<{ instanceId: string; initialKarma: boolean } | null>(null);
  const [pdfMode, setPdfMode] = useState<PdfPrintMode>('bw');
  const [initialUrlRoom] = useState(() => extractRoomCodeFromUrl());
  const [roomModalOpen, setRoomModalOpen] = useState(() => Boolean(extractRoomCodeFromUrl()));
  const [roomSession, setRoomSession] = useState<RoomSession>(() => ({
    connected: false,
    roomCode: '',
    role: null,
    nickname: '',
    clientId: getSessionClientId(),
  }));
  const [roomCharacters, setRoomCharacters] = useState<RoomCharacterRow[]>([]);
  const knownLogIdsRef = useRef<Set<string>>(new Set());
  const isApplyingRemoteStateRef = useRef(false);
  const lastSyncedRoomJsonRef = useRef('');
  const importedXlsxBufferRef = useRef<ArrayBuffer | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('ed4_sidebar_width'));
    return saved >= 280 && saved <= 720 ? saved : 360;
  });
  const [draggingResizer, setDraggingResizer] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem('ed4_theme', isDark ? 'dark' : 'light');
    } catch {
      // 忽略本地存储受限场景
    }
  }, [isDark]);

  useEffect(() => {
    document.documentElement.dataset.printMode = pdfMode;
  }, [pdfMode]);

  useEffect(() => {
    if (exportModalOpen) void prewarmPrintFonts(false);
  }, [exportModalOpen]);

  useEffect(() => {
    try {
      localStorage.setItem('ed4_pl_sheet', JSON.stringify(state.pl));
    } catch {
      // 忽略本地存储受限场景
    }
  }, [state.pl]);

  // 订阅 Supabase Realtime Postgres Changes（rooms / room_logs / room_characters）
  useEffect(() => {
    if (!roomSession.connected || !roomSession.roomCode) return;

    const unsubscribe = subscribeRoomRealtime(roomSession.roomCode, {
      onRoomState: (nextState) => {
        if (!nextState || nextState.updatedBy === roomSession.clientId) return;
        const incomingCore = JSON.stringify({
          round: nextState.round,
          turnIndex: nextState.turnIndex,
          initiativeList: nextState.initiativeList,
          monsters: nextState.monsters,
          pendingReaction: nextState.pendingReaction,
          gmBlind: nextState.gmBlind,
        });
        if (incomingCore === lastSyncedRoomJsonRef.current) return;
        lastSyncedRoomJsonRef.current = incomingCore;
        isApplyingRemoteStateRef.current = true;
        setState((prev) => {
          const nextRound = Number(nextState.round) || 1;
          const resetRoundOpts = nextRound > prev.round;
          return {
            ...prev,
            round: nextRound,
            turnIndex: Number(nextState.turnIndex) || 0,
            initiativeList: Array.isArray(nextState.initiativeList) ? nextState.initiativeList : prev.initiativeList,
            monsters: Array.isArray(nextState.monsters) ? nextState.monsters : prev.monsters,
            pendingReaction: nextState.pendingReaction ?? null,
            gmBlind: Boolean(nextState.gmBlind),
            pl: resetRoundOpts
              ? {
                  ...prev.pl,
                  options: { aggressive: false, defensive: false, knockdown: false, stun: false, splitMove: false, tailAttack: false },
                  statuses: { ...prev.pl.statuses, surprised: false, reserved: false },
                }
              : prev.pl,
          };
        });
      },
      onLogInsert: (row) => {
        if (!row || row.sender_id === roomSession.clientId) return;
        const logId = String(row.id);
        if (knownLogIdsRef.current.has(logId)) return;
        knownLogIdsRef.current.add(logId);
        const mapped = {
          id: logId,
          time: row.time || formatTime(),
          text:
            roomSession.role === 'pl' && state.gmBlind && row.blind_text
              ? row.blind_text
              : row.sender_name && !String(row.text || '').startsWith(row.sender_name)
                ? `[${row.sender_name}] ${row.text}`
                : row.text,
          detail:
            roomSession.role === 'pl' && state.gmBlind && row.blind_text
              ? '（GM脱敏模式已隐藏具体抗性与阈值）'
              : row.detail || '',
          type: row.type || '',
        };
        setState((prev) => ({
          ...prev,
          logs: mergeIncomingLogs(prev.logs, [mapped]),
        }));
      },
      onCharacterChange: (eventType, newRow, oldRow) => {
        setRoomCharacters((prev) => mergeCharacterList(prev, eventType, newRow, oldRow));
      },
    });

    return () => {
      unsubscribe();
    };
  }, [roomSession.connected, roomSession.roomCode, roomSession.clientId, roomSession.role, state.gmBlind]);

  // 本地新增战报实时推送到 room_logs
  useEffect(() => {
    if (!roomSession.connected || !roomSession.roomCode || !roomSession.role) return;
    const unsent = state.logs.filter((l) => !knownLogIdsRef.current.has(String(l.id)));
    if (unsent.length === 0) return;
    unsent.forEach((l) => knownLogIdsRef.current.add(String(l.id)));
    const senderName =
      roomSession.nickname.trim() || (roomSession.role === 'gm' ? 'GM' : state.pl.name || '玩家');
    const rows = unsent.map((log) =>
      buildLogInsertPayload({
        roomCode: roomSession.roomCode,
        clientId: roomSession.clientId,
        senderName,
        senderRole: roomSession.role!,
        log,
      })
    );
    pushLogsToSupabase(rows);
  }, [
    state.logs,
    roomSession.connected,
    roomSession.roomCode,
    roomSession.role,
    roomSession.nickname,
    roomSession.clientId,
    state.pl.name,
  ]);

  // PL 角色卡伤害/负伤/脉路/装备状态防抖同步至 room_characters
  useEffect(() => {
    if (!roomSession.connected || !roomSession.roomCode || !roomSession.role) return;
    const timer = window.setTimeout(() => {
      const payload = buildCharacterSyncPayload({
        roomCode: roomSession.roomCode,
        clientId: roomSession.clientId,
        nickname: roomSession.nickname,
        role: roomSession.role!,
        pl: state.pl,
      });
      pushCharacterToSupabase(payload);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    state.pl,
    roomSession.connected,
    roomSession.roomCode,
    roomSession.role,
    roomSession.nickname,
    roomSession.clientId,
  ]);

  // 共享房间战斗状态（回合、先攻、怪物、反应、脱敏）同步至 rooms.state
  useEffect(() => {
    if (!roomSession.connected || !roomSession.roomCode) return;
    const coreJson = JSON.stringify({
      round: state.round,
      turnIndex: state.turnIndex,
      initiativeList: state.initiativeList,
      monsters: state.monsters,
      pendingReaction: state.pendingReaction,
      gmBlind: state.gmBlind,
    });
    if (isApplyingRemoteStateRef.current) {
      isApplyingRemoteStateRef.current = false;
      lastSyncedRoomJsonRef.current = coreJson;
      return;
    }
    if (coreJson === lastSyncedRoomJsonRef.current) return;
    lastSyncedRoomJsonRef.current = coreJson;
    const timer = window.setTimeout(() => {
      pushRoomStateToSupabase(roomSession.roomCode, buildRoomStatePayload(state, roomSession.clientId));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [
    state.round,
    state.turnIndex,
    state.initiativeList,
    state.monsters,
    state.pendingReaction,
    state.gmBlind,
    roomSession.connected,
    roomSession.roomCode,
    roomSession.clientId,
  ]);

  // 桌面端拖拽分栏逻辑
  useEffect(() => {
    if (!draggingResizer) return;
    const onMove = (clientX: number) => {
      const next = Math.max(280, Math.min(720, window.innerWidth - clientX));
      setSidebarWidth(next);
    };
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) onMove(e.touches[0].clientX);
    };
    const stop = () => {
      setDraggingResizer(false);
      localStorage.setItem('ed4_sidebar_width', String(sidebarWidth));
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', stop);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stop);
    };
  }, [draggingResizer, sidebarWidth]);

  // 统一日志追加函数
  const makeLog = (text: string, detail = '', type = '', blindText = '', gmBlind = state.gmBlind) => ({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    time: formatTime(),
    text: gmBlind && blindText ? blindText : text,
    detail: gmBlind && blindText ? '（GM脱敏模式已隐藏具体抗性与阈值）' : detail,
    type,
  });

  const pushLog = (text: string, detail = '', type = '', blindText = '') => {
    setState((prev) => ({
      ...prev,
      logs: [makeLog(text, detail, type, blindText, prev.gmBlind), ...prev.logs].slice(0, 60),
    }));
  };

  const updatePl = (updater: (prevPl: any) => any) => {
    setState((prev) => ({ ...prev, pl: updater(prev.pl) }));
  };

  // 切换门类
  const handleChangeDiscipline = (disciplineId: string) => {
    if (!ED4Engine.DISCIPLINES[disciplineId]) return;
    setState((prev) => {
      const nextPl = { ...prev.pl, disciplineId };
      const d = getPlDerivedView(nextPl);
      nextPl.karmaCurrent = Math.min(nextPl.karmaCurrent, d.karmaMax);
      nextPl.recoveryCurrent = Math.min(nextPl.recoveryCurrent, d.recoveryMax);
      const log = makeLog(
        `切换门类为【${d.prog.disc.name}】，耐久加值 +${d.durabilityTotal}`,
        `意识丧失 ${d.effUncon} / 死亡 ${d.effDeath} · 业力上限 ${d.karmaMax}`,
        '',
        '',
        prev.gmBlind
      );
      return { ...prev, pl: nextPl, logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  // 调整环数
  const handleChangeCircle = (val: number) => {
    const c = Math.max(1, Math.min(15, Math.floor(val || 1)));
    setState((prev) => {
      const nextPl = { ...prev.pl, circle: c, karmaDie: c >= 9 ? 8 : prev.pl.karmaDie };
      const d = getPlDerivedView(nextPl);
      nextPl.karmaCurrent = d.karmaMax;
      nextPl.recoveryCurrent = d.recoveryMax;
      const log = makeLog(
        `调整环数为第 ${c} 环（${d.prog.disc.name}），耐久 +${d.durabilityTotal}`,
        `意识丧失 ${d.effUncon} / 死亡 ${d.effDeath} · 业力上限 ${d.karmaMax} (D${nextPl.karmaDie})`,
        '',
        '',
        prev.gmBlind
      );
      return { ...prev, pl: nextPl, logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  // 切换种族
  const handleChangeRace = (raceId: string) => {
    setState((prev) => {
      const nextPl = {
        ...prev.pl,
        raceId,
        options: raceId === 'tskrang' ? prev.pl.options : { ...prev.pl.options, tailAttack: false },
      };
      const d = getPlDerivedView(nextPl);
      nextPl.karmaCurrent = d.karmaMax;
      nextPl.recoveryCurrent = d.recoveryMax;
      return { ...prev, pl: nextPl };
    });
  };

  // 属性加减点
  const handleAdjustAttr = (attr: string, delta: number) => {
    setState((prev) => {
      const cur = prev.pl.attrMods[attr];
      const next = cur + delta;
      if (next < -2 || next > 8) return prev;
      const d = getPlDerivedView(prev.pl);
      const costDiff = ED4Engine.ATTR_COST[next] - ED4Engine.ATTR_COST[cur];
      if (d.remainingPoints - costDiff < 0) return prev;
      const nextPl = { ...prev.pl, attrMods: { ...prev.pl.attrMods, [attr]: next } };
      const updated = getPlDerivedView(nextPl);
      nextPl.karmaCurrent = Math.min(nextPl.karmaCurrent, updated.karmaMax);
      nextPl.recoveryCurrent = Math.min(nextPl.recoveryCurrent, updated.recoveryMax);
      return { ...prev, pl: nextPl };
    });
  };

  // 属性掷骰
  const handleRollAttr = (attr: string) => {
    const d = getPlDerivedView(state.pl);
    const step = Math.max(1, d.steps[attr] + getEffectiveActionMod(state.pl));
    const res = ED4Engine.rollStepTest(step, { isAction: true, karmaDie: state.pl.karmaDie });
    pushLog(
      `${state.pl.name} 进行 ${ED4Engine.ATTR_NAMES[attr]}检定 (Step ${step}) → ${res.total}${res.isRuleOfOne ? ' [全一规则大失败]' : ''}`,
      res.trace,
      res.isRuleOfOne ? 'fail' : ''
    );
  };

  // 玩家投先攻
  const handleRollPlInitiative = () => {
    setState((prev) => {
      const d = getPlDerivedView(prev.pl);
      const step = Math.max(1, d.initStep + getEffectiveActionMod(prev.pl));
      const res = ED4Engine.rollStepTest(step, { isAction: false, karmaDie: prev.pl.karmaDie });
      const entryId = roomSession.connected ? `pl_${roomSession.clientId}` : 'pl';
      const entry = {
        id: entryId,
        clientId: roomSession.clientId,
        type: 'pl',
        name: prev.pl.name,
        initVal: res.total,
        initStep: step,
        dexVal: d.attrs.DEX,
      };
      const idx = prev.initiativeList.findIndex((x) =>
        roomSession.connected ? x.clientId === roomSession.clientId || x.id === entryId : x.type === 'pl'
      );
      const nextInit = idx >= 0 ? prev.initiativeList.map((x, i) => (i === idx ? entry : x)) : [...prev.initiativeList, entry];
      const log = makeLog(`${prev.pl.name} 投掷先攻 (Step ${step}) → ${res.total}`, res.trace, 'warn', '', prev.gmBlind);
      return { ...prev, initiativeList: sortInitiativeList(nextInit), logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  // 常用检定
  const handleRollQuickCheck = (type: string) => {
    if (type === 'init') {
      handleRollPlInitiative();
      return;
    }
    setState((prev) => {
      const pl = { ...prev.pl, statuses: { ...prev.pl.statuses } };
      const d = getPlDerivedView(pl);

      if (type === 'recovery') {
        if (pl.recoveryCurrent <= 0) {
          return { ...prev, logs: [makeLog(`${pl.name} 今日回复次数已耗尽`, '', 'fail', '', prev.gmBlind), ...prev.logs].slice(0, 60) };
        }
        pl.recoveryCurrent -= 1;
        const step = Math.max(1, d.steps.TOU - pl.wounds);
        const res = ED4Engine.rollStepTest(step, { isAction: false, karmaDie: pl.karmaDie });
        const healed = Math.max(1, res.total);
        pl.currentDamage = Math.max(0, pl.currentDamage - healed);
        const log = makeLog(`${pl.name} 回复检定 (Step ${step}) → 恢复 ${healed} 点 (剩余 ${pl.recoveryCurrent})`, res.trace, 'hit', '', prev.gmBlind);
        return { ...prev, pl, logs: [log, ...prev.logs].slice(0, 60) };
      }

      if (type === 'knockdown') {
        const wb = pl.talents.find((t: any) => t.name.includes('负伤平衡') || t.name.toLowerCase().includes('wound balance'));
        const step = Math.max(1, d.steps.STR + (wb ? wb.rank : 0) + getEffectiveActionMod(pl));
        const res = ED4Engine.rollStepTest(step, { isAction: true, karmaDie: pl.karmaDie });
        const log = makeLog(`${pl.name} 击倒检定${wb ? `（负伤平衡 ${wb.rank} 级）` : ''} (Step ${step}) → ${res.total}`, res.trace, '', '', prev.gmBlind);
        return { ...prev, logs: [log, ...prev.logs].slice(0, 60) };
      }

      if (type === 'jumpup') {
        if (!pl.statuses.knockedDown) return prev;
        pl.currentDamage += 2;
        const step = Math.max(1, d.steps.DEX - ((Number(pl.armor.initPen) || 0) + (Number(pl.shield.initPen) || 0)) - pl.wounds);
        const res = ED4Engine.rollStepTest(step, { dn: 6, isAction: true, karmaDie: pl.karmaDie });
        if (res.isSuccess) pl.statuses.knockedDown = false;
        const log = makeLog(
          `${pl.name} 跃起（2 负荷，难度 6）→ ${res.isSuccess ? '成功起身' : '起身失败'} (${res.total})`,
          res.trace,
          res.isSuccess ? 'hit' : 'fail',
          '',
          prev.gmBlind
        );
        return { ...prev, pl, logs: [log, ...prev.logs].slice(0, 60) };
      }

      const map: Record<string, { label: string; step: number }> = {
        awareness: { label: '察觉/防埋伏检定', step: d.steps.PER },
        astral: { label: '星界感知检定', step: d.steps.PER },
        willpower: { label: '意志抵抗检定', step: d.steps.WIL },
      };
      const item = map[type];
      const step = Math.max(1, item.step + getEffectiveActionMod(pl));
      const res = ED4Engine.rollStepTest(step, { isAction: true, karmaDie: pl.karmaDie });
      const log = makeLog(`${pl.name} ${item.label} (Step ${step}) → ${res.total}`, res.trace, '', '', prev.gmBlind);
      return { ...prev, logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  // 业力仪式 & 休整消伤
  const handleKarmaRitual = () => {
    setState((prev) => {
      const d = getPlDerivedView(prev.pl);
      const log = makeLog(`${prev.pl.name} 完成业力仪式，业力恢复至 ${d.karmaMax}`, '', 'hit', '', prev.gmBlind);
      return { ...prev, pl: { ...prev.pl, karmaCurrent: d.karmaMax }, logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  const handleHealWoundRest = () => {
    setState((prev) => {
      const pl = prev.pl;
      if (pl.currentDamage > 0 || pl.wounds <= 0 || pl.recoveryCurrent <= 0) return prev;
      const nextPl = { ...pl, recoveryCurrent: pl.recoveryCurrent - 1, wounds: pl.wounds - 1 };
      const log = makeLog(`${pl.name} 整夜休整消除 1 处负伤（剩余 ${nextPl.wounds}）`, '', 'hit', '', prev.gmBlind);
      return { ...prev, pl: nextPl, logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  // 切换战斗选项与状态
  const handleToggleOption = (key: string) => {
    setState((prev) => {
      const opts: Record<string, boolean> = { ...prev.pl.options };
      if (key === 'aggressive' && !opts.aggressive) opts.defensive = false;
      if (key === 'defensive' && !opts.defensive) opts.aggressive = false;
      opts[key] = !opts[key];
      const extraStrain = key === 'splitMove' && opts.splitMove ? 1 : 0;
      return {
        ...prev,
        pl: { ...prev.pl, options: opts as typeof prev.pl.options, currentDamage: prev.pl.currentDamage + extraStrain },
      };
    });
  };

  const handleToggleStatus = (key: string) => {
    updatePl((p) => ({ ...p, statuses: { ...p.statuses, [key]: !p.statuses[key] } }));
  };

  // 天赋与技能检定
  const handleRollTalentOrSkill = (listType: 'talent' | 'skill', itemId: string, wantKarma: boolean) => {
    setState((prev) => {
      const pl = { ...prev.pl };
      const list = listType === 'skill' ? pl.skills : pl.talents;
      const t = list.find((x: any) => x.id === itemId);
      if (!t) return prev;
      if (pl.statuses.surprised) {
        return { ...prev, logs: [makeLog(`${pl.name} 处于惊愕状态，本轮无法执行检定`, '', 'fail', '', prev.gmBlind), ...prev.logs].slice(0, 60) };
      }

      const d = getPlDerivedView(pl);
      const useKarma = listType === 'talent' && wantKarma && pl.karmaCurrent > 0;
      if (useKarma) pl.karmaCurrent -= 1;

      let strainCost = Number(t.strain) || 0;
      if (t.isAttack && pl.options.aggressive) strainCost += 1;
      if (strainCost > 0) pl.currentDamage += strainCost;

      let step = d.steps[t.attr] + t.rank + getEffectiveActionMod(pl);
      if (t.isAttack && pl.options.aggressive) step += 3;
      if (t.isAttack && d.buffBonuses) {
        const isRangedAtk = isRangedWeaponName(t.name) || /投掷|射击|远程|箭/.test(String(t.name || ''));
        step += (d.buffBonuses.allAtk || 0) + (isRangedAtk ? d.buffBonuses.rangedAtk || 0 : d.buffBonuses.meleeAtk || 0);
      }
      step = Math.max(1, step);

      let targetMonster: any = null;
      let dn: number | null = null;
      if (prev.targetValue.startsWith('m:')) {
        targetMonster = prev.monsters.find((m) => m.instanceId === prev.targetValue.slice(2));
        if (targetMonster) dn = getMonsterEffectiveDef(targetMonster, 'pd');
      } else if (prev.targetValue.startsWith('dn:')) {
        dn = Number(prev.targetValue.slice(3));
      }

      const res = ED4Engine.rollStepTest(step, { karma: useKarma, karmaDie: pl.karmaDie, dn, isAction: true });
      const strainText = strainCost > 0 ? ` [负荷 +${strainCost}]` : '';
      const tag = listType === 'skill' ? '技能' : '天赋';

      if (dn === null) {
        const log = makeLog(
          `${pl.name} 使用${tag}【${t.name}】 (Step ${step})${strainText} → ${res.total}${res.isRuleOfOne ? ' [全一规则大失败]' : ''}`,
          res.trace,
          res.isRuleOfOne ? 'fail' : '',
          '',
          prev.gmBlind
        );
        return { ...prev, pl, logs: [log, ...prev.logs].slice(0, 60) };
      }

      if (!res.isSuccess) {
        const log = makeLog(
          `${pl.name} 使用${tag}【${t.name}】攻击 ${targetMonster ? targetMonster.name : '目标'} → 未命中 (${res.total} vs ${dn})${strainText}`,
          res.trace,
          'fail',
          `${pl.name} 使用${tag}【${t.name}】攻击目标 → 未命中 (${res.total})${strainText}`,
          prev.gmBlind
        );
        return { ...prev, pl, logs: [log, ...prev.logs].slice(0, 60) };
      }

      const weapon = pl.weapons[0] || { name: '徒手', dmgStep: 0 };
      const dmgStep = d.steps.STR + (Number(weapon.dmgStep) || 0) + (pl.options.aggressive ? 3 : 0);
      const nextPending = targetMonster
        ? {
            attackerId: 'pl',
            attackerType: 'pl',
            attackerName: pl.name,
            targetId: targetMonster.instanceId,
            targetType: 'gm',
            targetName: targetMonster.name,
            attackName: `${t.name}（${weapon.name}）`,
            atkTotal: res.total,
            targetDef: dn,
            extraSuccesses: res.extraSuccesses,
            dmgStep,
            isMelee: true,
            isKnockdownOpt: pl.options.knockdown,
            isStunOpt: pl.options.stun,
            armorType: 'pa',
          }
        : prev.pendingReaction;

      const log = makeLog(
        `${pl.name} 使用${tag}【${t.name}】命中 ${targetMonster ? targetMonster.name : '目标'} (${res.total} vs ${dn}，额外成功 +${res.extraSuccesses})${strainText}`,
        res.trace,
        'hit',
        `${pl.name} 使用${tag}【${t.name}】命中目标（额外成功 +${res.extraSuccesses}）${strainText}`,
        prev.gmBlind
      );
      return {
        ...prev,
        pl,
        lastExtraDamageBonus: res.extraSuccesses * 2,
        pendingReaction: nextPending,
        logs: [log, ...prev.logs].slice(0, 60),
      };
    });
  };

  // 武器伤害检定
  const handleRollWeaponDamage = (weaponId: string) => {
    setState((prev) => {
      const w = prev.pl.weapons.find((x: any) => x.id === weaponId);
      if (!w) return prev;
      const d = getPlDerivedView(prev.pl);
      const fx = getWeaponBuffEffects(prev.pl.activeBuffs || [], w.id, w.name);
      const dmgStep = Math.max(1, d.steps.STR + (Number(w.dmgStep) || 0) + (prev.pl.options.aggressive ? 3 : 0) + fx.dmgStepBonus);
      const res = ED4Engine.rollStepTest(dmgStep, { isAction: false, karmaDie: prev.pl.karmaDie });
      const bonus = prev.lastExtraDamageBonus || 0;

      const extraRollParts: string[] = [];
      let extraDiceSum = 0;
      for (const die of fx.extraDice) {
        const dieRes = ED4Engine.rollStepTest(die.step, { isAction: false });
        extraDiceSum += dieRes.total;
        extraRollParts.push(`${die.spellName}(${die.element}): ${dieRes.trace}`);
      }

      const totalDmg = res.total + bonus + extraDiceSum;
      const buffInfoParts: string[] = [];
      if (fx.dmgStepBonus > 0) buffInfoParts.push(`法术增益 +${fx.dmgStepBonus} STEP`);
      if (extraDiceSum > 0) buffInfoParts.push(`附魔额外伤害 +${extraDiceSum}`);
      if (fx.notes.length > 0) buffInfoParts.push(fx.notes.join('、'));
      const fullTrace = [res.trace, ...extraRollParts, ...fx.notes].filter(Boolean).join(' | ');

      if (prev.targetValue.startsWith('m:')) {
        const targetId = prev.targetValue.slice(2);
        const m = prev.monsters.find((x) => x.instanceId === targetId);
        if (m) {
          const outcome = applyDamageToMonsterPure(
            m,
            totalDmg,
            'pa',
            prev.pl.options.knockdown,
            prev.pl.options.stun,
            `${prev.pl.name}【${w.name}】`
          );
          const extraSuffix = buffInfoParts.length > 0 ? ` [${buffInfoParts.join(' · ')}]` : '';
          const log = makeLog(
            `${outcome.log.text}${extraSuffix}`,
            [outcome.log.detail, fullTrace].filter(Boolean).join(' | '),
            outcome.log.type,
            outcome.log.blindText,
            prev.gmBlind
          );
          return {
            ...prev,
            lastExtraDamageBonus: 0,
            monsters: prev.monsters.map((x) => (x.instanceId === targetId ? outcome.monster : x)),
            logs: [log, ...prev.logs].slice(0, 60),
          };
        }
      }

      const bonusStrParts: string[] = [];
      if (bonus) bonusStrParts.push(`含额外成功 +${bonus}`);
      bonusStrParts.push(...buffInfoParts);
      const bonusNote = bonusStrParts.length > 0 ? `（${bonusStrParts.join('，')}）` : '';

      const log = makeLog(
        `${prev.pl.name} 掷出【${w.name}】伤害 (Step ${dmgStep}) → ${totalDmg} 点${bonusNote}`,
        fullTrace,
        'hit',
        '',
        prev.gmBlind
      );
      return { ...prev, lastExtraDamageBonus: 0, logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  // 法术三阶段：脉路编织 / 施法 / 效果结算（含环数/多才多艺额外脉路上限与 STEP 拆解）
  const handleWeaveSpell = (instanceId: string, wantKarma: boolean) => {
    setState((prev) => {
      const rawSp = prev.pl.spells.find((s: any) => s.instanceId === instanceId);
      if (!rawSp) return prev;
      const sp = enrichSpellWithDb(rawSp);
      const pl = { ...prev.pl };
      const useKarma = wantKarma && pl.karmaCurrent > 0;
      if (useKarma) pl.karmaCurrent -= 1;

      const d = getPlDerivedView(pl);
      const tw = ED4Engine.getThreadWeavingStep(pl, d, sp);
      const dn = Number(sp.weavingBase) || 5;
      const res = ED4Engine.rollStepTest(tw.step, { karma: useKarma, karmaDie: pl.karmaDie, dn, isAction: true });

      const rule = getExtraThreadRuleInfo(pl, sp);
      const curWoven = Number(sp.wovenThreads) || 0;
      let nextWoven = curWoven;
      let log;

      if (res.isSuccess) {
        const gained = 1 + res.extraSuccesses;
        const outcome = resolveWeavingRollOutcome({
          currentWoven: curWoven,
          gained,
          rule,
        });
        nextWoven = outcome.nextWoven;
        log = makeLog(
          `${pl.name} 为【${sp.nameCn}】脉路编织 (Step ${tw.step} vs ${dn}) → ${outcome.logText}`,
          res.trace,
          outcome.overflowed ? 'warn' : 'hit',
          '',
          prev.gmBlind
        );
      } else {
        log = makeLog(
          `${pl.name} 为【${sp.nameCn}】脉路编织 (Step ${tw.step} vs ${dn}) → 失败 (当前 ${curWoven}/${sp.threads})`,
          res.trace,
          'fail',
          '',
          prev.gmBlind
        );
      }

      return {
        ...prev,
        pl: {
          ...pl,
          spells: pl.spells.map((s: any) => (s.instanceId === instanceId ? { ...s, wovenThreads: nextWoven } : s)),
        },
        logs: [log, ...prev.logs].slice(0, 60),
      };
    });
  };

  const handleCastSpell = (instanceId: string, wantKarma: boolean, manualTmd?: string) => {
    const rawSp = state.pl.spells.find((s: any) => s.instanceId === instanceId);
    if (!rawSp) return;
    const sp = enrichSpellWithDb(rawSp);
    const reqThreads = Number(sp.threads) || 0;
    const curThreads = Number(sp.wovenThreads) || 0;
    if (reqThreads > 0 && curThreads < reqThreads) {
      setState((prev) => ({
        ...prev,
        logs: [
          makeLog(
            `${prev.pl.name} 无法施放【${sp.nameCn}】：尚需脉路编织 (${curThreads}/${reqThreads})`,
            '',
            'warn',
            '',
            prev.gmBlind
          ),
          ...prev.logs,
        ].slice(0, 60),
      }));
      return;
    }

    const castExtraThreads = Math.max(0, curThreads - reqThreads);
    const useKarma = wantKarma && state.pl.karmaCurrent > 0;
    const derived = getPlDerivedView(state.pl);
    const sc = ED4Engine.getSpellcastingStep(state.pl, derived);
    const { dn, targetLabel } = resolveCastingDn({
      spell: sp,
      manualTmd,
      targetValue: state.targetValue,
      monsters: state.monsters,
      getMonsterMd: (m) => getMonsterEffectiveDef(m, 'md'),
    });
    const res = ED4Engine.rollStepTest(sc.step, { karma: useKarma, karmaDie: state.pl.karmaDie, dn, isAction: true });
    const shouldOpenEffectModal = (castExtraThreads > 0 || sp.effectType === 'buff') && (dn === null || res.isSuccess);

    setState((prev) => {
      const pl = { ...prev.pl };
      if (useKarma && pl.karmaCurrent > 0) pl.karmaCurrent -= 1;

      const nextSpells = pl.spells.map((s: any) => (s.instanceId === instanceId ? { ...s, wovenThreads: 0 } : s));
      const nextPendingMap = { ...prev.pendingSpellCasts };

      if (dn === null) {
        const needsModal = castExtraThreads > 0 || ED4Engine.hasSpellEffectRoll(sp) || sp.effectType === 'buff';
        if (needsModal) {
          nextPendingMap[instanceId] = {
            instanceId,
            extraThreadsCount: castExtraThreads,
            castingExtraSuccesses: 0,
            tmdUsed: null,
            targetLabel,
          };
        } else {
          delete nextPendingMap[instanceId];
        }
        const extraHint = castExtraThreads > 0 ? `（含额外脉路 ${castExtraThreads} 条，请在弹窗选择效果）` : '';
        const log = makeLog(
          `${pl.name} 施放【${sp.nameCn}】 (Step ${sc.step}，未填 TMD 仅掷骰) → ${res.total}${extraHint}`,
          res.trace,
          '',
          '',
          prev.gmBlind
        );
        return {
          ...prev,
          pl: { ...pl, spells: nextSpells },
          pendingSpellCasts: nextPendingMap,
          logs: [log, ...prev.logs].slice(0, 60),
        };
      }

      if (!res.isSuccess) {
        delete nextPendingMap[instanceId];
        const log = makeLog(
          `${pl.name} 对 ${targetLabel} 施放【${sp.nameCn}】 → 失败 (${res.total} vs ${dn})`,
          res.trace,
          'fail',
          `${pl.name} 施放【${sp.nameCn}】 → 未命中 (${res.total})`,
          prev.gmBlind
        );
        return {
          ...prev,
          pl: { ...pl, spells: nextSpells },
          pendingSpellCasts: nextPendingMap,
          logs: [log, ...prev.logs].slice(0, 60),
        };
      }

      const needsEffectResolution =
        castExtraThreads > 0 ||
        ED4Engine.hasSpellEffectRoll(sp) ||
        sp.effectType === 'buff' ||
        (res.extraSuccesses > 0 && sp.extraEffectStepPerThread === 2);

      if (needsEffectResolution) {
        nextPendingMap[instanceId] = {
          instanceId,
          extraThreadsCount: castExtraThreads,
          castingExtraSuccesses: res.extraSuccesses,
          tmdUsed: dn,
          targetLabel,
        };
      } else {
        delete nextPendingMap[instanceId];
      }

      const immediateDurPlan = !needsEffectResolution
        ? computeSpellDurationPlan({
            spell: sp,
            spellcastingRank: sc.rank,
            selectedExtraOptions: [],
            castingExtraSuccesses: res.extraSuccesses,
            supportsCastingExtraStep: false,
          })
        : null;

      const extraThreadHint = castExtraThreads > 0 ? ` · 额外脉路 ${castExtraThreads} 条` : '';
      const suffixHint = needsEffectResolution
        ? '，请在弹窗或「结算效果」确认生效细节'
        : `，效果立即生效（${sp.effectFormula}${immediateDurPlan?.hasExtension ? `；${immediateDurPlan.summaryText}` : ''}）`;
      const log = makeLog(
        `${pl.name} 对 ${targetLabel} 成功施放【${sp.nameCn}】 (${res.total} vs ${dn}，额外成功 +${res.extraSuccesses}${extraThreadHint})${suffixHint}`,
        immediateDurPlan?.hasExtension ? `${res.trace} | ${immediateDurPlan.summaryText}` : res.trace,
        'hit',
        `${pl.name} 成功施放【${sp.nameCn}】（额外成功 +${res.extraSuccesses}）${suffixHint}`,
        prev.gmBlind
      );
      return {
        ...prev,
        pl: { ...pl, spells: nextSpells },
        pendingSpellCasts: nextPendingMap,
        logs: [log, ...prev.logs].slice(0, 60),
      };
    });

    // 若施法时编入了额外脉路或为增益法术，自动弹出效果结算弹窗供选择强化/持续时间与挂载目标
    if (shouldOpenEffectModal) {
      setSpellEffectModal({ instanceId, initialKarma: wantKarma });
    }
  };

  const handleOpenSpellEffectModal = (instanceId: string, wantKarma: boolean) => {
    setSpellEffectModal({ instanceId, initialKarma: wantKarma });
  };

  const handleConfirmSpellEffect = (
    instanceId: string,
    selectedExtraOptions: string[],
    wantKarma: boolean,
    buffTarget?: SpellBuffTargetChoice
  ) => {
    setState((prev) => {
      const rawSp = prev.pl.spells.find((s: any) => s.instanceId === instanceId);
      if (!rawSp) return prev;
      const sp = enrichSpellWithDb(rawSp);
      const pending = prev.pendingSpellCasts[instanceId];
      const reqThreads = Number(sp.threads) || 0;
      const curThreads = Number(sp.wovenThreads) || 0;
      const extraThreadsCount = pending ? pending.extraThreadsCount : Math.max(0, curThreads - reqThreads);
      const castingExtraSuccesses = pending ? pending.castingExtraSuccesses : 0;

      const pl = { ...prev.pl };
      const d = getPlDerivedView(pl);
      const plan = computeSpellEffectPlan({
        spell: sp,
        pl,
        derived: d,
        extraThreadsCount,
        selectedExtraOptions,
        castingExtraSuccesses,
      });

      const useKarma = plan.hasBaseRoll && wantKarma && pl.karmaCurrent > 0;
      if (useKarma) pl.karmaCurrent -= 1;
      if (plan.willforceStrain > 0) pl.currentDamage += plan.willforceStrain;

      const nextSpells = pending
        ? pl.spells
        : pl.spells.map((s: any) => (s.instanceId === instanceId ? { ...s, wovenThreads: 0 } : s));
      const nextPendingMap = { ...prev.pendingSpellCasts };
      delete nextPendingMap[instanceId];

      // 轻量 Buff 挂载处理（仅作用于当前角色或指定装备）
      let nextActiveBuffs: ActiveBuff[] = Array.isArray(pl.activeBuffs) ? pl.activeBuffs : [];
      let buffMountMsg = '';
      if (sp.effectType === 'buff') {
        if (buffTarget?.attachMode !== 'external') {
          const entry = buildActiveBuffEntry({
            spell: sp,
            plan,
            targetItemId: buffTarget?.targetItemId,
            targetItemName: buffTarget?.targetItemName,
          });
          nextActiveBuffs = [
            ...nextActiveBuffs.filter(
              (b) => !(b.spellId === entry.spellId && (b.targetItemId || '') === (entry.targetItemId || ''))
            ),
            entry,
          ];
          buffMountMsg = entry.targetItemName ? `已挂载至【${entry.targetItemName}】` : `已挂载至【${pl.name}】`;
        } else {
          buffMountMsg = '作用于队友/外部目标';
        }
      }

      const cleanDetailParts: string[] = [];
      if (plan.hasBaseRoll && plan.baseStep !== null) {
        cleanDetailParts.push(plan.breakdownText);
      } else {
        cleanDetailParts.push(plan.playerSummaryText);
      }
      if (plan.durationPlan.rawDuration !== '-') {
        cleanDetailParts.push(plan.durationPlan.summaryText);
      }
      if (plan.hasBaseRoll && plan.effectEnhancements.length > 0) {
        cleanDetailParts.push(
          `附加脉路效果：${plan.effectEnhancements
            .map((t) => (t.count > 1 ? `${t.label} ×${t.count}` : t.label))
            .join('、')}`
        );
      }
      if (buffMountMsg) {
        cleanDetailParts.push(buffMountMsg);
      }

      if (!plan.hasBaseRoll || plan.finalStep === null) {
        const headlineSummary = plan.playerSummaryText.replace(/^本次生效强化：/, '');
        const durationSuffix = plan.durationPlan.hasExtension
          ? `（${plan.durationPlan.summaryText}）`
          : plan.durationPlan.rawDuration !== '-'
            ? `（持续 ${plan.durationPlan.finalDisplay}）`
            : '';
        const mountSuffix = buffMountMsg ? ` · ${buffMountMsg}` : '';
        const log = makeLog(
          `${pl.name} 结算【${sp.nameCn}】：${headlineSummary}${durationSuffix}${mountSuffix}`,
          cleanDetailParts.join(' | '),
          'hit',
          '',
          prev.gmBlind
        );
        return {
          ...prev,
          pl: { ...pl, spells: nextSpells, activeBuffs: nextActiveBuffs },
          pendingSpellCasts: nextPendingMap,
          logs: [log, ...prev.logs].slice(0, 60),
        };
      }

      const res = ED4Engine.rollStepTest(plan.finalStep, { karma: useKarma, karmaDie: pl.karmaDie, isAction: false });
      const total = res.total;
      cleanDetailParts.push(res.trace);
      const detailSummary = cleanDetailParts.join(' | ');

      if (sp.effectType === 'damage') {
        if (prev.targetValue === 'aoe:all') {
          const alive = prev.monsters.filter((m) => m.currentDamage < m.death);
          if (alive.length > 0) {
            const newLogs = [
              makeLog(
                `${pl.name} 掷出群体法术【${sp.nameCn}】效果/伤害 (Step ${plan.finalStep}) → ${total} 点`,
                detailSummary,
                'hit',
                '',
                prev.gmBlind
              ),
            ];
            const nextMonsters = prev.monsters.map((m) => {
              if (m.currentDamage >= m.death) return m;
              const outcome = applyDamageToMonsterPure(m, total, sp.armorType || 'ma', false, false, `${pl.name}【${sp.nameCn}】`);
              newLogs.unshift(makeLog(outcome.log.text, `${outcome.log.detail} | ${detailSummary}`, outcome.log.type, outcome.log.blindText, prev.gmBlind));
              return outcome.monster;
            });
            return {
              ...prev,
              pl: { ...pl, spells: nextSpells, activeBuffs: nextActiveBuffs },
              pendingSpellCasts: nextPendingMap,
              monsters: nextMonsters,
              logs: [...newLogs, ...prev.logs].slice(0, 60),
            };
          }
        } else if (prev.targetValue.startsWith('m:')) {
          const targetId = prev.targetValue.slice(2);
          const m = prev.monsters.find((x) => x.instanceId === targetId);
          if (m) {
            const outcome = applyDamageToMonsterPure(m, total, sp.armorType || 'ma', false, false, `${pl.name}【${sp.nameCn}】`);
            const log = makeLog(
              outcome.log.text,
              `${outcome.log.detail} | ${detailSummary}`,
              outcome.log.type,
              outcome.log.blindText,
              prev.gmBlind
            );
            return {
              ...prev,
              pl: { ...pl, spells: nextSpells, activeBuffs: nextActiveBuffs },
              pendingSpellCasts: nextPendingMap,
              monsters: prev.monsters.map((x) => (x.instanceId === targetId ? outcome.monster : x)),
              logs: [log, ...prev.logs].slice(0, 60),
            };
          }
        }
      }

      const log = makeLog(
        `${pl.name} 结算【${sp.nameCn}】效果 (Step ${plan.finalStep}) → ${total}${buffMountMsg ? ` · ${buffMountMsg}` : ''}`,
        detailSummary,
        'hit',
        '',
        prev.gmBlind
      );
      return {
        ...prev,
        pl: { ...pl, spells: nextSpells, activeBuffs: nextActiveBuffs },
        pendingSpellCasts: nextPendingMap,
        logs: [log, ...prev.logs].slice(0, 60),
      };
    });
    setSpellEffectModal(null);
  };

  // 导入角色卡 (.xlsx / .txt)
  const handleImportFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const reader = new FileReader();
    reader.onload = async (e) => {
      const result = e.target?.result;
      if (!result) return;
      let data: any;
      if (ext === 'txt') {
        data = ED4Engine.parseTxtSheet(String(result));
      } else {
        const buf = result as ArrayBuffer;
        importedXlsxBufferRef.current = buf.slice(0);
        data = ED4Engine.parseExcelWorkbook(XLSX.read(new Uint8Array(buf), { type: 'array' }));
        const portraitUrl = await extractPortraitFromXlsxBuffer(buf);
        if (portraitUrl) data.portraitUrl = portraitUrl;
      }

      setState((prev) => {
        const nextPl = applyImportedCharacter(prev.pl, data);
        const d = getPlDerivedView(nextPl);
        const matchedSpells = (nextPl.spells || []).filter((s: any) => s.matchedDb).length;
        const log = makeLog(
          `已导入角色【${nextPl.name}】（${d.race.name} · ${d.prog.disc.name} ${nextPl.circle}环）`,
          `天赋 ${nextPl.talents.length} 项 | 技能 ${nextPl.skills.length} 项 | 武器 ${nextPl.weapons.length} 件 | 装备 ${nextPl.gear.length} 件 | 脉路物品 ${nextPl.threadItems.length} 件 | 法术 ${nextPl.spells.length} 个（匹配库 ${matchedSpells} 个）`,
          'hit',
          '',
          prev.gmBlind
        );
        return { ...prev, pl: nextPl, logs: [log, ...prev.logs].slice(0, 60) };
      });
    };
    if (ext === 'txt') reader.readAsText(file, 'utf-8');
    else reader.readAsArrayBuffer(file);
  };

  // GM：生成怪物 / 攻击 / 删除 / 受创
  const handleSpawnMonster = (templateId: string, count: number) => {
    setState((prev) => {
      const tpl = prev.monsterTemplates.find((x) => x.id === templateId);
      if (!tpl) return prev;
      const existing = prev.monsters.filter((m) => m.templateId === templateId).length;
      const added = Array.from({ length: count }, (_, i) => createMonsterInstance(tpl, existing, count, i));
      const log = makeLog(`已将 ${count} 名【${tpl.name}】加入战斗`, '', '', '', prev.gmBlind);
      return { ...prev, monsters: [...prev.monsters, ...added], logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  const handleMonsterAttackPl = (instanceId: string, targetClientId?: string) => {
    setState((prev) => {
      const m = prev.monsters.find((x) => x.instanceId === instanceId);
      if (!m) return prev;
      const remoteTarget = targetClientId
        ? roomCharacters.find((c) => c.client_id === targetClientId && c.role === 'pl')
        : null;
      const targetName = remoteTarget ? remoteTarget.char_name : prev.pl.name;
      const targetPd = remoteTarget ? remoteTarget.pd : getPlDerivedView(prev.pl).pd;
      const targetId = remoteTarget ? remoteTarget.client_id : 'pl';
      const atkStep = Math.max(1, m.atkStep - m.wounds);
      const res = ED4Engine.rollStepTest(atkStep, { dn: targetPd, isAction: true, karmaDie: prev.pl.karmaDie });
      if (!res.isSuccess) {
        const log = makeLog(`${m.name} 攻击 ${targetName} → 未命中 (${res.total} vs ${targetPd})`, res.trace, '', '', prev.gmBlind);
        return { ...prev, logs: [log, ...prev.logs].slice(0, 60) };
      }
      const nextPending = {
        attackerId: m.instanceId,
        attackerType: 'gm',
        attackerName: m.name,
        targetId,
        targetType: 'pl',
        targetName,
        attackName: '近战攻击',
        atkTotal: res.total,
        targetDef: targetPd,
        extraSuccesses: res.extraSuccesses,
        dmgStep: m.dmgStep,
        isMelee: true,
        isKnockdownOpt: false,
        isStunOpt: false,
        armorType: 'pa',
      };
      const log = makeLog(
        `${m.name} 命中 ${targetName} (${res.total} vs ${targetPd}，额外成功 +${res.extraSuccesses})，等待反应`,
        res.trace,
        'warn',
        '',
        prev.gmBlind
      );
      return { ...prev, pendingReaction: nextPending, logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  const handleClearMonsters = () => {
    setState((prev) => {
      const log = makeLog('GM 已清空战场（移除全部怪物）', '', 'warn', '', prev.gmBlind);
      return {
        ...prev,
        monsters: [],
        initiativeList: prev.initiativeList.filter((i) => i.type !== 'gm'),
        pendingReaction: null,
        logs: [log, ...prev.logs].slice(0, 60),
      };
    });
  };

  // 待确认反应结算（调用 ED4Engine.resolveAvoidBlow / resolveRiposte）
  const handleResolveReaction = (action: 'accept' | 'avoid' | 'riposte') => {
    setState((prev) => {
      const pr = prev.pendingReaction;
      if (!pr) return prev;
      let nextPl = { ...prev.pl };
      let nextMonsters = [...prev.monsters];
      const addedLogs: any[] = [];

      if (action === 'avoid' && pr.targetType === 'pl') {
        const d = getPlDerivedView(nextPl);
        const t = nextPl.talents.find((x: any) => x.name.includes('回避打击') || x.name.includes('闪避') || x.name.toLowerCase().includes('avoid blow'));
        const avoidStep = Math.max(1, (t ? d.steps[t.attr] + t.rank : d.steps.DEX) + getEffectiveActionMod(nextPl));
        const res = ED4Engine.resolveAvoidBlow({ avoidStep, attackRollTotal: pr.atkTotal, karmaDie: nextPl.karmaDie });
        nextPl.currentDamage += res.strainCost;
        if (res.avoided) {
          addedLogs.unshift(
            makeLog(`${nextPl.name} 发动【${t ? t.name : '回避打击'}】（1负荷）闪避成功 (${res.rollResult.total} vs ${pr.atkTotal})`, res.rollResult.trace, 'hit', '', prev.gmBlind)
          );
          return { ...prev, pl: nextPl, pendingReaction: null, logs: [...addedLogs, ...prev.logs].slice(0, 60) };
        }
        addedLogs.unshift(
          makeLog(`${nextPl.name} 发动【${t ? t.name : '回避打击'}】（1负荷）闪避失败 (${res.rollResult.total} vs ${pr.atkTotal})`, res.rollResult.trace, 'fail', '', prev.gmBlind)
        );
      }

      if (action === 'riposte' && pr.targetType === 'pl') {
        const d = getPlDerivedView(nextPl);
        const t = nextPl.talents.find((x: any) => x.name.includes('反击') || x.name.toLowerCase().includes('riposte'));
        const riposteStep = Math.max(1, (t ? d.steps[t.attr] + t.rank : d.steps.DEX) + getEffectiveActionMod(nextPl));
        const res = ED4Engine.resolveRiposte({ riposteStep, attackRollTotal: pr.atkTotal, karmaDie: nextPl.karmaDie });
        nextPl.currentDamage += res.strainCost;
        if (res.riposted) {
          addedLogs.unshift(
            makeLog(`${nextPl.name} 发动【反击】（2负荷）格挡成功 (${res.rollResult.total} vs ${pr.atkTotal})`, res.rollResult.trace, 'hit', '', prev.gmBlind)
          );
          if (res.rollResult.extraSuccesses >= 1 && pr.attackerType === 'gm') {
            const w = nextPl.weapons[0] || { name: '武器', dmgStep: 0 };
            const counterDmg =
              ED4Engine.rollStepTest(d.steps.STR + w.dmgStep, { isAction: false, karmaDie: nextPl.karmaDie }).total +
              Math.max(0, res.rollResult.extraSuccesses - 1) * 2;
            const targetM = nextMonsters.find((m) => m.instanceId === pr.attackerId);
            if (targetM) {
              const out = applyDamageToMonsterPure(targetM, counterDmg, 'pa', false, false, `${nextPl.name} 反击`);
              nextMonsters = nextMonsters.map((m) => (m.instanceId === pr.attackerId ? out.monster : m));
              addedLogs.unshift(makeLog(out.log.text, out.log.detail, out.log.type, out.log.blindText, prev.gmBlind));
            }
          }
          return { ...prev, pl: nextPl, monsters: nextMonsters, pendingReaction: null, logs: [...addedLogs, ...prev.logs].slice(0, 60) };
        }
        addedLogs.unshift(
          makeLog(`${nextPl.name} 发动【反击】（2负荷）失败 (${res.rollResult.total} vs ${pr.atkTotal})`, res.rollResult.trace, 'fail', '', prev.gmBlind)
        );
      }

      const dmgRes = ED4Engine.rollStepTest(pr.dmgStep, { isAction: false, karmaDie: nextPl.karmaDie });
      const totalDmg = dmgRes.total + pr.extraSuccesses * 2;

      if (pr.targetType === 'gm') {
        const targetM = nextMonsters.find((m) => m.instanceId === pr.targetId);
        if (targetM) {
          const out = applyDamageToMonsterPure(targetM, totalDmg, pr.armorType, pr.isKnockdownOpt, pr.isStunOpt, pr.attackerName);
          nextMonsters = nextMonsters.map((m) => (m.instanceId === pr.targetId ? out.monster : m));
          addedLogs.unshift(makeLog(out.log.text, out.log.detail, out.log.type, out.log.blindText, prev.gmBlind));
        }
      } else {
        const out = applyDamageToPlPure(nextPl, totalDmg, pr.armorType, pr.isKnockdownOpt, pr.isStunOpt, pr.attackerName);
        nextPl = out.pl;
        addedLogs.unshift(makeLog(out.log.text, out.log.detail, out.log.type, '', prev.gmBlind));
      }

      return {
        ...prev,
        pl: nextPl,
        monsters: nextMonsters,
        pendingReaction: null,
        logs: [...addedLogs, ...prev.logs].slice(0, 60),
      };
    });
  };

  // 快捷受创结算
  const handleManualApplyDamage = (target: string, rawDmg: number, armorType: 'pa' | 'ma') => {
    setState((prev) => {
      if (target === 'pl') {
        const out = applyDamageToPlPure(prev.pl, rawDmg, armorType, false, false, '环境/直接伤害');
        const log = makeLog(out.log.text, out.log.detail, out.log.type, '', prev.gmBlind);
        return { ...prev, pl: out.pl, logs: [log, ...prev.logs].slice(0, 60) };
      }
      const m = prev.monsters.find((x) => x.instanceId === target);
      if (!m) return prev;
      const out = applyDamageToMonsterPure(m, rawDmg, armorType, false, false, '直接伤害');
      const log = makeLog(out.log.text, out.log.detail, out.log.type, out.log.blindText, prev.gmBlind);
      return {
        ...prev,
        monsters: prev.monsters.map((x) => (x.instanceId === target ? out.monster : x)),
        logs: [log, ...prev.logs].slice(0, 60),
      };
    });
  };

  // 先攻与轮次推进
  const handleRollAllInitiative = () => {
    setState((prev) => {
      const list: any[] = [];
      const syncedPls = roomSession.connected ? roomCharacters.filter((c) => c.role === 'pl') : [];

      if (syncedPls.length > 0) {
        syncedPls.forEach((rc) => {
          const penalty = -(Number(rc.wounds) || 0) - (rc.statuses?.knockedDown ? 3 : 0) - (rc.statuses?.harried ? 2 : 0) - (rc.options?.defensive ? 3 : 0);
          const step = Math.max(1, (Number(rc.init_step) || 5) + penalty);
          const roll = ED4Engine.rollStepTest(step, { isAction: false, karmaDie: 6 });
          list.push({
            id: `pl_${rc.client_id}`,
            clientId: rc.client_id,
            type: 'pl',
            name: rc.char_name || rc.nickname,
            initVal: roll.total,
            initStep: step,
            dexVal: rc.dex_val || 10,
          });
        });
      } else {
        const d = getPlDerivedView(prev.pl);
        const plStep = Math.max(1, d.initStep + getEffectiveActionMod(prev.pl));
        const plRoll = ED4Engine.rollStepTest(plStep, { isAction: false, karmaDie: prev.pl.karmaDie });
        list.push({
          id: roomSession.connected ? `pl_${roomSession.clientId}` : 'pl',
          clientId: roomSession.clientId,
          type: 'pl',
          name: prev.pl.name,
          initVal: plRoll.total,
          initStep: plStep,
          dexVal: d.attrs.DEX,
        });
      }

      prev.monsters.forEach((m) => {
        if (m.currentDamage >= m.death) return;
        const mStep = Math.max(1, m.initStep - m.wounds - (m.knockedDown ? 3 : 0) - (m.harried ? 2 : 0));
        const mRoll = ED4Engine.rollStepTest(mStep, { isAction: false });
        list.push({ id: m.instanceId, type: 'gm', name: m.name, initVal: mRoll.total, initStep: mStep, dexVal: 0 });
      });

      const sorted = sortInitiativeList(list);
      const log = makeLog(`第 ${prev.round} 轮全员投先攻完成`, sorted.map((x) => `${x.name}:${x.initVal}`).join(' | '), 'warn', '', prev.gmBlind);
      return { ...prev, initiativeList: sorted, turnIndex: 0, logs: [log, ...prev.logs].slice(0, 60) };
    });
  };

  const handleNextRound = () => {
    setState((prev) => {
      const nextRound = prev.round + 1;
      const log = makeLog(`进入第 ${nextRound} 轮（已重置单轮战斗选项）`, '', 'warn', '', prev.gmBlind);
      return {
        ...prev,
        round: nextRound,
        turnIndex: 0,
        pl: {
          ...prev.pl,
          options: { aggressive: false, defensive: false, knockdown: false, stun: false, splitMove: false, tailAttack: false },
          statuses: { ...prev.pl.statuses, surprised: false, reserved: false },
        },
        logs: [log, ...prev.logs].slice(0, 60),
      };
    });
  };

  const handlePartyFullRest = () => {
    setState((prev) => {
      const d = getPlDerivedView(prev.pl);
      const log = makeLog('全队休整完成：回复次数与业力已重置，临时状态已清除', '', 'hit', '', prev.gmBlind);
      return {
        ...prev,
        round: 1,
        pl: {
          ...prev.pl,
          recoveryCurrent: d.recoveryMax,
          karmaCurrent: d.karmaMax,
          options: { aggressive: false, defensive: false, knockdown: false, stun: false, splitMove: false, tailAttack: false },
          statuses: { knockedDown: false, blindsided: false, surprised: false, harried: false, reserved: false },
        },
        logs: [log, ...prev.logs].slice(0, 60),
      };
    });
  };

  const handleRollFreeTest = (step: number, dn: string, karma: boolean) => {
    const res = ED4Engine.rollStepTest(step, { karma, karmaDie: state.pl.karmaDie, dn, isAction: true });
    let suffix = '';
    if (res.isRuleOfOne) suffix = ' [全一规则大失败]';
    else if (res.isSuccess === true) suffix = ` [成功，额外成功 +${res.extraSuccesses}]`;
    else if (res.isSuccess === false) suffix = ' [失败]';
    pushLog(`自由检定 (Step ${step}) → ${res.total}${suffix}`, res.trace, res.isSuccess === true ? 'hit' : res.isSuccess === false ? 'fail' : '');
  };

  // 角色卡导出：TXT / 剪贴板 / Excel / PDF 打印
  const handleExportTxt = () => {
    const txt = serializeCharacterToTxt(state.pl);
    const fileName = `${getExportBaseName(state.pl)}.txt`;
    downloadTextFile(fileName, txt);
    pushLog(`已导出角色卡 TXT：${fileName}`, '', 'hit');
  };

  const handleCopyTxt = async (): Promise<boolean> => {
    const txt = serializeCharacterToTxt(state.pl);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(txt);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      pushLog(`已复制角色卡【${state.pl.name}】TXT 文本到剪贴板`, '', 'hit');
      return true;
    }
    pushLog('复制到剪贴板失败，请尝试下载 TXT 文件', '', 'fail');
    return false;
  };

  const handleExportExcel = async () => {
    try {
      const buf = await exportCharacterExcelBuffer(state.pl, importedXlsxBufferRef.current);
      const fileName = `${getExportBaseName(state.pl)}.xlsx`;
      downloadExcelBuffer(fileName, buf);
      pushLog(`已导出角色卡 Excel：${fileName}`, '', 'hit');
    } catch (err: any) {
      pushLog(`导出 Excel 失败：${err?.message || '模板加载异常'}`, '', 'fail');
    }
  };

  const prewarmPrintFonts = async (waitForReady: boolean) => {
    const printEl = document.querySelector<HTMLElement>('.print-sheet');
    if (!printEl) return;
    printEl.dataset.fontPrewarm = 'true';
    void printEl.offsetHeight;

    const uniqueChars =
      Array.from(new Set((printEl.textContent || '').replace(/\s+/g, ''))).join('') || '角色档案0123';
    const fontsApi = document.fonts;
    if (fontsApi) {
      const seen = new Set<string>();
      const loadTasks: Promise<unknown>[] = [];
      const enqueueLoad = (descriptor: string) => {
        if (seen.has(descriptor)) return;
        seen.add(descriptor);
        loadTasks.push(Promise.resolve(fontsApi.load(descriptor, uniqueChars)).catch(() => []));
      };

      for (const face of fontsApi) {
        const cleanFamily = face.family.replace(/^["']|["']$/g, '');
        enqueueLoad(`${face.style || 'normal'} ${face.weight || '400'} 14px "${cleanFamily}"`);
      }
      for (const fam of [
        'SuCaiJiShi-SheHuiTi',
        'Source Han Serif CN for Display',
        'Sarasa Gothic SC',
        'Sarasa UI SC',
        'Cubic 11',
        'JetBrains Mono',
      ]) {
        for (const w of ['400', '600', '700']) {
          enqueueLoad(`normal ${w} 14px "${fam}"`);
        }
      }

      if (waitForReady) {
        await Promise.race([
          Promise.allSettled(loadTasks).then(() => fontsApi.ready),
          new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
        ]);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      }
    }
    if (waitForReady) {
      delete printEl.dataset.fontPrewarm;
    } else {
      window.setTimeout(() => {
        delete printEl.dataset.fontPrewarm;
      }, 1200);
    }
  };

  const handleExportPdf = async () => {
    const originalTitle = document.title;
    const printTitle = getExportBaseName(state.pl);
    let restored = false;
    const restoreTitle = () => {
      if (restored) return;
      restored = true;
      document.title = originalTitle;
    };

    document.documentElement.dataset.printMode = pdfMode;
    document.title = printTitle;
    window.addEventListener('afterprint', restoreTitle, { once: true });

    await prewarmPrintFonts(true);
    setExportModalOpen(false);

    window.setTimeout(() => {
      window.print();
      window.setTimeout(restoreTitle, 1000);
    }, 60);
    pushLog(`已调用浏览器打印 / 另存为 PDF（${pdfMode === 'theme' ? '主题彩色版' : '黑白打印版'}）：${printTitle}.pdf`, '', 'hit');
  };

  // 联机大厅：身份切换、建房、进房、退房与复制邀请链接
  const copyPlainText = async (content: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        return true;
      }
    } catch {
      // 降级 execCommand
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleSelectRole = (role: RoomRole) => {
    setRoomSession((prev) => ({
      ...prev,
      role,
      nickname: role === 'gm' && !prev.nickname.trim() ? 'GM' : prev.nickname,
    }));
    setState((prev) => {
      if (role === 'gm') return { ...prev, activeTab: 'gm' };
      return prev.activeTab === 'gm' ? { ...prev, activeTab: 'pl' } : prev;
    });
  };

  const handleCreateRoom = async (roomCode: string, nickname: string, role: RoomRole): Promise<string | null> => {
    const cleanCode = roomCode.trim();
    const roomPayload = buildRoomStatePayload(state, roomSession.clientId);
    const res = await createRoomInSupabase(cleanCode, roomPayload);
    if (!res.ok) return res.error;

    lastSyncedRoomJsonRef.current = JSON.stringify({
      round: roomPayload.round,
      turnIndex: roomPayload.turnIndex,
      initiativeList: roomPayload.initiativeList,
      monsters: roomPayload.monsters,
      pendingReaction: roomPayload.pendingReaction,
      gmBlind: roomPayload.gmBlind,
    });
    state.logs.forEach((l) => knownLogIdsRef.current.add(String(l.id)));

    const nextSession: RoomSession = {
      connected: true,
      roomCode: res.code,
      role,
      nickname,
      clientId: roomSession.clientId,
    };
    setRoomSession(nextSession);

    const charRow = buildCharacterSyncPayload({
      roomCode: res.code,
      clientId: roomSession.clientId,
      nickname,
      role,
      pl: state.pl,
    });
    setRoomCharacters([charRow]);
    await pushCharacterToSupabase(charRow);
    pushLog(`${nickname} 创建了联机房间【${res.code}】`, buildRoomInviteUrl(res.code), 'hit');
    return null;
  };

  const handleJoinRoom = async (roomCode: string, nickname: string, role: RoomRole): Promise<string | null> => {
    const res = await joinRoomInSupabase(roomCode);
    if (!res.ok) return res.error;

    const mappedLogs = (res.logs || []).map((row: any) => {
      knownLogIdsRef.current.add(String(row.id));
      return {
        id: String(row.id),
        time: row.time || formatTime(),
        text:
          role === 'pl' && res.roomState?.gmBlind && row.blind_text
            ? row.blind_text
            : row.sender_name && !String(row.text || '').startsWith(row.sender_name)
              ? `[${row.sender_name}] ${row.text}`
              : row.text,
        detail:
          role === 'pl' && res.roomState?.gmBlind && row.blind_text
            ? '（GM脱敏模式已隐藏具体抗性与阈值）'
            : row.detail || '',
        type: row.type || '',
      };
    });

    if (res.roomState) {
      const rs = res.roomState;
      lastSyncedRoomJsonRef.current = JSON.stringify({
        round: Number(rs.round) || 1,
        turnIndex: Number(rs.turnIndex) || 0,
        initiativeList: Array.isArray(rs.initiativeList) ? rs.initiativeList : [],
        monsters: Array.isArray(rs.monsters) ? rs.monsters : [],
        pendingReaction: rs.pendingReaction ?? null,
        gmBlind: Boolean(rs.gmBlind),
      });
      isApplyingRemoteStateRef.current = true;
      setState((prev) => ({
        ...prev,
        activeTab: role === 'pl' && prev.activeTab === 'gm' ? 'pl' : role === 'gm' ? 'gm' : prev.activeTab,
        round: Number(rs.round) || 1,
        turnIndex: Number(rs.turnIndex) || 0,
        initiativeList: Array.isArray(rs.initiativeList) ? rs.initiativeList : [],
        monsters: Array.isArray(rs.monsters) ? rs.monsters : [],
        pendingReaction: rs.pendingReaction ?? null,
        gmBlind: Boolean(rs.gmBlind),
        logs: mappedLogs,
      }));
    } else if (mappedLogs.length > 0) {
      setState((prev) => ({ ...prev, logs: mappedLogs }));
    }

    const nextSession: RoomSession = {
      connected: true,
      roomCode: res.code,
      role,
      nickname,
      clientId: roomSession.clientId,
    };
    setRoomSession(nextSession);

    const charRow = buildCharacterSyncPayload({
      roomCode: res.code,
      clientId: roomSession.clientId,
      nickname,
      role,
      pl: state.pl,
    });
    setRoomCharacters(mergeCharacterList(res.characters, 'INSERT', charRow));
    await pushCharacterToSupabase(charRow);
    pushLog(`${nickname} (${role.toUpperCase()}) 加入了房间【${res.code}】`, '', 'hit');
    setRoomModalOpen(false);
    return null;
  };

  const handleLeaveRoom = async () => {
    const prevCode = roomSession.roomCode;
    const prevNick = roomSession.nickname;
    if (prevCode) {
      await removeCharacterFromSupabase(prevCode, roomSession.clientId);
    }
    setRoomSession((prev) => ({ ...prev, connected: false, roomCode: '' }));
    setRoomCharacters([]);
    if (prevCode) pushLog(`${prevNick || '成员'} 退出了房间【${prevCode}】`, '', 'warn');
  };

  const visibleNavTabs = ([
    ['pl', '角色卡（PL）'],
    ['gm', '怪物面板（GM）'],
    ['step', 'STEP表'],
  ] as const).filter(([tabId]) => !(roomSession.role === 'pl' && tabId === 'gm'));

  const gmPlTargets = roomSession.connected
    ? roomCharacters
        .filter((c) => c.role === 'pl')
        .map((c) => ({ clientId: c.client_id, label: `${c.char_name} (${c.nickname})` }))
    : [];

  return (
    <>
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:h-screen lg:overflow-hidden print:hidden">
      {/* 顶部导航栏 */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-display text-base font-bold tracking-tight text-foreground">Earthdawn 4E</span>
          <nav className="flex items-center gap-1 rounded border border-border bg-muted/70 p-0.5">
            {visibleNavTabs.map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                onClick={() => setState((p) => ({ ...p, activeTab: tabId }))}
                className={`h-7 rounded px-2.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
                  state.activeTab === tabId
                    ? 'bg-primary font-semibold text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRoomModalOpen(true)}
            className={`inline-flex h-7 items-center gap-1.5 rounded border px-2.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              roomSession.connected
                ? 'border-primary bg-primary/15 text-foreground hover:bg-primary/25'
                : 'border-border bg-secondary text-secondary-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {roomSession.connected ? (
              <Wifi className="h-3.5 w-3.5 text-primary" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span>
              {roomSession.connected
                ? `已联机 · ${roomSession.roomCode}`
                : isSupabaseConfigured
                  ? '联机'
                  : '联机（单机）'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSpellJsonOpen(true)}
            className="inline-flex h-7 items-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer whitespace-nowrap"
          >
            结构化法术 JSON
          </button>
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="inline-flex h-7 items-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer whitespace-nowrap"
          >
            使用说明书
          </button>
          <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded border border-border bg-secondary px-2.5 text-xs text-secondary-foreground transition-colors hover:bg-muted whitespace-nowrap">
            <input
              type="checkbox"
              checked={state.gmBlind}
              onChange={(e) => setState((p) => ({ ...p, gmBlind: e.target.checked }))}
              className="accent-primary"
            />
            GM脱敏显示
          </label>
          <button
            type="button"
            onClick={() => setIsDark((prev) => !prev)}
            aria-label={isDark ? '切换为档案纸白天模式' : '切换为深岩灰夜间模式'}
            title={isDark ? '切换白天模式（档案纸）' : '切换夜间模式（深岩灰）'}
            className="inline-flex h-7 items-center gap-1.5 rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer whitespace-nowrap"
          >
            {isDark ? <Sun className="h-3.5 w-3.5 text-primary" /> : <Moon className="h-3.5 w-3.5 text-primary" />}
            <span>{isDark ? '日间' : '夜间'}</span>
          </button>
        </div>
      </header>

      {/* 主工作区：桌面端可拖拽分栏，移动端垂直堆叠 */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-1 overflow-y-auto p-3">
          {state.activeTab === 'pl' && (
            <PlSheetView
              pl={state.pl}
              monsters={state.monsters}
              gmBlind={state.gmBlind}
              targetValue={state.targetValue}
              showAllSpells={state.showAllSpells}
              talentFilter={state.talentFilter}
              skillFilter={state.skillFilter}
              lastExtraDamageBonus={state.lastExtraDamageBonus}
              pendingSpellCasts={state.pendingSpellCasts}
              onChangeTarget={(val) => setState((p) => ({ ...p, targetValue: val }))}
              onToggleShowAllSpells={(checked) => setState((p) => ({ ...p, showAllSpells: checked }))}
              onChangeTalentFilter={(val) => setState((p) => ({ ...p, talentFilter: val }))}
              onChangeSkillFilter={(val) => setState((p) => ({ ...p, skillFilter: val }))}
              onUpdatePl={updatePl}
              onChangeRace={handleChangeRace}
              onChangeDiscipline={handleChangeDiscipline}
              onChangeCircle={handleChangeCircle}
              onAdjustAttr={handleAdjustAttr}
              onRollAttr={handleRollAttr}
              onRollInitiative={handleRollPlInitiative}
              onRollQuickCheck={handleRollQuickCheck}
              onKarmaRitual={handleKarmaRitual}
              onHealWoundRest={handleHealWoundRest}
              onToggleOption={handleToggleOption}
              onToggleStatus={handleToggleStatus}
              onRollTalentOrSkill={handleRollTalentOrSkill}
              onRollWeaponDamage={handleRollWeaponDamage}
              onWeaveSpell={handleWeaveSpell}
              onCastSpell={handleCastSpell}
              onRollSpellEffect={handleOpenSpellEffectModal}
              onImportFile={handleImportFile}
              onOpenExport={() => setExportModalOpen(true)}
              onLog={(t, d, ty) => pushLog(t, d, ty)}
            />
          )}

          {state.activeTab === 'gm' && roomSession.role !== 'pl' && (
            <GmMonsterView
              plName={state.pl.name}
              plTargets={gmPlTargets}
              templates={state.monsterTemplates}
              monsters={state.monsters}
              showAddForm={state.showAddMonsterForm}
              onToggleAddForm={() => setState((p) => ({ ...p, showAddMonsterForm: !p.showAddMonsterForm }))}
              onSaveTemplate={(tpl) =>
                setState((p) => ({
                  ...p,
                  monsterTemplates: [...p.monsterTemplates, tpl],
                  showAddMonsterForm: false,
                  logs: [makeLog(`已保存怪物模板【${tpl.name}】`, '', '', '', p.gmBlind), ...p.logs].slice(0, 60),
                }))
              }
              onDeleteTemplate={(id) =>
                setState((p) => ({ ...p, monsterTemplates: p.monsterTemplates.filter((x) => x.id !== id) }))
              }
              onSpawnMonster={handleSpawnMonster}
              onAttackPl={handleMonsterAttackPl}
              onRemoveMonster={(id) =>
                setState((p) => ({
                  ...p,
                  monsters: p.monsters.filter((m) => m.instanceId !== id),
                  initiativeList: p.initiativeList.filter((i) => i.id !== id),
                }))
              }
              onClearMonsters={handleClearMonsters}
              onToggleMonsterFlag={(id, flag) =>
                setState((p) => ({
                  ...p,
                  monsters: p.monsters.map((m) => (m.instanceId === id ? { ...m, [flag]: !m[flag] } : m)),
                }))
              }
              onManualApplyDamage={handleManualApplyDamage}
            />
          )}

          {state.activeTab === 'step' && (
            <StepTableView
              onQuickRollStep={(step) => {
                const res = ED4Engine.rollStepTest(step, { isAction: true, karmaDie: state.pl.karmaDie });
                pushLog(`STEP表快捷掷骰 (Step ${step}) → ${res.total}`, res.trace);
              }}
            />
          )}
        </main>

        {/* 桌面端可拖拽分隔条 */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => setDraggingResizer(true)}
          onTouchStart={() => setDraggingResizer(true)}
          className={`hidden w-1.5 shrink-0 cursor-col-resize border-x border-border transition-colors lg:block ${
            draggingResizer ? 'bg-primary' : 'bg-muted hover:bg-primary/60'
          }`}
        />

        {/* 右侧边栏（桌面固定可调宽度，移动端全宽堆叠） */}
        <aside
          style={{ ['--sidebar-w' as any]: `${sidebarWidth}px` }}
          className="ed4-sidebar w-full shrink-0 border-t border-sidebar-border bg-sidebar p-3 text-sidebar-foreground lg:overflow-y-auto lg:border-t-0"
        >
          <RightSidebar
            round={state.round}
            turnIndex={state.turnIndex}
            initiativeList={state.initiativeList}
            pl={state.pl}
            monsters={state.monsters}
            gmBlind={state.gmBlind}
            pendingReaction={state.pendingReaction}
            logs={state.logs}
            roomSession={roomSession}
            roomCharacters={roomCharacters}
            onRollAllInitiative={handleRollAllInitiative}
            onNextTurn={() =>
              setState((p) => ({
                ...p,
                turnIndex: p.initiativeList.length > 0 ? (p.turnIndex + 1) % p.initiativeList.length : 0,
              }))
            }
            onNextRound={handleNextRound}
            onPartyFullRest={handlePartyFullRest}
            onRemoveMonster={(id) =>
              setState((p) => ({
                ...p,
                monsters: p.monsters.filter((m) => m.instanceId !== id),
                initiativeList: p.initiativeList.filter((i) => i.id !== id),
              }))
            }
            onResolveReaction={handleResolveReaction}
            onRollFreeTest={handleRollFreeTest}
            onClearLogs={() => setState((p) => ({ ...p, logs: [] }))}
          />
        </aside>
      </div>

      <SpellJsonModal
        open={spellJsonOpen}
        onClose={() => setSpellJsonOpen(false)}
        onCopied={() => pushLog('已复制结构化法术 JSON 到剪贴板', '', 'hit')}
      />
      <ManualModal open={manualOpen} onClose={() => setManualOpen(false)} />
      <ExportModal
        open={exportModalOpen}
        characterName={state.pl.name}
        circle={state.pl.circle}
        pdfMode={pdfMode}
        onChangePdfMode={setPdfMode}
        onClose={() => setExportModalOpen(false)}
        onExportTxt={handleExportTxt}
        onCopyTxt={handleCopyTxt}
        onExportExcel={handleExportExcel}
        onExportPdf={handleExportPdf}
      />
      <RoomModal
        open={roomModalOpen}
        session={roomSession}
        initialRoomCode={initialUrlRoom}
        charDefaultName={state.pl.name}
        members={roomCharacters}
        onClose={() => setRoomModalOpen(false)}
        onSelectRole={handleSelectRole}
        onUpdateNickname={(nick) => setRoomSession((prev) => ({ ...prev, nickname: nick }))}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        onLeaveRoom={handleLeaveRoom}
        onCopyInviteLink={(code) => copyPlainText(buildRoomInviteUrl(code))}
      />
      <SpellEffectModal
        open={Boolean(spellEffectModal)}
        spell={
          spellEffectModal
            ? state.pl.spells.find((s: any) => s.instanceId === spellEffectModal.instanceId) || null
            : null
        }
        pl={state.pl}
        pendingCast={spellEffectModal ? state.pendingSpellCasts[spellEffectModal.instanceId] || null : null}
        initialKarma={spellEffectModal?.initialKarma ?? false}
        targetLabel={
          spellEffectModal && state.pendingSpellCasts[spellEffectModal.instanceId]
            ? state.pendingSpellCasts[spellEffectModal.instanceId].targetLabel
            : state.targetValue === 'aoe:all'
              ? '全场存活怪物'
              : state.targetValue.startsWith('m:')
                ? state.monsters.find((m) => m.instanceId === state.targetValue.slice(2))?.name || ''
                : ''
        }
        onClose={() => setSpellEffectModal(null)}
        onConfirm={handleConfirmSpellEffect}
      />
    </div>
    <PrintSheetView pl={state.pl} printMode={pdfMode} />
    </>
  );
}
