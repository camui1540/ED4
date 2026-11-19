import * as XLSX from 'xlsx';
import ED4Engine from './ed4_engine.js';
import {
  computeActiveBuffModifiers,
  hydrateSpellsWithDb,
  type ActiveBuff,
  type ActiveBuffModifiers,
  type PendingSpellCast,
} from './spellRules';

// 为 ed4_engine.js 中的 parseExcelWorkbook 提供全局 XLSX
(globalThis as any).XLSX = XLSX;

// 创建初始应用状态（扁平对象）
export function createInitialState() {
  const pl = {
    name: '兰达尔',
    raceId: 'tskrang',
    disciplineId: 'swordmaster',
    circle: 1,
    karmaDie: 6,
    gender: '',
    age: '',
    eyeColor: '',
    hairColor: '',
    skinColor: '',
    height: '',
    weight: '',
    portraitUrl: '',
    attrMods: { DEX: 5, STR: 4, TOU: 3, PER: 2, WIL: 1, CHA: 5 } as Record<string, number>,
    durabilityBonus: 0,
    initBonus: 0,
    currentDamage: 0,
    bloodDamage: 0,
    wounds: 0,
    karmaCurrent: 0,
    recoveryCurrent: 0,
    armor: { name: '硬皮甲', pa: 5, ma: 0, initPen: 1 },
    shield: { name: '圆盾', pd: 1, md: 0, initPen: 0 },
    options: {
      aggressive: false,
      defensive: false,
      knockdown: false,
      stun: false,
      splitMove: false,
      tailAttack: false,
    },
    statuses: {
      knockedDown: false,
      blindsided: false,
      surprised: false,
      harried: false,
      reserved: false,
    },
    talents: [
      { id: 't1', name: '近战武器', attr: 'DEX', rank: 2, action: '标准', strain: 0, isAttack: true },
      { id: 't2', name: '回避打击', attr: 'DEX', rank: 2, action: '自由', strain: 1, isAttack: false },
      { id: 't3', name: '机动', attr: 'DEX', rank: 1, action: '简单', strain: 1, isAttack: false },
      { id: 't4', name: '嘲讽', attr: 'CHA', rank: 1, action: '简单', strain: 0, isAttack: false },
      { id: 't5', name: '负伤平衡', attr: 'STR', rank: 1, action: '自由', strain: 0, isAttack: false },
    ],
    skills: [
      { id: 'sk1', category: '通用技能', name: '察觉', attr: 'PER', rank: 1, action: '简单', strain: 0, isAttack: false },
    ],
    weapons: [
      { id: 'w1', name: '阔剑', dmgStep: 5 },
      { id: 'w2', name: '匕首', dmgStep: 2 },
    ],
    spells: [] as any[],
    activeBuffs: [] as ActiveBuff[],
    gear: [] as any[],
    threadItems: [] as any[],
    legend: { total: 0, current: 0, status: '', renown: '', reputation: '' } as any,
    wealth: { copper: 0, silver: 0, gold: 0, other: '' } as any,
    background: '',
  };
  const d = getPlDerivedView(pl);
  pl.karmaCurrent = d.karmaMax;
  pl.recoveryCurrent = d.recoveryMax;

  return {
    activeTab: 'pl' as 'pl' | 'gm' | 'step',
    gmBlind: false,
    round: 1,
    turnIndex: 0,
    showAddMonsterForm: false,
    showAllSpells: false,
    talentFilter: '',
    skillFilter: '',
    lastExtraDamageBonus: 0,
    targetValue: '',
    pl,
    monsterTemplates: [
      { id: 'm1', name: '食尸鬼', initStep: 7, pd: 9, md: 8, sd: 7, pa: 3, ma: 2, atkStep: 10, dmgStep: 11, kdStep: 6, recStep: 6, woundThreshold: 9, uncon: 32, death: 40 },
      { id: 'm2', name: '食尸鬼首领', initStep: 9, pd: 10, md: 9, sd: 9, pa: 4, ma: 3, atkStep: 12, dmgStep: 13, kdStep: 7, recStep: 7, woundThreshold: 10, uncon: 42, death: 52 },
    ],
    monsters: [] as any[],
    initiativeList: [] as any[],
    pendingReaction: null as any,
    pendingSpellCasts: {} as Record<string, PendingSpellCast>,
    logs: [] as any[],
  };
}

// 衍生角色数值（直接调用 ED4Engine.calcPlDerived 并动态叠加当前激活 Buff 增益，不修改基础值）
export function getPlDerivedView(pl: any) {
  const d = ED4Engine.calcPlDerived(pl);
  const activeBuffs: ActiveBuff[] = Array.isArray(pl?.activeBuffs) ? pl.activeBuffs : [];
  const buffBonuses: ActiveBuffModifiers = computeActiveBuffModifiers(activeBuffs, pl);
  const pd = Math.max(1, d.pd + buffBonuses.pd);
  const md = Math.max(1, d.md + buffBonuses.md);
  const sd = Math.max(1, d.sd + buffBonuses.sd);
  const pa = Math.max(0, d.pa + buffBonuses.pa);
  const ma = Math.max(0, d.ma + buffBonuses.ma);
  const initStep = Math.max(1, d.initStep + buffBonuses.init);
  const woundThreshold = Math.max(1, d.woundThreshold + buffBonuses.woundThreshold);
  const moveDisplay = (() => {
    if (!buffBonuses.move) return String(d.race.move);
    if (typeof d.race.move === 'number') return String(d.race.move + buffBonuses.move);
    const parts = String(d.race.move).split('/');
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      return `${Number(parts[0]) + buffBonuses.move}/${Number(parts[1]) + buffBonuses.move}`;
    }
    return `${d.race.move} (+${buffBonuses.move})`;
  })();
  const remainingPoints = 25 - d.spentPoints;
  const effUncon = Math.max(1, d.uncon - (Number(pl.bloodDamage) || 0));
  const effDeath = Math.max(1, d.death - (Number(pl.bloodDamage) || 0));
  const strIdx = Math.min(30, Math.max(1, d.attrs.STR + (pl.raceId === 'dwarf' ? 2 : 0))) - 1;
  const carry = ED4Engine.CARRY_TABLE[strIdx];
  const durabilityTotal = d.prog.disc.durability * pl.circle + (Number(pl.durabilityBonus) || 0);
  return {
    ...d,
    pd,
    md,
    sd,
    pa,
    ma,
    initStep,
    woundThreshold,
    moveDisplay,
    buffBonuses,
    activeBuffs,
    remainingPoints,
    effUncon,
    effDeath,
    carry,
    durabilityTotal,
  };
}

// 动作修正（直接调用 ED4Engine.getPlActionMod）
export function getEffectiveActionMod(pl: any) {
  return ED4Engine.getPlActionMod(pl) - (pl.options.tailAttack ? 2 : 0);
}

// 计算怪物当前有效防御
export function getMonsterEffectiveDef(m: any, type: 'pd' | 'md' | 'sd') {
  let val = Number(m[type]) || 8;
  if (m.knockedDown) val -= 3;
  if (m.blindsided) val -= 2;
  if (m.harried) val -= 2;
  return Math.max(1, val);
}

// 先攻列表排序（先攻值降序，同值 PL 优先，再按敏捷与先攻阶数）
export function sortInitiativeList(list: any[]) {
  return [...list].sort((a, b) => {
    if (b.initVal !== a.initVal) return b.initVal - a.initVal;
    if (a.type !== b.type) return a.type === 'pl' ? -1 : 1;
    if (b.dexVal !== a.dexVal) return b.dexVal - a.dexVal;
    return b.initStep - a.initStep;
  });
}

// 生成战斗怪物实例
export function createMonsterInstance(tpl: any, existingCount: number, totalToAdd: number, idxOffset: number) {
  const suffix = totalToAdd > 1 || existingCount > 0 ? ` #${existingCount + idxOffset + 1}` : '';
  return {
    ...tpl,
    instanceId: `inst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    templateId: tpl.id,
    name: tpl.name + suffix,
    currentDamage: 0,
    wounds: 0,
    knockedDown: false,
    blindsided: false,
    harried: false,
  };
}

// 统一受创、负伤与击倒结算核心（按目标类型分流）
function applyDamageCore(params: {
  targetType: 'monster' | 'pl';
  name: string;
  rawDamage: number;
  armor: number;
  currentDamage: number;
  wounds: number;
  uncon: number;
  death: number;
  woundThreshold: number;
  hasUncon: boolean;
  getKdStep: (nextWounds: number) => number;
  isKnockdownOnly: boolean;
  isStun: boolean;
  sourceName: string;
}) {
  const {
    targetType,
    name,
    rawDamage,
    armor,
    currentDamage,
    wounds,
    uncon,
    death,
    woundThreshold,
    hasUncon,
    getKdStep,
    isKnockdownOnly,
    isStun,
    sourceName,
  } = params;
  const isMonster = targetType === 'monster';

  if (isKnockdownOnly) {
    const net = Math.max(0, rawDamage - armor);
    if (net > 0) {
      const kdRes = ED4Engine.rollStepTest(getKdStep(wounds), { dn: net, isAction: true });
      return {
        nextDamage: currentDamage,
        nextWounds: wounds,
        knockedDown: !kdRes.isSuccess,
        harried: false,
        log: {
          text: `${sourceName} 对 ${name} 发动击倒攻击（${isMonster ? '击倒难度' : '难度'} ${net}）→ ${kdRes.isSuccess ? '站稳' : '被击倒倒地'}`,
          detail: kdRes.trace,
          type: kdRes.isSuccess ? '' : 'warn',
          blindText: isMonster ? `${sourceName} 对 ${name} 发动击倒攻击 → ${kdRes.isSuccess ? '目标站稳' : '目标被击倒'}` : '',
        },
      };
    }
    return {
      nextDamage: currentDamage,
      nextWounds: wounds,
      knockedDown: false,
      harried: false,
      log: {
        text: `${sourceName} 对 ${name} 的击倒攻击被护甲${isMonster ? '完全' : ''}抵消`,
        detail: '',
        type: '',
        blindText: '',
      },
    };
  }

  const dmgResult = ED4Engine.resolveDamage({
    rawDamage,
    armor,
    currentDamage,
    uncon,
    death,
    woundThreshold,
    isStun,
  });

  let nextWounds = wounds;
  let knockedDown = false;
  let harried = false;
  let extra = '';

  if (!isStun && dmgResult.causedWound) {
    nextWounds += 1;
    extra = isMonster ? '，造成 1 处负伤' : '，承受 1 处负伤';
    if (dmgResult.net >= woundThreshold + 5) {
      const kdRes = ED4Engine.rollStepTest(getKdStep(nextWounds), { dn: dmgResult.net - woundThreshold, isAction: true });
      if (!kdRes.isSuccess) {
        knockedDown = true;
        extra += isMonster ? '并击倒目标' : '并被击倒';
      }
    }
  } else if (isStun && dmgResult.causedWound) {
    harried = true;
    extra = isMonster ? '，目标陷入受扰' : '，陷入受扰状态';
  }

  const statusFlag = dmgResult.isDead
    ? (isMonster ? '【已死亡】' : '【角色死亡】')
    : (hasUncon && dmgResult.isUnconscious ? '【意识丧失】' : '');

  return {
    nextDamage: dmgResult.nextDamage,
    nextWounds,
    knockedDown,
    harried,
    log: {
      text: `${sourceName} 对 ${name} 造成 ${dmgResult.net} 点${isMonster && isStun ? '震慑' : ''}伤害（原始 ${rawDamage} - 护甲 ${armor}）${extra} ${statusFlag}`,
      detail: isMonster
        ? `当前累计伤害 ${dmgResult.nextDamage} / 死亡 ${death}`
        : `当前伤害 ${dmgResult.nextDamage} / 意识丧失 ${uncon} / 死亡 ${death}`,
      type: isMonster ? 'hit' : 'fail',
      blindText: isMonster ? `${sourceName} 重创 ${name}${extra} ${statusFlag}` : '',
    },
  };
}

// 结算怪物受创
export function applyDamageToMonsterPure(
  monster: any,
  rawDamage: number,
  armorType: 'pa' | 'ma' | 'none' = 'pa',
  isKnockdownOnly = false,
  isStun = false,
  sourceName = ''
) {
  const armor = armorType === 'none' ? 0 : (Number(monster[armorType]) || 0);
  const res = applyDamageCore({
    targetType: 'monster',
    name: monster.name,
    rawDamage,
    armor,
    currentDamage: monster.currentDamage,
    wounds: monster.wounds,
    uncon: Number(monster.uncon) || 999,
    death: Number(monster.death) || 999,
    woundThreshold: monster.woundThreshold,
    hasUncon: monster.uncon !== 'NA',
    getKdStep: (w) => Math.max(1, monster.kdStep - w),
    isKnockdownOnly,
    isStun,
    sourceName,
  });
  return {
    monster: {
      ...monster,
      currentDamage: res.nextDamage,
      wounds: res.nextWounds,
      knockedDown: monster.knockedDown || res.knockedDown,
      harried: monster.harried || res.harried,
    },
    log: res.log,
  };
}

// 结算玩家受创
export function applyDamageToPlPure(
  pl: any,
  rawDamage: number,
  armorType: 'pa' | 'ma' | 'none' = 'pa',
  isKnockdownOnly = false,
  isStun = false,
  sourceName = ''
) {
  const d = getPlDerivedView(pl);
  const armor = armorType === 'none' ? 0 : (armorType === 'ma' ? d.ma : d.pa);
  const wb = pl.talents.find((t: any) => t.name.includes('负伤平衡') || t.name.toLowerCase().includes('wound balance'));
  const res = applyDamageCore({
    targetType: 'pl',
    name: pl.name,
    rawDamage,
    armor,
    currentDamage: pl.currentDamage,
    wounds: pl.wounds,
    uncon: d.effUncon,
    death: d.effDeath,
    woundThreshold: d.woundThreshold,
    hasUncon: true,
    getKdStep: (w) => Math.max(1, d.steps.STR + (wb ? wb.rank : 0) + getEffectiveActionMod({ ...pl, wounds: w })),
    isKnockdownOnly,
    isStun,
    sourceName,
  });
  return {
    pl: {
      ...pl,
      currentDamage: res.nextDamage,
      wounds: res.nextWounds,
      statuses: {
        ...pl.statuses,
        knockedDown: pl.statuses.knockedDown || res.knockedDown,
        harried: pl.statuses.harried || res.harried,
      },
    },
    log: res.log,
  };
}

// 使用 ED4Engine 归一化导入的角色卡数据，并同步额外导入字段
export function applyImportedCharacter(basePl: any, data: any) {
  const nextPl = ED4Engine.normalizeImportedCharacter(basePl, data);
  if (nextPl.circle >= 9) nextPl.karmaDie = 8;
  if (data.initAdj !== undefined && !isNaN(data.initAdj)) {
    if (data.initAdj < 0) {
      nextPl.armor = { ...nextPl.armor, initPen: Math.abs(data.initAdj) };
      nextPl.initBonus = 0;
    } else {
      nextPl.armor = { ...nextPl.armor, initPen: 0 };
      nextPl.initBonus = data.initAdj;
    }
  }
  if (data.bloodDamage !== undefined && !isNaN(data.bloodDamage)) {
    nextPl.bloodDamage = Number(data.bloodDamage);
  }
  if (data.karmaAvail !== undefined && !isNaN(data.karmaAvail)) {
    nextPl.karmaCurrent = Number(data.karmaAvail);
  }
  nextPl.spells = hydrateSpellsWithDb(nextPl.spells || []);
  return nextPl;
}

export function formatTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}
