import * as XLSX from 'xlsx';
import ED4Engine from './ed4_engine.js';

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
      { id: 't1', name: '近战武器', attr: 'DEX', rank: 2, strain: 0, isAttack: true },
      { id: 't2', name: '回避打击', attr: 'DEX', rank: 2, strain: 1, isAttack: false },
      { id: 't3', name: '机动', attr: 'DEX', rank: 1, strain: 1, isAttack: false },
      { id: 't4', name: '嘲讽', attr: 'CHA', rank: 1, strain: 0, isAttack: false },
      { id: 't5', name: '负伤平衡', attr: 'STR', rank: 1, strain: 0, isAttack: false },
    ],
    skills: [
      { id: 'sk1', category: '通用技能', name: '察觉', attr: 'PER', rank: 1, strain: 0, isAttack: false },
    ],
    weapons: [
      { id: 'w1', name: '阔剑', dmgStep: 5 },
      { id: 'w2', name: '匕首', dmgStep: 2 },
    ],
    spells: [] as any[],
    gear: [] as any[],
    threadItems: [] as any[],
    legend: { total: 0, current: 0, status: '', renown: '', reputation: '' } as any,
    wealth: { copper: 0, silver: 0, gold: 0, other: '' } as any,
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
    logs: [] as any[],
  };
}

// 衍生角色数值（直接调用 ED4Engine.calcPlDerived 并补充界面展示字段）
export function getPlDerivedView(pl: any) {
  const d = ED4Engine.calcPlDerived(pl);
  const remainingPoints = 25 - d.spentPoints;
  const effUncon = Math.max(1, d.uncon - (Number(pl.bloodDamage) || 0));
  const effDeath = Math.max(1, d.death - (Number(pl.bloodDamage) || 0));
  const strIdx = Math.min(30, Math.max(1, d.attrs.STR + (pl.raceId === 'dwarf' ? 2 : 0))) - 1;
  const carry = ED4Engine.CARRY_TABLE[strIdx];
  const durabilityTotal = d.prog.disc.durability * pl.circle + (Number(pl.durabilityBonus) || 0);
  return { ...d, remainingPoints, effUncon, effDeath, carry, durabilityTotal };
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

// 结算怪物受创（复用 ED4Engine.resolveDamage 与 ED4Engine.rollStepTest）
export function applyDamageToMonsterPure(
  monster: any,
  rawDamage: number,
  armorType: 'pa' | 'ma' | 'none' = 'pa',
  isKnockdownOnly = false,
  isStun = false,
  sourceName = ''
) {
  const armor = armorType === 'none' ? 0 : (Number(monster[armorType]) || 0);
  const net = Math.max(0, rawDamage - armor);
  const next = { ...monster };

  if (isKnockdownOnly) {
    if (net > 0) {
      const kdStep = Math.max(1, next.kdStep - next.wounds);
      const kdRes = ED4Engine.rollStepTest(kdStep, { dn: net, isAction: true });
      if (!kdRes.isSuccess) next.knockedDown = true;
      return {
        monster: next,
        log: {
          text: `${sourceName} 对 ${next.name} 发动击倒攻击（击倒难度 ${net}）→ ${kdRes.isSuccess ? '站稳' : '被击倒倒地'}`,
          detail: kdRes.trace,
          type: kdRes.isSuccess ? '' : 'warn',
          blindText: `${sourceName} 对 ${next.name} 发动击倒攻击 → ${kdRes.isSuccess ? '目标站稳' : '目标被击倒'}`,
        },
      };
    }
    return {
      monster: next,
      log: {
        text: `${sourceName} 对 ${next.name} 的击倒攻击被护甲完全抵消`,
        detail: '',
        type: '',
        blindText: '',
      },
    };
  }

  const dmgResult = ED4Engine.resolveDamage({
    rawDamage,
    armor,
    currentDamage: next.currentDamage,
    uncon: Number(next.uncon) || 999,
    death: Number(next.death) || 999,
    woundThreshold: next.woundThreshold,
    isStun,
  });

  next.currentDamage = dmgResult.nextDamage;
  let woundMsg = '';

  if (!isStun && dmgResult.causedWound) {
    next.wounds += 1;
    woundMsg = '，造成 1 处负伤';
    if (dmgResult.net >= next.woundThreshold + 5) {
      const kdDn = dmgResult.net - next.woundThreshold;
      const kdRes = ED4Engine.rollStepTest(Math.max(1, next.kdStep - next.wounds), { dn: kdDn, isAction: true });
      if (!kdRes.isSuccess) {
        next.knockedDown = true;
        woundMsg += '并击倒目标';
      }
    }
  } else if (isStun && dmgResult.causedWound) {
    next.harried = true;
    woundMsg = '，目标陷入受扰';
  }

  const statusFlag = dmgResult.isDead ? '【已死亡】' : (next.uncon !== 'NA' && dmgResult.isUnconscious ? '【意识丧失】' : '');
  return {
    monster: next,
    log: {
      text: `${sourceName} 对 ${next.name} 造成 ${dmgResult.net} 点${isStun ? '震慑' : ''}伤害（原始 ${rawDamage} - 护甲 ${armor}）${woundMsg} ${statusFlag}`,
      detail: `当前累计伤害 ${next.currentDamage} / 死亡 ${next.death}`,
      type: 'hit',
      blindText: `${sourceName} 重创 ${next.name}${woundMsg} ${statusFlag}`,
    },
  };
}

// 结算玩家受创（复用 ED4Engine.resolveDamage 与 ED4Engine.rollStepTest）
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
  const next = { ...pl, statuses: { ...pl.statuses } };
  const wb = next.talents.find((t: any) => t.name.includes('负伤平衡') || t.name.toLowerCase().includes('wound balance'));

  if (isKnockdownOnly) {
    const net = Math.max(0, rawDamage - armor);
    if (net > 0) {
      const kdStep = Math.max(1, d.steps.STR + (wb ? wb.rank : 0) + getEffectiveActionMod(next));
      const kdRes = ED4Engine.rollStepTest(kdStep, { dn: net, isAction: true });
      if (!kdRes.isSuccess) next.statuses.knockedDown = true;
      return {
        pl: next,
        log: {
          text: `${sourceName} 对 ${next.name} 发动击倒攻击（难度 ${net}）→ ${kdRes.isSuccess ? '站稳' : '被击倒倒地'}`,
          detail: kdRes.trace,
          type: kdRes.isSuccess ? '' : 'warn',
        },
      };
    }
    return {
      pl: next,
      log: { text: `${sourceName} 对 ${next.name} 的击倒攻击被护甲抵消`, detail: '', type: '' },
    };
  }

  const dmgResult = ED4Engine.resolveDamage({
    rawDamage,
    armor,
    currentDamage: next.currentDamage,
    uncon: d.effUncon,
    death: d.effDeath,
    woundThreshold: d.woundThreshold,
    isStun,
  });

  next.currentDamage = dmgResult.nextDamage;
  let extra = '';

  if (!isStun && dmgResult.causedWound) {
    next.wounds += 1;
    extra = '，承受 1 处负伤';
    if (dmgResult.net >= d.woundThreshold + 5) {
      const kdDn = dmgResult.net - d.woundThreshold;
      const kdStep = Math.max(1, d.steps.STR + (wb ? wb.rank : 0) + getEffectiveActionMod(next));
      const kdRes = ED4Engine.rollStepTest(kdStep, { dn: kdDn, isAction: true });
      if (!kdRes.isSuccess) {
        next.statuses.knockedDown = true;
        extra += '并被击倒';
      }
    }
  } else if (isStun && dmgResult.causedWound) {
    next.statuses.harried = true;
    extra = '，陷入受扰状态';
  }

  const stateText = dmgResult.isDead ? '【角色死亡】' : (dmgResult.isUnconscious ? '【意识丧失】' : '');
  return {
    pl: next,
    log: {
      text: `${sourceName} 对 ${next.name} 造成 ${dmgResult.net} 点伤害（原始 ${rawDamage} - 护甲 ${armor}）${extra} ${stateText}`,
      detail: `当前伤害 ${next.currentDamage} / 意识丧失 ${d.effUncon} / 死亡 ${d.effDeath}`,
      type: 'fail',
    },
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
  return nextPl;
}

export function formatTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}
