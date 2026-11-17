import React, { useRef, useState } from 'react';
import ED4Engine from '../engine/ed4_engine.js';
import { getEffectiveActionMod, getMonsterEffectiveDef, getPlDerivedView } from '../engine/combatHelpers';
import {
  enrichSpellWithDb,
  getExtraThreadRuleInfo,
  type PendingSpellCast,
} from '../engine/spellRules';

interface PlSheetViewProps {
  pl: any;
  monsters: any[];
  gmBlind: boolean;
  targetValue: string;
  showAllSpells: boolean;
  talentFilter: string;
  skillFilter: string;
  lastExtraDamageBonus: number;
  pendingSpellCasts: Record<string, PendingSpellCast>;
  onChangeTarget: (val: string) => void;
  onToggleShowAllSpells: (checked: boolean) => void;
  onChangeTalentFilter: (val: string) => void;
  onChangeSkillFilter: (val: string) => void;
  onUpdatePl: (updater: (prev: any) => any) => void;
  onChangeRace: (raceId: string) => void;
  onChangeDiscipline: (disciplineId: string) => void;
  onChangeCircle: (circle: number) => void;
  onAdjustAttr: (attr: string, delta: number) => void;
  onRollAttr: (attr: string) => void;
  onRollInitiative: () => void;
  onRollQuickCheck: (type: string) => void;
  onKarmaRitual: () => void;
  onHealWoundRest: () => void;
  onToggleOption: (key: string) => void;
  onToggleStatus: (key: string) => void;
  onRollTalentOrSkill: (listType: 'talent' | 'skill', itemId: string, useKarma: boolean) => void;
  onRollWeaponDamage: (weaponId: string) => void;
  onWeaveSpell: (instanceId: string, useKarma: boolean) => void;
  onCastSpell: (instanceId: string, useKarma: boolean, manualTmd?: string) => void;
  onRollSpellEffect: (instanceId: string, useKarma: boolean) => void;
  onImportFile: (file: File) => void;
  onOpenExport: () => void;
  onLog: (text: string, detail?: string, type?: string) => void;
}

const inputCls =
  'h-7 rounded border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none';
const btnCls =
  'inline-flex h-7 items-center justify-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer whitespace-nowrap';
const btnPrimaryCls =
  'inline-flex h-7 items-center justify-center rounded border border-primary bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40 cursor-pointer whitespace-nowrap';
const btnSmCls =
  'inline-flex h-6 items-center justify-center rounded border border-border bg-secondary px-2 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer whitespace-nowrap';
const sectionCls = 'tactile-card p-3';

export function PlSheetView(props: PlSheetViewProps) {
  const {
    pl,
    monsters,
    gmBlind,
    targetValue,
    showAllSpells,
    talentFilter,
    skillFilter,
    lastExtraDamageBonus,
    pendingSpellCasts,
    onChangeTarget,
    onToggleShowAllSpells,
    onChangeTalentFilter,
    onChangeSkillFilter,
    onUpdatePl,
    onChangeRace,
    onChangeDiscipline,
    onChangeCircle,
    onAdjustAttr,
    onRollAttr,
    onRollInitiative,
    onRollQuickCheck,
    onKarmaRitual,
    onHealWoundRest,
    onToggleOption,
    onToggleStatus,
    onRollTalentOrSkill,
    onRollWeaponDamage,
    onWeaveSpell,
    onCastSpell,
    onRollSpellEffect,
    onImportFile,
    onOpenExport,
  } = props;

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 本地复选与表单临时状态
  const [talentKarmaMap, setTalentKarmaMap] = useState<Record<string, boolean>>({});
  const [spellKarmaMap, setSpellKarmaMap] = useState<Record<string, boolean>>({});
  const [spellTmdMap, setSpellTmdMap] = useState<Record<string, string>>({});
  const [draggedSpellId, setDraggedSpellId] = useState<string | null>(null);
  const [dragOverZone, setDragOverZone] = useState<'matrix' | 'grimoire' | null>(null);

  const [newTalent, setNewTalent] = useState({ name: '', attr: 'DEX', rank: 1, strain: 0, isAttack: false });
  const [newSkill, setNewSkill] = useState({ category: '通用技能', name: '', attr: 'PER', rank: 1, strain: 0 });
  const [newWeapon, setNewWeapon] = useState({ name: '', dmgStep: 4 });
  const [selectedDbSpell, setSelectedDbSpell] = useState('');
  const [newGear, setNewGear] = useState({ name: '', rank: '', effect: '' });
  const [newThreadItem, setNewThreadItem] = useState({ name: '', type: '', effect: '' });

  const d = getPlDerivedView(pl);
  const actionMod = getEffectiveActionMod(pl);
  const prog = d.prog;

  const aliveMonsters = monsters.filter((m) => m.currentDamage < m.death);
  const maxMd = aliveMonsters.length > 0 ? Math.max(...aliveMonsters.map((m) => getMonsterEffectiveDef(m, 'md'))) : 0;

  const spellOptions = showAllSpells
    ? ED4Engine.SPELLS_DB
    : ED4Engine.SPELLS_DB.filter((s) => s.discipline === pl.disciplineId && s.circle <= pl.circle);

  const activeSpellSelectValue =
    selectedDbSpell && spellOptions.some((s) => s.id === selectedDbSpell)
      ? selectedDbSpell
      : spellOptions[0]?.id || '';

  const scInfo = ED4Engine.getSpellcastingStep(pl, d);
  const matrixSpells = (pl.spells || []).filter((sp: any) => sp.inMatrix !== false);
  const grimoireSpells = (pl.spells || []).filter((sp: any) => sp.inMatrix === false);

  const bonusTags = [
    `耐久 +${d.durabilityTotal}`,
    prog.pd ? `门类物防 +${prog.pd}` : '',
    prog.md ? `门类秘防 +${prog.md}` : '',
    prog.sd ? `门类社防 +${prog.sd}` : '',
    prog.init ? `门类先攻 +${prog.init}` : '',
    prog.rec ? `门类回复 +${prog.rec}` : '',
    prog.ma ? `门类秘甲 +${prog.ma}` : '',
  ].filter(Boolean);

  // 统一更新装备或脉路物品列表项
  const updateListField = (listKey: 'gear' | 'threadItems', idx: number, field: string, val: any) => {
    onUpdatePl((prev) => {
      const nextList = [...prev[listKey]];
      nextList[idx] = { ...nextList[idx], [field]: val };
      return { ...prev, [listKey]: nextList };
    });
  };

  const removeListIdx = (listKey: 'gear' | 'threadItems', idx: number) => {
    onUpdatePl((prev) => ({
      ...prev,
      [listKey]: prev[listKey].filter((_: any, i: number) => i !== idx),
    }));
  };

  const handleDropZone = (targetInMatrix: boolean, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZone(null);
    const id = draggedSpellId || e.dataTransfer.getData('text/plain');
    if (!id) return;
    onUpdatePl((prev) => ({
      ...prev,
      spells: prev.spells.map((s: any) =>
        s.instanceId === id
          ? { ...s, inMatrix: targetInMatrix, wovenThreads: targetInMatrix ? s.wovenThreads : 0 }
          : s
      ),
    }));
    setDraggedSpellId(null);
  };

  const handleDropOnCard = (targetId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const srcId = draggedSpellId || e.dataTransfer.getData('text/plain');
    setDraggedSpellId(null);
    if (!srcId || srcId === targetId) return;
    onUpdatePl((prev) => {
      const src = prev.spells.find((s: any) => s.instanceId === srcId);
      const dst = prev.spells.find((s: any) => s.instanceId === targetId);
      if (!src || !dst) return prev;
      const srcMatrix = src.inMatrix !== false;
      const dstMatrix = dst.inMatrix !== false;
      return {
        ...prev,
        spells: prev.spells.map((s: any) => {
          if (s.instanceId === srcId) {
            return { ...s, inMatrix: dstMatrix, wovenThreads: dstMatrix ? s.wovenThreads : 0 };
          }
          if (s.instanceId === targetId) {
            return { ...s, inMatrix: srcMatrix, wovenThreads: srcMatrix ? s.wovenThreads : 0 };
          }
          return s;
        }),
      };
    });
  };

  const toggleMatrixSlot = (instanceId: string) => {
    onUpdatePl((prev) => ({
      ...prev,
      spells: prev.spells.map((s: any) =>
        s.instanceId === instanceId
          ? { ...s, inMatrix: s.inMatrix === false, wovenThreads: s.inMatrix === false ? s.wovenThreads : 0 }
          : s
      ),
    }));
  };

  const addTalent = () => {
    const name = newTalent.name.trim();
    if (!name) return;
    onUpdatePl((prev) => ({
      ...prev,
      talents: [...prev.talents, { id: `t_${Date.now()}`, ...newTalent, name }],
    }));
    setNewTalent({ name: '', attr: 'DEX', rank: 1, strain: 0, isAttack: false });
  };

  const addSkill = () => {
    const name = newSkill.name.trim();
    if (!name) return;
    onUpdatePl((prev) => ({
      ...prev,
      skills: [
        ...prev.skills,
        { id: `sk_${Date.now()}`, ...newSkill, name, isAttack: name.includes('武器') || name.includes('攻击') },
      ],
    }));
    setNewSkill({ category: '通用技能', name: '', attr: 'PER', rank: 1, strain: 0 });
  };

  const addWeapon = () => {
    const name = newWeapon.name.trim();
    if (!name) return;
    onUpdatePl((prev) => ({
      ...prev,
      weapons: [...prev.weapons, { id: `w_${Date.now()}`, name, dmgStep: Number(newWeapon.dmgStep) || 0 }],
    }));
    setNewWeapon({ name: '', dmgStep: 4 });
  };

  const addSpellFromDb = () => {
    const tpl = ED4Engine.SPELLS_DB.find((s) => s.id === activeSpellSelectValue);
    if (!tpl) return;
    onUpdatePl((prev) => {
      const matrixCount = (prev.spells || []).filter((s: any) => s.inMatrix !== false).length;
      return {
        ...prev,
        spells: [
          ...prev.spells,
          {
            ...tpl,
            instanceId: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            wovenThreads: 0,
            inMatrix: matrixCount < 3,
          },
        ],
      };
    });
  };

  return (
    <div className="space-y-3">
      {/* 角色头部与属性、战斗衍生数值 */}
      <section className={sectionCls}>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              aria-label="角色名"
              value={pl.name}
              onChange={(e) => onUpdatePl((prev) => ({ ...prev, name: e.target.value }))}
              className={`${inputCls} w-32 font-semibold`}
            />
            <select
              aria-label="种族"
              value={pl.raceId}
              onChange={(e) => onChangeRace(e.target.value)}
              className={`${inputCls} w-24`}
            >
              {Object.entries(ED4Engine.RACES).map(([id, r]: [string, any]) => (
                <option key={id} value={id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select
              aria-label="门类"
              value={pl.disciplineId}
              onChange={(e) => onChangeDiscipline(e.target.value)}
              className={`${inputCls} w-28`}
            >
              {Object.entries(ED4Engine.DISCIPLINES).map(([id, disc]: [string, any]) => (
                <option key={id} value={id}>
                  {disc.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>环数</span>
              <input
                type="number"
                min={1}
                max={15}
                value={pl.circle}
                onChange={(e) => onChangeCircle(Number(e.target.value))}
                className={`${inputCls} w-14 text-center tabular-nums`}
              />
            </label>
            <div className="inline-flex overflow-hidden rounded border border-border font-mono">
              <button
                type="button"
                onClick={() => onUpdatePl((prev) => ({ ...prev, karmaDie: 6 }))}
                className={`h-7 px-2 text-xs cursor-pointer ${
                  pl.karmaDie === 6 ? 'bg-primary font-bold text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                D6
              </button>
              <button
                type="button"
                onClick={() => onUpdatePl((prev) => ({ ...prev, karmaDie: 8 }))}
                className={`h-7 border-l border-border px-2 text-xs cursor-pointer ${
                  pl.karmaDie === 8 ? 'bg-primary font-bold text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                D8
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportFile(file);
                e.target.value = '';
              }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()} className={btnCls}>
              导入角色卡 (.xlsx / .txt)
            </button>
            <button type="button" onClick={onOpenExport} className={btnCls}>
              导出角色卡
            </button>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            剩余属性点：<span className="font-mono font-bold text-foreground">{d.remainingPoints}</span>{' '}
            <span className="font-mono">/ 25</span>
          </div>
        </div>

        {/* 种族与门类特征数据栏 */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2 text-[11px] text-muted-foreground tabular-nums">
          <span>移速 {d.race.move} 码</span>
          <span>负重 {d.carry} 磅</span>
          <span className="text-card-foreground">{d.race.traits}</span>
          {bonusTags.map((b) => (
            <span key={b} className="rounded border border-border bg-background px-1.5 py-0.5 text-foreground">
              {b}
            </span>
          ))}
        </div>

        {/* 六维属性（保留细框线） */}
        <div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {Object.entries(ED4Engine.ATTR_NAMES).map(([k, label]) => (
            <div key={k} className="flex flex-col items-center rounded border border-border bg-background/70 p-2">
              <div className="text-xs font-semibold text-foreground/85">{label}</div>
              <div className="my-0.5 font-mono text-2xl font-bold leading-tight text-foreground tabular-nums">{d.attrs[k]}</div>
              <button
                type="button"
                onClick={() => onRollAttr(k)}
                className="mb-1.5 rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] font-bold text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer tabular-nums"
              >
                Step {d.steps[k]}
              </button>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => onAdjustAttr(k, -1)} className={`${btnSmCls} w-6 px-0`}>
                  -
                </button>
                <span className="min-w-6 text-center font-mono text-[11px] text-muted-foreground tabular-nums">
                  {pl.attrMods[k] >= 0 ? `+${pl.attrMods[k]}` : pl.attrMods[k]}
                </span>
                <button type="button" onClick={() => onAdjustAttr(k, 1)} className={`${btnSmCls} w-6 px-0`}>
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 衍生战斗数值 */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <div className="flex flex-col items-center justify-center rounded border border-border bg-background/70 p-2">
            <div className="text-xs font-semibold text-foreground/85">先攻</div>
            <div className="my-0.5 font-mono text-base font-bold text-foreground tabular-nums">
              Step {Math.max(1, d.initStep + actionMod)}
            </div>
            <button type="button" onClick={onRollInitiative} className={`${btnPrimaryCls} tactile-btn h-6 px-2.5 text-[11px]`}>
              投先攻
            </button>
          </div>
          {[
            ['物理防御', d.pd],
            ['秘法防御', d.md],
            ['社交防御', d.sd],
            ['物理护甲', d.pa],
            ['秘法护甲', d.ma],
          ].map(([label, val]) => (
            <div key={String(label)} className="flex flex-col items-center justify-center rounded border border-border bg-background/70 p-2">
              <div className="text-xs font-semibold text-foreground/85">{label}</div>
              <div className="mt-0.5 font-mono text-2xl font-bold leading-tight text-foreground tabular-nums">{val}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 常用检定 */}
      <section className={sectionCls}>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-serif text-sm font-semibold text-card-foreground">常用检定</span>
          <span className="text-muted-foreground tabular-nums">
            动作修正：{actionMod >= 0 ? `+${actionMod}` : actionMod} Step
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onRollQuickCheck('init')} className={`${btnCls} tactile-btn`}>
            先攻检定
          </button>
          <button type="button" onClick={() => onRollQuickCheck('recovery')} className={`${btnCls} tactile-btn`}>
            回复检定 (Step {Math.max(1, d.steps.TOU - pl.wounds)})
          </button>
          <button type="button" onClick={() => onRollQuickCheck('knockdown')} className={`${btnCls} tactile-btn`}>
            击倒检定
          </button>
          <button type="button" onClick={() => onRollQuickCheck('awareness')} className={`${btnCls} tactile-btn`}>
            察觉 / 防埋伏
          </button>
          <button type="button" onClick={() => onRollQuickCheck('astral')} className={`${btnCls} tactile-btn`}>
            星界感知
          </button>
          <button type="button" onClick={() => onRollQuickCheck('willpower')} className={`${btnCls} tactile-btn`}>
            意志抵抗
          </button>
          <button
            type="button"
            disabled={!pl.statuses.knockedDown}
            onClick={() => onRollQuickCheck('jumpup')}
            className={`${btnCls} tactile-btn`}
          >
            跃起 (2负荷)
          </button>
        </div>
      </section>

      {/* 健康轨与护甲选项 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <section className={sectionCls}>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-1 text-xs">
            <span className="font-serif text-sm font-semibold text-card-foreground">健康轨与资源</span>
            <span className="text-xs font-medium text-foreground/80 tabular-nums">
              意识丧失 <span className="font-mono font-semibold text-foreground">{d.effUncon}</span> / 死亡{' '}
              <span className="font-mono font-semibold text-foreground">{d.effDeath}</span>（负伤阈值{' '}
              <span className="font-mono font-semibold text-foreground">{d.woundThreshold}</span>）
            </span>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded border border-border bg-background/70 p-2">
              <div className="mb-1 text-xs font-semibold text-foreground/85">当前伤害</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onUpdatePl((p) => ({ ...p, currentDamage: Math.max(0, p.currentDamage - 1) }))}
                  className={`${btnSmCls} w-6 px-0`}
                >
                  -
                </button>
                <span className="flex-1 text-center font-mono text-lg font-bold text-foreground tabular-nums">{pl.currentDamage}</span>
                <button
                  type="button"
                  onClick={() => onUpdatePl((p) => ({ ...p, currentDamage: p.currentDamage + 1 }))}
                  className={`${btnSmCls} w-6 px-0`}
                >
                  +
                </button>
              </div>
            </div>
            <div className="rounded border border-border bg-background/70 p-2">
              <div className="mb-1 text-xs font-semibold text-foreground/85">血魔法伤害</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onUpdatePl((p) => ({ ...p, bloodDamage: Math.max(0, p.bloodDamage - 1) }))}
                  className={`${btnSmCls} w-6 px-0`}
                >
                  -
                </button>
                <span className="flex-1 text-center font-mono text-lg font-bold text-foreground tabular-nums">{pl.bloodDamage}</span>
                <button
                  type="button"
                  onClick={() => onUpdatePl((p) => ({ ...p, bloodDamage: p.bloodDamage + 1 }))}
                  className={`${btnSmCls} w-6 px-0`}
                >
                  +
                </button>
              </div>
            </div>
            <div className="rounded border border-border bg-background/70 p-2">
              <div className="mb-1 text-xs font-semibold text-foreground/85">
                负伤 (<span className="font-mono">-{pl.wounds}</span>)
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onUpdatePl((p) => ({ ...p, wounds: Math.max(0, p.wounds - 1) }))}
                  className={`${btnSmCls} w-6 px-0`}
                >
                  -
                </button>
                <span className="flex-1 text-center font-mono text-lg font-bold text-foreground tabular-nums">{pl.wounds}</span>
                <button
                  type="button"
                  onClick={() => onUpdatePl((p) => ({ ...p, wounds: p.wounds + 1 }))}
                  className={`${btnSmCls} w-6 px-0`}
                >
                  +
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
            <span className="font-semibold text-foreground/85">
              业力(<span className="font-mono">D{pl.karmaDie}</span>)：
              <b className="font-mono font-bold text-foreground">{pl.karmaCurrent}/{d.karmaMax}</b>
            </span>
            <button type="button" onClick={onKarmaRitual} className={btnSmCls}>
              业力仪式
            </button>
            <span className="font-semibold text-foreground/85">
              回复：<b className="font-mono font-bold text-foreground">{pl.recoveryCurrent}/{d.recoveryMax}</b>
            </span>
            <button
              type="button"
              disabled={pl.currentDamage > 0 || pl.wounds <= 0 || pl.recoveryCurrent <= 0}
              onClick={onHealWoundRest}
              className={btnSmCls}
            >
              休整消伤
            </button>
          </div>
        </section>

        <section className={sectionCls}>
          <div className="mb-2.5 font-serif text-sm font-semibold text-card-foreground">护甲、盾牌与战斗选项</div>
          <div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground/85">
              <span>物理护甲</span>
              <input
                type="number"
                value={pl.armor.pa}
                onChange={(e) => onUpdatePl((p) => ({ ...p, armor: { ...p.armor, pa: Number(e.target.value) } }))}
                className={`${inputCls} tabular-nums`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground/85">
              <span>护甲先攻减值</span>
              <input
                type="number"
                value={pl.armor.initPen}
                onChange={(e) => onUpdatePl((p) => ({ ...p, armor: { ...p.armor, initPen: Number(e.target.value) } }))}
                className={`${inputCls} tabular-nums`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground/85">
              <span>盾牌物防</span>
              <input
                type="number"
                value={pl.shield.pd}
                onChange={(e) => onUpdatePl((p) => ({ ...p, shield: { ...p.shield, pd: Number(e.target.value) } }))}
                className={`${inputCls} tabular-nums`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-foreground/85">
              <span>先攻修正</span>
              <input
                type="number"
                value={pl.initBonus}
                onChange={(e) => onUpdatePl((p) => ({ ...p, initBonus: Number(e.target.value) }))}
                className={`${inputCls} tabular-nums`}
              />
            </label>
          </div>

          <div className="mb-2 flex flex-wrap gap-1.5">
            {[
              ['aggressive', '猛烈攻击 (+3攻伤/-3防/1负荷)'],
              ['defensive', '防御姿态 (+3防/-3检定)'],
              ['knockdown', '击倒攻击'],
              ['stun', '震慑攻击'],
              ['splitMove', '分散移动 (1负荷)'],
              ...(d.race.canTailAttack ? [['tailAttack', '尾击 (-2检定)']] : []),
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onToggleOption(key)}
                className={`tactile-btn h-6 rounded border px-2 text-[11px] cursor-pointer ${
                  pl.options[key]
                    ? 'border-primary bg-primary font-semibold text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              ['knockedDown', '倒地'],
              ['blindsided', '盲区'],
              ['surprised', '惊愕'],
              ['harried', '受扰'],
              ['reserved', '预留动作'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onToggleStatus(key)}
                className={`tactile-btn h-6 rounded border px-2 text-[11px] cursor-pointer ${
                  pl.statuses[key]
                    ? 'border-primary bg-primary font-semibold text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* 天赋与技能 + 武器伤害 */}
      <section className={sectionCls}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="font-serif text-sm font-semibold text-card-foreground">天赋与技能检定</span>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>当前目标</span>
            <select
              aria-label="当前目标"
              value={targetValue}
              onChange={(e) => onChangeTarget(e.target.value)}
              className={`${inputCls} w-56`}
            >
              <option value="">无指定目标（仅掷骰）</option>
              {aliveMonsters.length > 1 && (
                <option value="aoe:all">
                  群体目标：全场存活怪物 ({aliveMonsters.length}名{gmBlind ? '' : ` · 最高秘防 ${maxMd}`})
                </option>
              )}
              {aliveMonsters.map((m) => (
                <option key={m.instanceId} value={`m:${m.instanceId}`}>
                  {m.name}
                  {gmBlind ? '' : ` (物防 ${getMonsterEffectiveDef(m, 'pd')} / 秘防 ${getMonsterEffectiveDef(m, 'md')})`}
                </option>
              ))}
              <option value="dn:6">固定难度 6</option>
              <option value="dn:10">固定难度 10</option>
              <option value="dn:14">固定难度 14</option>
            </select>
          </label>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* 门类天赋（去盒化无外套框） */}
          <div className="flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-1.5">
              <span className="font-serif text-xs font-semibold text-card-foreground">门类天赋 ({pl.talents.length})</span>
              <input
                type="text"
                placeholder="筛选天赋..."
                value={talentFilter}
                onChange={(e) => onChangeTalentFilter(e.target.value)}
                className={`${inputCls} h-6 w-28 text-[11px]`}
              />
            </div>
            <div className="mb-2 max-h-60 flex-1 overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="py-1 font-medium">天赋</th>
                    <th className="py-1 font-medium">等级</th>
                    <th className="py-1 font-medium">Step</th>
                    <th className="py-1 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pl.talents
                    .filter((t: any) => !talentFilter || t.name.toLowerCase().includes(talentFilter.toLowerCase()))
                    .map((t: any) => {
                      const effStep = Math.max(
                        1,
                        d.steps[t.attr] + t.rank + actionMod + (t.isAttack && pl.options.aggressive ? 3 : 0)
                      );
                      return (
                        <tr key={t.id} className="hover:bg-muted/50">
                          <td className="py-1.5 pr-1">
                            <span className="font-medium text-foreground">{t.name}</span>{' '}
                            <span className="text-[10px] text-muted-foreground">{ED4Engine.ATTR_NAMES[t.attr]}</span>
                            {t.strain ? (
                              <span className="ml-1 rounded border border-border px-1 font-serif text-[10px] text-muted-foreground">
                                负荷{t.strain}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-1 tabular-nums">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdatePl((p) => ({
                                    ...p,
                                    talents: p.talents.map((x: any) => (x.id === t.id ? { ...x, rank: Math.max(1, x.rank - 1) } : x)),
                                  }))
                                }
                                className={`${btnSmCls} h-5 w-5 px-0`}
                              >
                                -
                              </button>
                              <span className="min-w-4 text-center">{t.rank}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdatePl((p) => ({
                                    ...p,
                                    talents: p.talents.map((x: any) => (x.id === t.id ? { ...x, rank: x.rank + 1 } : x)),
                                  }))
                                }
                                className={`${btnSmCls} h-5 w-5 px-0`}
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td className="py-1.5 pr-1 font-mono font-bold text-foreground tabular-nums">Step {effStep}</td>
                          <td className="py-1.5 text-right">
                            <div className="inline-flex items-center gap-1">
                              <label className="inline-flex cursor-pointer items-center gap-0.5 text-[11px] text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={!!talentKarmaMap[t.id]}
                                  onChange={(e) => setTalentKarmaMap((m) => ({ ...m, [t.id]: e.target.checked }))}
                                  className="accent-primary"
                                />
                                业力
                              </label>
                              <button
                                type="button"
                                onClick={() => onRollTalentOrSkill('talent', t.id, !!talentKarmaMap[t.id])}
                                className={`${btnPrimaryCls} h-6 px-2 text-[11px]`}
                              >
                                检定
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdatePl((p) => ({ ...p, talents: p.talents.filter((x: any) => x.id !== t.id) }))
                                }
                                className={`${btnSmCls} h-6 w-6 px-0 text-muted-foreground hover:text-foreground`}
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
              <input
                type="text"
                placeholder="天赋名"
                value={newTalent.name}
                onChange={(e) => setNewTalent((s) => ({ ...s, name: e.target.value }))}
                className={`${inputCls} w-24`}
              />
              <select
                value={newTalent.attr}
                onChange={(e) => setNewTalent((s) => ({ ...s, attr: e.target.value }))}
                className={`${inputCls} w-16`}
              >
                {Object.entries(ED4Engine.ATTR_NAMES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={15}
                value={newTalent.rank}
                onChange={(e) => setNewTalent((s) => ({ ...s, rank: Number(e.target.value) || 1 }))}
                className={`${inputCls} w-12 tabular-nums`}
                title="等级"
              />
              <input
                type="number"
                min={0}
                max={5}
                value={newTalent.strain}
                onChange={(e) => setNewTalent((s) => ({ ...s, strain: Number(e.target.value) || 0 }))}
                className={`${inputCls} w-12 tabular-nums`}
                title="负荷"
              />
              <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={newTalent.isAttack}
                  onChange={(e) => setNewTalent((s) => ({ ...s, isAttack: e.target.checked }))}
                  className="accent-primary"
                />
                攻击
              </label>
              <button type="button" onClick={addTalent} className={btnSmCls}>
                + 天赋
              </button>
            </div>
          </div>

          {/* 角色技能（去盒化无外套框） */}
          <div className="flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-1.5">
              <span className="font-serif text-xs font-semibold text-card-foreground">角色技能 ({(pl.skills || []).length})</span>
              <input
                type="text"
                placeholder="筛选技能..."
                value={skillFilter}
                onChange={(e) => onChangeSkillFilter(e.target.value)}
                className={`${inputCls} h-6 w-28 text-[11px]`}
              />
            </div>
            <div className="mb-2 max-h-60 flex-1 overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="py-1 font-medium">技能</th>
                    <th className="py-1 font-medium">等级</th>
                    <th className="py-1 font-medium">Step</th>
                    <th className="py-1 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(pl.skills || [])
                    .filter((sk: any) => !skillFilter || sk.name.toLowerCase().includes(skillFilter.toLowerCase()))
                    .map((sk: any) => {
                      const effStep = Math.max(
                        1,
                        d.steps[sk.attr] + sk.rank + actionMod + (sk.isAttack && pl.options.aggressive ? 3 : 0)
                      );
                      return (
                        <tr key={sk.id} className="hover:bg-muted/50">
                          <td className="py-1.5 pr-1">
                            {sk.category ? (
                              <span className="mr-1 font-serif text-[10px] text-muted-foreground">[{sk.category.replace('技能', '')}]</span>
                            ) : null}
                            <span className="font-medium text-foreground">{sk.name}</span>{' '}
                            <span className="text-[10px] text-muted-foreground">{ED4Engine.ATTR_NAMES[sk.attr]}</span>
                          </td>
                          <td className="py-1.5 pr-1 tabular-nums">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdatePl((p) => ({
                                    ...p,
                                    skills: p.skills.map((x: any) => (x.id === sk.id ? { ...x, rank: Math.max(1, x.rank - 1) } : x)),
                                  }))
                                }
                                className={`${btnSmCls} h-5 w-5 px-0`}
                              >
                                -
                              </button>
                              <span className="min-w-4 text-center">{sk.rank}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdatePl((p) => ({
                                    ...p,
                                    skills: p.skills.map((x: any) => (x.id === sk.id ? { ...x, rank: x.rank + 1 } : x)),
                                  }))
                                }
                                className={`${btnSmCls} h-5 w-5 px-0`}
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td className="py-1.5 pr-1 font-mono font-bold text-foreground tabular-nums">Step {effStep}</td>
                          <td className="py-1.5 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onRollTalentOrSkill('skill', sk.id, false)}
                                className={btnSmCls}
                              >
                                检定
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdatePl((p) => ({ ...p, skills: p.skills.filter((x: any) => x.id !== sk.id) }))
                                }
                                className={`${btnSmCls} h-6 w-6 px-0 text-muted-foreground hover:text-foreground`}
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {(pl.skills || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-muted-foreground">
                        暂无技能
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
              <select
                value={newSkill.category}
                onChange={(e) => setNewSkill((s) => ({ ...s, category: e.target.value }))}
                className={`${inputCls} w-20`}
              >
                <option value="通用技能">通用</option>
                <option value="知识技能">知识</option>
                <option value="工匠技能">工匠</option>
                <option value="语言技能">语言</option>
              </select>
              <input
                type="text"
                placeholder="技能名"
                value={newSkill.name}
                onChange={(e) => setNewSkill((s) => ({ ...s, name: e.target.value }))}
                className={`${inputCls} w-24`}
              />
              <select
                value={newSkill.attr}
                onChange={(e) => setNewSkill((s) => ({ ...s, attr: e.target.value }))}
                className={`${inputCls} w-16`}
              >
                {Object.entries(ED4Engine.ATTR_NAMES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={15}
                value={newSkill.rank}
                onChange={(e) => setNewSkill((s) => ({ ...s, rank: Number(e.target.value) || 1 }))}
                className={`${inputCls} w-12 tabular-nums`}
              />
              <button type="button" onClick={addSkill} className={btnSmCls}>
                + 技能
              </button>
            </div>
          </div>
        </div>

        {/* 武器伤害 */}
        <div className="mb-1.5 flex items-center justify-between border-t border-border pt-2.5 text-xs">
          <span className="font-serif text-xs font-semibold text-card-foreground">
            武器伤害{lastExtraDamageBonus ? `（额外成功 +${lastExtraDamageBonus}）` : ''}
          </span>
        </div>
        <div className="mb-2 space-y-1.5">
          {pl.weapons.map((w: any) => {
            const dmgStep = Math.max(1, d.steps.STR + w.dmgStep + (pl.options.aggressive ? 3 : 0));
            return (
              <div
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background/70 px-2.5 py-1.5 text-xs"
              >
                <div className="tabular-nums">
                  <span className="font-semibold text-foreground">{w.name}</span>{' '}
                  <span className="text-muted-foreground">基础 <span className="font-mono">+{w.dmgStep}</span></span> ·{' '}
                  <span className="font-semibold text-foreground">
                    伤害 <span className="font-mono font-bold">Step {dmgStep}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onRollWeaponDamage(w.id)} className={btnPrimaryCls}>
                    伤害检定
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdatePl((p) => ({ ...p, weapons: p.weapons.filter((x: any) => x.id !== w.id) }))}
                    className={`${btnSmCls} w-6 px-0 text-muted-foreground hover:text-foreground`}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            placeholder="武器名"
            value={newWeapon.name}
            onChange={(e) => setNewWeapon((s) => ({ ...s, name: e.target.value }))}
            className={`${inputCls} w-32`}
          />
          <input
            type="number"
            min={0}
            max={20}
            value={newWeapon.dmgStep}
            onChange={(e) => setNewWeapon((s) => ({ ...s, dmgStep: Number(e.target.value) || 0 }))}
            className={`${inputCls} w-16 tabular-nums`}
            title="基础伤害Step"
          />
          <button type="button" onClick={addWeapon} className={btnSmCls}>
            + 添加武器
          </button>
        </div>
      </section>

      {/* 法术列表与施放 */}
      <section className={sectionCls}>
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="font-serif text-sm font-semibold text-card-foreground">法术矩阵与法术书</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={showAllSpells}
                onChange={(e) => onToggleShowAllSpells(e.target.checked)}
                className="accent-primary"
              />
              显示全部
            </label>
            <select
              aria-label="选择法术"
              value={activeSpellSelectValue}
              onChange={(e) => setSelectedDbSpell(e.target.value)}
              className={`${inputCls} w-56`}
            >
              {spellOptions.length === 0 ? (
                <option value="">当前门类环数无专属法术</option>
              ) : (
                spellOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    [{s.circle}环 · {ED4Engine.DISCIPLINES[s.discipline]?.name}] {s.nameCn} ({s.nameEn})
                  </option>
                ))
              )}
            </select>
            <button type="button" onClick={addSpellFromDb} disabled={spellOptions.length === 0} className={btnCls}>
              + 录入法术
            </button>
          </div>
        </div>

        {pl.spells && pl.spells.length > 0 ? (
          <div className="space-y-2.5">
            {/* 常备法术矩阵 */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverZone('matrix');
              }}
              onDragLeave={() => setDragOverZone(null)}
              onDrop={(e) => handleDropZone(true, e)}
              className={`rounded border border-dashed p-2.5 transition-colors ${
                dragOverZone === 'matrix' ? 'border-primary bg-primary/10' : 'border-border bg-background/50'
              }`}
            >
              <div className="mb-2 text-[11px] font-semibold text-card-foreground">
                ★ 常备法术矩阵 ({matrixSpells.length})
              </div>
              {matrixSpells.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {matrixSpells.map((rawSp: any) => {
                    const sp = enrichSpellWithDb(rawSp);
                    const rule = getExtraThreadRuleInfo(pl, sp);
                    const spTwInfo = ED4Engine.getThreadWeavingStep(pl, d, sp);
                    const reqThreads = Number(sp.threads) || 0;
                    const curThreads = Number(sp.wovenThreads) || 0;
                    const curExtraThreads = Math.max(0, curThreads - reqThreads);
                    const needWeave = reqThreads > 0 && curThreads < reqThreads;
                    const pendingCast = pendingSpellCasts[sp.instanceId];
                    const showEffBtn =
                      ED4Engine.hasSpellEffectRoll(sp) ||
                      curExtraThreads > 0 ||
                      (pendingCast?.extraThreadsCount ?? 0) > 0 ||
                      (pendingCast?.castingExtraSuccesses ?? 0) > 0;
                    return (
                      <div
                        key={sp.instanceId}
                        draggable
                        onDragStart={(e) => {
                          setDraggedSpellId(sp.instanceId);
                          e.dataTransfer.setData('text/plain', sp.instanceId);
                        }}
                        onDragEnd={() => setDraggedSpellId(null)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => handleDropOnCard(sp.instanceId, e)}
                        className="rounded border border-border bg-card p-2 text-xs text-card-foreground"
                      >
                        <div className="mb-1 flex items-start justify-between gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="cursor-grab text-muted-foreground">⠿</span>
                            <b className="font-serif text-foreground">{sp.nameCn}</b>
                            <span className="rounded border border-border px-1 font-serif text-[10px] text-muted-foreground tabular-nums">
                              {sp.circle}环
                            </span>
                            <span className="text-[11px] font-medium text-foreground tabular-nums">
                              脉路 {curThreads}/{reqThreads}
                              {curExtraThreads > 0 ? (
                                <span className="ml-1 font-mono text-primary">(+{curExtraThreads}额外)</span>
                              ) : null}
                            </span>
                            <span
                              className="rounded border border-border bg-background/60 px-1 font-mono text-[10px] text-muted-foreground tabular-nums"
                              title={
                                rule.reason === 'circle'
                                  ? `${rule.circle}环门类额外脉路上限 +${rule.maxExtra}，总上限 ${rule.maxTotal}`
                                  : rule.reason === 'versatility'
                                    ? '多才多艺/跨门类习得脉路编织，额外脉路上限为 0'
                                    : '该法术无可编入的额外脉路'
                              }
                            >
                              {rule.maxExtra > 0
                                ? `上限 ${rule.maxTotal} (+${rule.maxExtra}额外)`
                                : rule.reason === 'versatility'
                                  ? '多才多艺 额外+0'
                                  : '额外+0'}
                            </span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              编织 {sp.weavingBase}/{sp.weavingHigh}
                            </span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              施法 {sp.castingType === 'fixed' ? sp.castingDn : sp.aoe ? '群体TMD' : 'TMD'}
                            </span>
                            <span className="text-[11px] text-foreground">{sp.effectFormula}</span>
                            {sp.extraEffectStepPerThread === 2 && (
                              <span className="rounded border border-primary/40 bg-primary/10 px-1 font-mono text-[10px] text-primary">
                                +2 STEP/脉路
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleMatrixSlot(sp.instanceId)}
                              className={btnSmCls}
                            >
                              移出
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdatePl((p) => ({
                                  ...p,
                                  spells: p.spells.filter((x: any) => x.instanceId !== sp.instanceId),
                                }))
                              }
                              className={`${btnSmCls} w-6 px-0 text-muted-foreground hover:text-foreground`}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                        <div className="mb-2 font-pixel text-[11px] text-muted-foreground">
                          {sp.range} · {sp.duration}
                          {sp.aoe ? ` · ${sp.aoe}` : ''} — {sp.desc}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={!!spellKarmaMap[sp.instanceId]}
                              onChange={(e) => setSpellKarmaMap((m) => ({ ...m, [sp.instanceId]: e.target.checked }))}
                              className="accent-primary"
                            />
                            业力
                          </label>
                          <button
                            type="button"
                            onClick={() => onWeaveSpell(sp.instanceId, !!spellKarmaMap[sp.instanceId])}
                            className={needWeave ? btnPrimaryCls : btnSmCls}
                          >
                            脉路编织 (Step {spTwInfo.step})
                          </button>
                          <input
                            type="number"
                            min={1}
                            aria-label={`${sp.nameCn} 目标秘法防御 (TMD)`}
                            title="可选：目标秘法防御（TMD），留空则仅掷骰不判成功度"
                            placeholder="TMD"
                            value={spellTmdMap[sp.instanceId] ?? ''}
                            onChange={(e) => setSpellTmdMap((m) => ({ ...m, [sp.instanceId]: e.target.value }))}
                            className={`${inputCls} h-6 w-16 px-1.5 text-center font-mono text-[11px] tabular-nums`}
                          />
                          <button
                            type="button"
                            disabled={needWeave}
                            onClick={() =>
                              onCastSpell(sp.instanceId, !!spellKarmaMap[sp.instanceId], spellTmdMap[sp.instanceId])
                            }
                            className={needWeave ? btnSmCls : btnPrimaryCls}
                          >
                            {needWeave ? `待织 (${curThreads}/${reqThreads})` : `施法 (Step ${scInfo.step})`}
                          </button>
                          {showEffBtn ? (
                            <button
                              type="button"
                              onClick={() => onRollSpellEffect(sp.instanceId, !!spellKarmaMap[sp.instanceId])}
                              className={pendingCast ? btnPrimaryCls : btnSmCls}
                            >
                              结算效果
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">成功即生效</span>
                          )}
                        </div>
                        {pendingCast && (
                          <div className="mt-1.5 rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[11px] text-foreground tabular-nums">
                            待结算：额外脉路 {pendingCast.extraThreadsCount} 条
                            {pendingCast.castingExtraSuccesses > 0
                              ? ` · 施法额外成功 +${pendingCast.castingExtraSuccesses}`
                              : ''}
                            {pendingCast.tmdUsed !== null ? ` (TMD ${pendingCast.tmdUsed})` : ''}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-2 text-xs text-muted-foreground">暂无常备法术，可从下方法术书装入。</div>
              )}
            </div>

            {/* 法术书 */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverZone('grimoire');
              }}
              onDragLeave={() => setDragOverZone(null)}
              onDrop={(e) => handleDropZone(false, e)}
              className={`rounded border border-dashed p-2.5 transition-colors ${
                dragOverZone === 'grimoire' ? 'border-primary bg-primary/10' : 'border-border bg-background/30'
              }`}
            >
              <div className="mb-2 text-[11px] font-semibold text-muted-foreground">法术书 ({grimoireSpells.length})</div>
              {grimoireSpells.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {grimoireSpells.map((sp: any) => (
                    <div
                      key={sp.instanceId}
                      draggable
                      onDragStart={(e) => {
                        setDraggedSpellId(sp.instanceId);
                        e.dataTransfer.setData('text/plain', sp.instanceId);
                      }}
                      onDragEnd={() => setDraggedSpellId(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDropOnCard(sp.instanceId, e)}
                      className="rounded border border-border bg-card/80 p-2 text-xs text-card-foreground"
                    >
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="cursor-grab text-muted-foreground">⠿</span>
                          <b className="font-serif text-foreground">{sp.nameCn}</b>
                          <span className="rounded border border-border px-1 font-serif text-[10px] text-muted-foreground tabular-nums">
                            {sp.circle}环
                          </span>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {sp.threads}脉路 · 编织{sp.weavingBase}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{sp.effectFormula}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button type="button" onClick={() => toggleMatrixSlot(sp.instanceId)} className={btnSmCls}>
                            装入矩阵
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdatePl((p) => ({
                                ...p,
                                spells: p.spells.filter((x: any) => x.instanceId !== sp.instanceId),
                              }))
                            }
                            className={`${btnSmCls} w-6 px-0 text-muted-foreground hover:text-foreground`}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="font-pixel text-[11px] text-muted-foreground">
                        {sp.range} · {sp.duration} — {sp.desc}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-1 text-xs text-muted-foreground">法术书暂无其他法术。</div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">暂未录入法术，可从上方下拉框添加或导入角色卡。</div>
        )}
      </section>

      {/* 装备与脉路物品 + 传说点数与财富 */}
      <section className={sectionCls}>
        <div className="mb-3 font-serif text-sm font-semibold text-card-foreground">装备、脉路物品与财富</div>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {/* 普通装备（去盒化无外套框） */}
          <div className="flex flex-col">
            <div className="mb-2 border-b border-border pb-1.5 font-serif text-xs font-semibold text-card-foreground">
              普通装备与防具 ({pl.gear.length})
            </div>
            <div className="mb-2 max-h-48 flex-1 space-y-1.5 overflow-y-auto">
              {pl.gear.map((g: any, idx: number) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={g.equipped !== false}
                    onChange={(e) => updateListField('gear', idx, 'equipped', e.target.checked)}
                    title="勾选计入面板"
                    className="shrink-0 accent-primary"
                  />
                  <input
                    type="text"
                    value={g.name || ''}
                    onChange={(e) => updateListField('gear', idx, 'name', e.target.value)}
                    placeholder="名称"
                    className={`${inputCls} min-w-0 flex-[2]`}
                  />
                  <input
                    type="text"
                    value={g.rank || ''}
                    onChange={(e) => updateListField('gear', idx, 'rank', e.target.value)}
                    placeholder="等级"
                    className={`${inputCls} w-14`}
                  />
                  <input
                    type="text"
                    value={g.effect || ''}
                    onChange={(e) => updateListField('gear', idx, 'effect', e.target.value)}
                    placeholder="效果"
                    className={`${inputCls} min-w-0 flex-[2]`}
                  />
                  <button
                    type="button"
                    onClick={() => removeListIdx('gear', idx)}
                    className={`${btnSmCls} w-6 shrink-0 px-0 text-muted-foreground hover:text-foreground`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {pl.gear.length === 0 && <div className="text-xs text-muted-foreground">暂无装备</div>}
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
              <input
                type="text"
                placeholder="装备名"
                value={newGear.name}
                onChange={(e) => setNewGear((s) => ({ ...s, name: e.target.value }))}
                className={`${inputCls} w-28`}
              />
              <input
                type="text"
                placeholder="等级"
                value={newGear.rank}
                onChange={(e) => setNewGear((s) => ({ ...s, rank: e.target.value }))}
                className={`${inputCls} w-14`}
              />
              <input
                type="text"
                placeholder="效果(如 物理护甲+4)"
                value={newGear.effect}
                onChange={(e) => setNewGear((s) => ({ ...s, effect: e.target.value }))}
                className={`${inputCls} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => {
                  const name = newGear.name.trim();
                  if (!name) return;
                  onUpdatePl((p) => ({ ...p, gear: [...p.gear, { ...newGear, name, equipped: true }] }));
                  setNewGear({ name: '', rank: '', effect: '' });
                }}
                className={btnSmCls}
              >
                + 装备
              </button>
            </div>
          </div>

          {/* 脉路物品与传说财富（去盒化无外套框） */}
          <div className="flex flex-col">
            <div className="mb-2 border-b border-border pb-1.5 font-serif text-xs font-semibold text-card-foreground">
              脉路物品 ({pl.threadItems.length})
            </div>
            <div className="mb-2 max-h-40 space-y-1.5 overflow-y-auto">
              {pl.threadItems.map((ti: any, idx: number) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={ti.equipped !== false}
                    onChange={(e) => updateListField('threadItems', idx, 'equipped', e.target.checked)}
                    title="勾选计入面板"
                    className="shrink-0 accent-primary"
                  />
                  <input
                    type="text"
                    value={ti.name || ''}
                    onChange={(e) => updateListField('threadItems', idx, 'name', e.target.value)}
                    placeholder="名称"
                    className={`${inputCls} min-w-0 flex-[2]`}
                  />
                  <input
                    type="text"
                    value={ti.type || ''}
                    onChange={(e) => updateListField('threadItems', idx, 'type', e.target.value)}
                    placeholder="类型"
                    className={`${inputCls} w-16`}
                  />
                  <input
                    type="text"
                    value={ti.effect || ''}
                    onChange={(e) => updateListField('threadItems', idx, 'effect', e.target.value)}
                    placeholder="属性/效果"
                    className={`${inputCls} min-w-0 flex-[2]`}
                  />
                  <button
                    type="button"
                    onClick={() => removeListIdx('threadItems', idx)}
                    className={`${btnSmCls} w-6 shrink-0 px-0 text-muted-foreground hover:text-foreground`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {pl.threadItems.length === 0 && <div className="text-xs text-muted-foreground">暂无脉路物品</div>}
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <input
                type="text"
                placeholder="脉路物品名"
                value={newThreadItem.name}
                onChange={(e) => setNewThreadItem((s) => ({ ...s, name: e.target.value }))}
                className={`${inputCls} w-28`}
              />
              <input
                type="text"
                placeholder="类型"
                value={newThreadItem.type}
                onChange={(e) => setNewThreadItem((s) => ({ ...s, type: e.target.value }))}
                className={`${inputCls} w-16`}
              />
              <input
                type="text"
                placeholder="属性加成"
                value={newThreadItem.effect}
                onChange={(e) => setNewThreadItem((s) => ({ ...s, effect: e.target.value }))}
                className={`${inputCls} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => {
                  const name = newThreadItem.name.trim();
                  if (!name) return;
                  onUpdatePl((p) => ({
                    ...p,
                    threadItems: [...p.threadItems, { ...newThreadItem, name, equipped: true }],
                  }));
                  setNewThreadItem({ name: '', type: '', effect: '' });
                }}
                className={btnSmCls}
              >
                + 脉路物品
              </button>
            </div>

            <div className="border-t border-border pt-2.5">
              <div className="mb-1.5 font-serif text-xs font-semibold text-muted-foreground">传说点数与财富</div>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  <span>传说总计</span>
                  <input
                    type="text"
                    value={pl.legend?.total ?? ''}
                    onChange={(e) => onUpdatePl((p) => ({ ...p, legend: { ...p.legend, total: e.target.value } }))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  <span>现有传说</span>
                  <input
                    type="text"
                    value={pl.legend?.current ?? ''}
                    onChange={(e) => onUpdatePl((p) => ({ ...p, legend: { ...p.legend, current: e.target.value } }))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  <span>名望 / 声誉</span>
                  <input
                    type="text"
                    value={pl.legend?.renown ?? ''}
                    onChange={(e) => onUpdatePl((p) => ({ ...p, legend: { ...p.legend, renown: e.target.value } }))}
                    className={inputCls}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  <span>金币</span>
                  <input
                    type="text"
                    value={pl.wealth?.gold ?? 0}
                    onChange={(e) => onUpdatePl((p) => ({ ...p, wealth: { ...p.wealth, gold: e.target.value } }))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  <span>银币</span>
                  <input
                    type="text"
                    value={pl.wealth?.silver ?? 0}
                    onChange={(e) => onUpdatePl((p) => ({ ...p, wealth: { ...p.wealth, silver: e.target.value } }))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
                <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                  <span>铜币</span>
                  <input
                    type="text"
                    value={pl.wealth?.copper ?? 0}
                    onChange={(e) => onUpdatePl((p) => ({ ...p, wealth: { ...p.wealth, copper: e.target.value } }))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 人物背景 */}
      <section className={sectionCls}>
        <div className="mb-2 font-serif text-sm font-semibold text-card-foreground">人物背景</div>
        <textarea
          aria-label="人物背景"
          rows={5}
          value={pl.background || ''}
          onChange={(e) => onUpdatePl((p) => ({ ...p, background: e.target.value }))}
          placeholder="填写角色出身、经历、外貌特征与羁绊..."
          className="field-sizing-content font-pixel min-h-28 max-h-96 w-full resize-y overflow-y-auto rounded border border-input bg-background/70 p-2.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
      </section>
    </div>
  );
}
