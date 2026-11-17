import ED4Engine from './ed4_engine.js';

export type ExtraThreadCapReason = 'empty' | 'versatility' | 'circle';
export type DurationUnit = '轮' | '分钟' | '小时' | '天' | '周' | '月' | '年' | '';
export type BuffTargetKind = 'character' | 'weapon' | 'shield';

export interface ExtraThreadRuleInfo {
  baseThreads: number;
  maxExtra: number;
  maxTotal: number;
  reason: ExtraThreadCapReason;
  isVersatility: boolean;
  circle: number;
  extraThreadsOptions: string[];
  extraEffectStepPerThread: number;
}

export interface WeaveRollResolution {
  nextWoven: number;
  actualGained: number;
  overflowed: boolean;
  overflowAmount: number;
  extraThreadsCount: number;
  maxTotalThreads: number;
  logText: string;
}

export interface PendingSpellCast {
  instanceId: string;
  extraThreadsCount: number;
  castingExtraSuccesses: number;
  tmdUsed: number | null;
  targetLabel: string;
}

export interface SpellDurationPlan {
  rawDuration: string;
  baseValue: number | null;
  baseUnit: DurationUnit;
  finalUnit: DurationUnit;
  unitUpgradedToMinutes: boolean;
  extraThreadAdded: number;
  castingExtraAdded: number;
  totalAdded: number;
  finalValue: number | null;
  hasExtension: boolean;
  baseDisplay: string;
  finalDisplay: string;
  summaryText: string;
}

export interface ActiveBuffModifiers {
  pa: number;
  ma: number;
  pd: number;
  md: number;
  sd: number;
  init: number;
  move: number;
  woundThreshold: number;
  meleeAtk: number;
  rangedAtk: number;
  allAtk: number;
  meleeDmgStep: number;
  rangedDmgStep: number;
  allDmgStep: number;
  weaponExtraDieStep: number;
  weaponExtraDieElement: string;
  notes: string[];
}

export interface ActiveBuff {
  id: string;
  spellId: string;
  nameCn: string;
  targetKind: BuffTargetKind;
  targetItemId?: string;
  targetItemName?: string;
  effectSummary: string;
  durationText: string;
  extraThreadsCount: number;
  selectedExtraOptions: string[];
  modifiers: ActiveBuffModifiers;
}

export interface SpellEffectPlan {
  hasBaseRoll: boolean;
  baseFormula: string;
  baseStep: number | null;
  willforceRank: number;
  willforceStrain: number;
  supportsStepBoost: boolean;
  supportsCastingExtraStep: boolean;
  extraThreadsCount: number;
  selectedExtraOptions: string[];
  stepEnhanceCount: number;
  extraThreadStepBonus: number;
  castingExtraSuccesses: number;
  castingExtraStepBonus: number;
  totalBonusStep: number;
  finalStep: number | null;
  nonStepTags: Array<{ label: string; count: number }>;
  effectEnhancements: Array<{ label: string; count: number }>;
  durationPlan: SpellDurationPlan;
  playerSummaryText: string;
  breakdownText: string;
  tagsText: string;
}

export function emptyBuffModifiers(): ActiveBuffModifiers {
  return {
    pa: 0,
    ma: 0,
    pd: 0,
    md: 0,
    sd: 0,
    init: 0,
    move: 0,
    woundThreshold: 0,
    meleeAtk: 0,
    rangedAtk: 0,
    allAtk: 0,
    meleeDmgStep: 0,
    rangedDmgStep: 0,
    allDmgStep: 0,
    weaponExtraDieStep: 0,
    weaponExtraDieElement: '',
    notes: [],
  };
}

export function enrichSpellWithDb<T extends Record<string, any>>(
  sp: T
): T & Record<string, any> & { extraThreads: string[]; extraEffectStepPerThread: number } {
  if (!sp || typeof sp !== 'object') {
    return sp as T & Record<string, any> & { extraThreads: string[]; extraEffectStepPerThread: number };
  }
  const mappedId = sp.id && ED4Engine.LEGACY_SPELL_ID_MAP ? ED4Engine.LEGACY_SPELL_ID_MAP[sp.id] || sp.id : sp.id;
  const dbById = mappedId ? ED4Engine.SPELLS_DB.find((item: any) => item.id === mappedId) : null;
  const dbMatch = dbById || ED4Engine.findSpellInDb(sp.nameCn || sp.name || sp.nameEn || '');
  if (dbMatch && sp.matchedDb !== false) {
    return {
      ...dbMatch,
      ...sp,
      id: dbMatch.id,
      nameCn: dbMatch.nameCn || dbMatch.name || sp.nameCn,
      discipline: dbMatch.discipline || sp.discipline,
      threads: dbMatch.threads ?? sp.threads,
      weavingBase: dbMatch.weavingBase ?? sp.weavingBase,
      weavingHigh: dbMatch.weavingHigh ?? sp.weavingHigh,
      castingType: dbMatch.castingType ?? sp.castingType,
      castingDn: dbMatch.castingDn ?? sp.castingDn,
      range: dbMatch.range ?? sp.range,
      duration: dbMatch.duration ?? sp.duration,
      aoe: dbMatch.aoe ?? sp.aoe,
      effectFormula: dbMatch.effectFormula ?? sp.effectFormula,
      effectType: dbMatch.effectType ?? sp.effectType,
      armorType: dbMatch.armorType ?? sp.armorType,
      effectStepBonus: dbMatch.effectStepBonus ?? null,
      usesCircleAsBase: Boolean(dbMatch.usesCircleAsBase),
      successLevelType: dbMatch.successLevelType ?? null,
      successLevelValue: dbMatch.successLevelValue ?? 0,
      successLevelUnit: dbMatch.successLevelUnit ?? null,
      desc: dbMatch.desc || dbMatch.description || sp.desc || '',
      extraThreads: Array.isArray(dbMatch.extraThreads) ? dbMatch.extraThreads : [],
      extraEffectStepPerThread:
        typeof dbMatch.extraEffectStepPerThread === 'number' ? dbMatch.extraEffectStepPerThread : 0,
    };
  }
  return {
    ...sp,
    nameCn: sp.nameCn || sp.name || '',
    extraThreads: Array.isArray(sp.extraThreads) ? sp.extraThreads : [],
    extraEffectStepPerThread: Number(sp.extraEffectStepPerThread) || 0,
  };
}

export function hydrateSpellsWithDb(spells: any[] = []): any[] {
  return (spells || []).map((sp) => enrichSpellWithDb(sp));
}

export function getCircleExtraThreadCap(circle: number): number {
  const c = Math.max(1, Math.min(15, Math.floor(Number(circle) || 1)));
  if (c <= 4) return 1;
  if (c <= 8) return 2;
  if (c <= 12) return 3;
  return 4;
}

export function isVersatilityWeaving(pl: any, spell: any): boolean {
  const sp = enrichSpellWithDb(spell);
  const plDiscId = pl?.disciplineId;
  const plDisc = ED4Engine.DISCIPLINES[plDiscId];
  const spellDiscId = sp?.discipline;

  if (!plDisc || !plDisc.isCaster) return true;
  if (spellDiscId && ED4Engine.DISCIPLINES[spellDiscId] && spellDiscId !== plDiscId) return true;

  const talents: any[] = Array.isArray(pl?.talents) ? pl.talents : [];
  const discWeaving = plDisc.weavingName ? String(plDisc.weavingName).toLowerCase() : '';
  const matchedTalent =
    (discWeaving && talents.find((t) => String(t?.name || '').toLowerCase().includes(discWeaving))) ||
    talents.find((t) => {
      const nm = String(t?.name || '').toLowerCase();
      return nm.includes('编织') || ED4Engine.WEAVING_KEYWORDS.some((k: string) => nm.includes(k));
    });

  if (matchedTalent) {
    const nm = String(matchedTalent.name || '').toLowerCase();
    if (matchedTalent.isVersatility || nm.includes('多才多艺') || nm.includes('versatility')) {
      return true;
    }
  }

  return false;
}

export function getExtraThreadRuleInfo(pl: any, spell: any): ExtraThreadRuleInfo {
  const sp = enrichSpellWithDb(spell);
  const baseThreads = Math.max(0, Number(sp?.threads) || 0);
  const extraThreadsOptions: string[] = Array.isArray(sp?.extraThreads) ? sp.extraThreads : [];
  const extraEffectStepPerThread = Number(sp?.extraEffectStepPerThread) || 0;
  const circle = Math.max(1, Math.min(15, Math.floor(Number(pl?.circle) || 1)));

  if (extraThreadsOptions.length === 0) {
    return {
      baseThreads,
      maxExtra: 0,
      maxTotal: baseThreads,
      reason: 'empty',
      isVersatility: false,
      circle,
      extraThreadsOptions,
      extraEffectStepPerThread,
    };
  }

  const versatility = isVersatilityWeaving(pl, sp);
  if (versatility) {
    return {
      baseThreads,
      maxExtra: 0,
      maxTotal: baseThreads,
      reason: 'versatility',
      isVersatility: true,
      circle,
      extraThreadsOptions,
      extraEffectStepPerThread,
    };
  }

  const maxExtra = getCircleExtraThreadCap(circle);
  return {
    baseThreads,
    maxExtra,
    maxTotal: baseThreads + maxExtra,
    reason: 'circle',
    isVersatility: false,
    circle,
    extraThreadsOptions,
    extraEffectStepPerThread,
  };
}

export function resolveWeavingRollOutcome(params: {
  currentWoven: number;
  gained: number;
  rule: ExtraThreadRuleInfo;
}): WeaveRollResolution {
  const { currentWoven, gained, rule } = params;
  const safeCur = Math.max(0, Number(currentWoven) || 0);
  const safeGained = Math.max(0, Number(gained) || 0);
  const rawNext = safeCur + safeGained;
  const overflowed = rawNext > rule.maxTotal;
  const nextWoven = Math.min(rule.maxTotal, rawNext);
  const actualGained = Math.max(0, nextWoven - safeCur);
  const overflowAmount = Math.max(0, rawNext - rule.maxTotal);
  const extraThreadsCount = Math.max(0, nextWoven - rule.baseThreads);

  let logText: string;
  if (overflowed) {
    if (rule.reason === 'circle') {
      logText = `成功，已达 ${rule.circle} 环额外脉路上限 ${nextWoven}/${rule.baseThreads}，溢出成功度作废`;
    } else if (rule.reason === 'versatility') {
      logText = `成功，已达多才多艺额外脉路上限 ${nextWoven}/${rule.baseThreads}（上限 +0），溢出成功度作废`;
    } else {
      logText = `成功，已达额外脉路上限 ${nextWoven}/${rule.baseThreads}（无额外脉路可编入），溢出成功度作废`;
    }
  } else {
    const extraHint = extraThreadsCount > 0 ? `，含额外脉路 ${extraThreadsCount} 条` : '';
    logText = `成功 (+${safeGained}，当前 ${nextWoven}/${rule.baseThreads}${extraHint})`;
  }

  return {
    nextWoven,
    actualGained,
    overflowed,
    overflowAmount,
    extraThreadsCount,
    maxTotalThreads: rule.maxTotal,
    logText,
  };
}

export function resolveCastingDn(params: {
  spell: any;
  manualTmd?: string | number | null;
  targetValue?: string;
  monsters?: any[];
  getMonsterMd?: (monster: any) => number;
}): { dn: number | null; targetLabel: string; source: 'manual' | 'fixed' | 'target' | 'none' } {
  const { spell, manualTmd, targetValue = '', monsters = [], getMonsterMd } = params;

  if (manualTmd !== undefined && manualTmd !== null && String(manualTmd).trim() !== '') {
    const num = Number(String(manualTmd).trim());
    if (Number.isFinite(num)) {
      return { dn: num, targetLabel: `TMD ${num}`, source: 'manual' };
    }
  }

  if (spell?.castingType === 'fixed') {
    const fixedDn = Number(spell.castingDn) || 6;
    return { dn: fixedDn, targetLabel: `固定难度 ${fixedDn}`, source: 'fixed' };
  }

  if (targetValue === 'aoe:all') {
    const alive = (monsters || []).filter((m) => m.currentDamage < m.death);
    if (alive.length > 0) {
      const mds = alive.map((m) => (getMonsterMd ? getMonsterMd(m) : Number(m.md) || 8));
      const maxMd = Math.max(...mds);
      return {
        dn: maxMd,
        targetLabel: `全场敌方 (${alive.length}名，最高秘防 ${maxMd})`,
        source: 'target',
      };
    }
  } else if (targetValue.startsWith('m:')) {
    const m = (monsters || []).find((x) => x.instanceId === targetValue.slice(2));
    if (m) {
      const md = getMonsterMd ? getMonsterMd(m) : Number(m.md) || 8;
      return { dn: md, targetLabel: m.name, source: 'target' };
    }
  } else if (targetValue.startsWith('dn:')) {
    const dnVal = Number(targetValue.slice(3));
    if (Number.isFinite(dnVal)) {
      return { dn: dnVal, targetLabel: `固定难度 ${dnVal}`, source: 'target' };
    }
  }

  return { dn: null, targetLabel: '无指定目标', source: 'none' };
}

export function isStepEnhancementOption(optionText: string): boolean {
  const s = String(optionText || '').trim();
  if (!s) return false;
  return (
    s.includes('效果阶数') ||
    /效果\s*step/i.test(s) ||
    /伤害\s*step/i.test(s) ||
    /\+\s*2\s*(?:效果|伤害)?\s*step/i.test(s)
  );
}

export function getExtraThreadBadgeLabel(optionText: string, supportsStepBoost: boolean): string {
  const s = String(optionText || '').trim();
  if (supportsStepBoost && isStepEnhancementOption(s)) return '+2 STEP';
  if (s.includes('持续时间')) return '持续延长';
  if (s.includes('扩大范围') || s.includes('扩大区域')) return '范围扩展';
  if (s.includes('额外目标') || s.includes('移除目标')) return '目标扩展';
  if (s.includes('增强效果')) return '效果强化';
  return '生效强化';
}

export function parseBaseSpellEffectStep(
  spellOrFormula: any,
  pl: any,
  derived: any
): { hasBaseRoll: boolean; baseStep: number | null; willforceRank: number } {
  const spObj = spellOrFormula && typeof spellOrFormula === 'object' ? enrichSpellWithDb(spellOrFormula) : null;
  const formulaRaw = spObj ? String(spObj.effectFormula || '') : String(spellOrFormula || '');
  const f = formulaRaw.trim().toUpperCase();

  // Weapon enchantment buffs (火焰武器 / 夜之锋芒) do not roll an effect Step at cast time
  if (
    spObj &&
    spObj.effectType === 'buff' &&
    (spObj.effectStepBonus === null || spObj.effectStepBonus === undefined) &&
    !spObj.usesCircleAsBase
  ) {
    return { hasBaseRoll: false, baseStep: null, willforceRank: 0 };
  }

  const willforce = (pl?.talents || []).find(
    (t: any) => String(t?.name || '').includes('意志力') || String(t?.name || '').toLowerCase().includes('willforce')
  );
  const willforceRank = willforce ? Number(willforce.rank) || 0 : 0;
  const wilStep = Number(derived?.steps?.WIL ?? ED4Engine.attrToStep(10)) || 5;
  const baseWilStep = wilStep + willforceRank;
  const circle = Math.max(1, Number(pl?.circle) || 1);

  if (spObj) {
    // Combined WIL + Circle (e.g. 约束实体 "意志+下界术士环数")
    if ((/WIL|意志/.test(f) && (/CIRCLE|环数/.test(f)))) {
      return { hasBaseRoll: true, baseStep: baseWilStep + circle, willforceRank };
    }
    if (spObj.usesCircleAsBase) {
      const bonus = Number(spObj.effectStepBonus) || (Number((f.match(/(?:CIRCLE|环数)\s*\+\s*(\d+)/) || [])[1]) || 0);
      return { hasBaseRoll: true, baseStep: circle + bonus, willforceRank: 0 };
    }
    if (spObj.effectStepBonus !== null && spObj.effectStepBonus !== undefined) {
      return { hasBaseRoll: true, baseStep: baseWilStep + Number(spObj.effectStepBonus), willforceRank };
    }
  }

  if (!f) return { hasBaseRoll: false, baseStep: null, willforceRank: 0 };

  if (/(?:WIL|意志)\s*\+\s*(?:.*(?:CIRCLE|环数))/.test(f)) {
    return { hasBaseRoll: true, baseStep: baseWilStep + circle, willforceRank };
  }

  const mWilPlus = f.match(/(?:WIL|意志)\s*\+\s*(\d+)/);
  if (mWilPlus) {
    return { hasBaseRoll: true, baseStep: baseWilStep + Number(mWilPlus[1]), willforceRank };
  }

  if (/\bWIL\b/.test(f) || f.includes('意志')) {
    // Avoid matching descriptive buff text like "抵抗恐惧时的意志检定" unless standalone formula
    if (!spObj || spObj.effectType !== 'buff') {
      return { hasBaseRoll: true, baseStep: baseWilStep, willforceRank };
    }
  }

  const mCirPlus = f.match(/(?:CIRCLE|环数)\s*\+\s*(\d+)/);
  if (mCirPlus) {
    return { hasBaseRoll: true, baseStep: circle + Number(mCirPlus[1]), willforceRank: 0 };
  }

  return { hasBaseRoll: false, baseStep: null, willforceRank: 0 };
}

function parseBaseDurationSpec(
  rawDuration: string,
  spellcastingRank: number
): { baseValue: number | null; unit: DurationUnit; baseDisplay: string } {
  const raw = String(rawDuration || '').trim();
  const clean = raw.replace(/（见文本）|\(见文本\)/g, '').replace(/\s+/g, '');
  if (!clean || clean === '-' || clean === '见说明' || clean.includes('可变') || clean === '一年零一天') {
    return { baseValue: null, unit: '', baseDisplay: raw || '见说明' };
  }

  const unitMatch = clean.match(/(轮|分钟|小时|天|周|月|年)$/);
  const unit: DurationUnit = unitMatch ? (unitMatch[1] as DurationUnit) : '';
  const hasRankToken = clean.includes('等级数') || clean.includes('等级') || clean.includes('轮数');

  if (!unit) {
    return { baseValue: null, unit: '', baseDisplay: raw };
  }

  const body = clean.slice(0, -unit.length);

  // Pure numeric (e.g. "2轮", "10小时")
  if (/^\d+$/.test(body)) {
    const val = Number(body);
    return { baseValue: val, unit, baseDisplay: `${val} ${unit}` };
  }

  if (hasRankToken) {
    const mulMatch = body.match(/^(\d+)\s*[×*x]\s*(?:等级数|等级)$/) || body.match(/^(?:等级数|等级)\s*[×*x]\s*(\d+)$/);
    const addMatch = body.match(/^(?:等级数|等级|轮数)\s*\+\s*(\d+)$/);
    const plainRank = /^(?:等级数|等级)$/.test(body);

    if (spellcastingRank > 0) {
      let val = spellcastingRank;
      if (mulMatch) val = spellcastingRank * Number(mulMatch[1]);
      else if (addMatch) val = spellcastingRank + Number(addMatch[1]);
      else if (!plainRank) val = spellcastingRank;
      return { baseValue: val, unit, baseDisplay: `${val} ${unit}` };
    }

    return { baseValue: null, unit, baseDisplay: raw };
  }

  return { baseValue: null, unit, baseDisplay: raw };
}

function parseExtraThreadDurationChoice(opt: string): {
  upgradeToMinutes: boolean;
  addAmount: number;
  addUnit: DurationUnit;
} {
  const s = String(opt || '').replace(/\s+/g, '');
  if (!s.includes('持续时间')) {
    return { upgradeToMinutes: false, addAmount: 0, addUnit: '' };
  }
  if (s === '提高持续时间（分钟）' || s === '提高持续时间(分钟)') {
    return { upgradeToMinutes: true, addAmount: 0, addUnit: '分钟' };
  }
  const m = s.match(/\+(\d+)(轮数|轮|分钟|小时|天|周|月)/);
  if (m) {
    const u = m[2] === '轮数' ? '轮' : (m[2] as DurationUnit);
    return { upgradeToMinutes: false, addAmount: Number(m[1]), addUnit: u };
  }
  return { upgradeToMinutes: false, addAmount: 0, addUnit: '' };
}

export function computeSpellDurationPlan(params: {
  spell: any;
  spellcastingRank: number;
  selectedExtraOptions?: string[];
  castingExtraSuccesses?: number;
  supportsCastingExtraStep?: boolean;
}): SpellDurationPlan {
  const sp = enrichSpellWithDb(params.spell);
  const rawDuration = String(sp?.duration || '').trim() || '-';
  const scRank = Math.max(0, Math.floor(Number(params.spellcastingRank) || 0));
  const castingExtra = Math.max(0, Math.floor(Number(params.castingExtraSuccesses) || 0));
  const selectedOpts = params.selectedExtraOptions || [];

  const { baseValue, unit, baseDisplay } = parseBaseDurationSpec(rawDuration, scRank);

  let finalUnit: DurationUnit = unit;
  let unitUpgradedToMinutes = false;
  let extraThreadAdded = 0;

  let minuteUpgradeCount = 0;
  for (const opt of selectedOpts) {
    const parsed = parseExtraThreadDurationChoice(opt);
    if (parsed.upgradeToMinutes) {
      minuteUpgradeCount += 1;
    } else if (parsed.addAmount > 0 && (!unit || parsed.addUnit === unit || parsed.addUnit === finalUnit)) {
      extraThreadAdded += parsed.addAmount;
    }
  }

  if (minuteUpgradeCount > 0 && unit === '轮') {
    unitUpgradedToMinutes = true;
    finalUnit = '分钟';
    if (minuteUpgradeCount > 1) {
      extraThreadAdded += (minuteUpgradeCount - 1) * 2;
    }
  } else if (minuteUpgradeCount > 0 && unit === '分钟') {
    extraThreadAdded += minuteUpgradeCount * 2;
  }

  // Casting extra successes extend duration when duration uses time units 轮 / 分钟 / 小时
  // and casting extra successes are not spent on damage/effect-step boost
  const isTimeUnitForExtraSuccess = finalUnit === '轮' || finalUnit === '分钟' || finalUnit === '小时';
  let perSuccessDur = 2;
  if (sp?.successLevelType === 'duration' && Number(sp?.successLevelValue) > 0) {
    const slUnit = String(sp.successLevelUnit || '').toLowerCase();
    const mappedSlUnit: DurationUnit =
      slUnit.startsWith('round') ? '轮' : slUnit.startsWith('min') ? '分钟' : slUnit.startsWith('hour') ? '小时' : '';
    if (!mappedSlUnit || mappedSlUnit === finalUnit || unitUpgradedToMinutes) {
      perSuccessDur = Number(sp.successLevelValue);
    }
  }
  const castingExtraAdded =
    castingExtra > 0 && isTimeUnitForExtraSuccess && !params.supportsCastingExtraStep
      ? castingExtra * perSuccessDur
      : 0;

  const totalAdded = extraThreadAdded + castingExtraAdded;
  const hasExtension = unitUpgradedToMinutes || totalAdded > 0;
  const finalValue = baseValue !== null ? baseValue + totalAdded : null;

  let finalDisplay = baseDisplay;
  if (hasExtension) {
    if (finalValue !== null && finalUnit) {
      finalDisplay = `${finalValue} ${finalUnit}`;
    } else if (finalUnit) {
      const plusStr = totalAdded > 0 ? ` + ${totalAdded} ${finalUnit}` : '';
      finalDisplay = unitUpgradedToMinutes ? `${rawDuration}（转${finalUnit}${plusStr}）` : `${rawDuration}${plusStr}`;
    }
  }

  let summaryText = `持续时间：${baseDisplay}`;
  if (hasExtension) {
    const reasons: string[] = [`基础 ${baseDisplay}`];
    if (unitUpgradedToMinutes) {
      reasons.push('额外脉路 单位升为分钟');
    }
    if (extraThreadAdded > 0) {
      reasons.push(`额外脉路 +${extraThreadAdded} ${finalUnit}`);
    }
    if (castingExtraAdded > 0) {
      reasons.push(`施法额外成功 +${castingExtraAdded} ${finalUnit}`);
    }
    summaryText = `持续时间：${baseDisplay} → ${finalDisplay}（${reasons.join(' + ')}）`;
  }

  return {
    rawDuration,
    baseValue,
    baseUnit: unit,
    finalUnit,
    unitUpgradedToMinutes,
    extraThreadAdded,
    castingExtraAdded,
    totalAdded,
    finalValue,
    hasExtension,
    baseDisplay,
    finalDisplay,
    summaryText,
  };
}

function buildPlayerNonRollSummary(
  sp: any,
  selectedOptions: string[],
  nonStepTags: Array<{ label: string; count: number }>
): string {
  const id = sp?.id;
  const baseFormula = String(sp?.effectFormula || '').trim();
  const extraEffects = selectedOptions.filter((o) => o.includes('增强效果'));
  const otherTags = nonStepTags.filter((t) => !t.label.includes('增强效果') && !t.label.includes('持续时间'));

  // Specific clean combinations for common Buff spells
  if (id === 'arrow-of-night') {
    const dmgBoost = extraEffects.filter((o) => o.includes('伤害')).length * 2;
    const maPen = extraEffects.filter((o) => o.includes('秘法护甲')).length * 2;
    const parts = [`远程伤害 +${6 + dmgBoost}`, `目标秘法护甲 -${2 + maPen}`];
    if (otherTags.length > 0) {
      parts.push(...otherTags.map((t) => (t.count > 1 ? `${t.label} ×${t.count}` : t.label)));
    }
    return `本次生效强化：${parts.join('、')}（请在后续攻击或结算时计入）`;
  }

  if (id === 'flameweapon') {
    const stepBoost = selectedOptions.filter((o) => isStepEnhancementOption(o)).length * 2;
    const finalDieStep = 4 + stepBoost;
    const dieLabel = ED4Engine.getStepDice(finalDieStep).label;
    return `本次生效强化：武器附着火焰，攻击命中后额外追加 Step ${finalDieStep} (${dieLabel}) 火焰伤害`;
  }

  if (id === 'night-s-edge') {
    const stepBoost = selectedOptions.filter((o) => isStepEnhancementOption(o)).length * 2;
    const finalDieStep = 3 + stepBoost;
    const dieLabel = ED4Engine.getStepDice(finalDieStep).label;
    return `本次生效强化：武器附加 Step ${finalDieStep} (${dieLabel}) 寒冷伤害，受创目标秘法防御 -2`;
  }

  if (id === 'shield-willow') {
    const bonus = extraEffects.length * 1;
    return `本次生效强化：盾牌物理防御 +${2 + bonus}、秘法防御 +${2 + bonus}`;
  }

  if (id === 'air-armor') {
    const bonus = extraEffects.length * 1;
    return `本次生效强化：物理护甲 +${3 + bonus}（需穿着衣物或护甲）`;
  }

  if (id === 'mage-armor') {
    const bonus = extraEffects.length * 2;
    return `本次生效强化：物理护甲 +${3 + bonus}`;
  }

  if (id === 'soul-armor') {
    const bonus = extraEffects.length * 2;
    return `本次生效强化：秘法护甲 +${3 + bonus}`;
  }

  if (id === 'circle-of-astral-protection') {
    const bonus = extraEffects.length * 2;
    return `本次生效强化：秘法护甲 +${4 + bonus}`;
  }

  if (id === 'ironskin') {
    const bonus = extraEffects.length * 1;
    return `本次生效强化：物理护甲 +${3 + bonus}、负伤阈值 +${3 + bonus}、击倒检定 +${3 + bonus}`;
  }

  if (id === 'lightning-step') {
    const bonus = extraEffects.length * 1;
    return `本次生效强化：先攻 +${2 + bonus}、移动速率 +${2 + bonus}、物理防御 +${2 + bonus}`;
  }

  if (id === 'monstrous-mantle') {
    const bonus = extraEffects.length * 1;
    return `本次生效强化：近战攻击与伤害 +${2 + bonus}、物理防御 +${2 + bonus}`;
  }

  if (id === 'aspect-of-the-fog-ghost') {
    const bonus = extraEffects.length * 1;
    return `本次生效强化：近战攻击与伤害 +${3 + bonus}、物理防御 +${3 + bonus}`;
  }

  if (id === 'aspect-of-the-casual-murderer') {
    const bonus = extraEffects.length * 1;
    return `本次生效强化：攻击与伤害检定 +${5 + bonus}`;
  }

  const allExtraNotes = nonStepTags.filter((t) => !t.label.includes('持续时间'));
  const noteStr =
    allExtraNotes.length > 0
      ? `；附加强化：${allExtraNotes.map((t) => (t.count > 1 ? `${t.label} ×${t.count}` : t.label)).join('、')}`
      : '';
  return `本次生效强化：${baseFormula || sp?.desc || '见法术说明'}${noteStr}（请在后续攻击或结算时计入）`;
}

export function computeSpellEffectPlan(params: {
  spell: any;
  pl: any;
  derived: any;
  extraThreadsCount: number;
  selectedExtraOptions: string[];
  castingExtraSuccesses: number;
}): SpellEffectPlan {
  const sp = enrichSpellWithDb(params.spell);
  const extraThreadsCount = Math.max(0, Math.floor(Number(params.extraThreadsCount) || 0));
  const castingExtraSuccesses = Math.max(0, Math.floor(Number(params.castingExtraSuccesses) || 0));
  const supportsStepBoost = Number(sp?.extraEffectStepPerThread) === 2;
  const availableOpts: string[] = Array.isArray(sp?.extraThreads) ? sp.extraThreads : [];

  const normalizedSelected = Array.from({ length: extraThreadsCount }, (_, i) => {
    const raw = params.selectedExtraOptions?.[i];
    if (raw && availableOpts.includes(raw)) return raw;
    return availableOpts[0] || '';
  }).filter(Boolean);

  const { hasBaseRoll, baseStep, willforceRank } = parseBaseSpellEffectStep(sp, params.pl, params.derived);
  const willforceStrain = hasBaseRoll && willforceRank > 0 ? 1 : 0;

  let stepEnhanceCount = 0;
  const tagCounts = new Map<string, number>();

  normalizedSelected.forEach((opt) => {
    if (supportsStepBoost && isStepEnhancementOption(opt)) {
      stepEnhanceCount += 1;
    } else {
      tagCounts.set(opt, (tagCounts.get(opt) || 0) + 1);
    }
  });

  const supportsCastingExtraStep =
    hasBaseRoll &&
    supportsStepBoost &&
    (sp?.effectType === 'damage' || sp?.successLevelType === 'effect_step');

  const extraThreadStepBonus = supportsStepBoost && hasBaseRoll ? stepEnhanceCount * 2 : 0;
  const castingExtraStepBonus = supportsCastingExtraStep ? castingExtraSuccesses * 2 : 0;
  const totalBonusStep = extraThreadStepBonus + castingExtraStepBonus;
  const finalStep = hasBaseRoll && baseStep !== null ? Math.max(1, baseStep + totalBonusStep) : null;

  const scRank = ED4Engine.getSpellcastingStep(params.pl, params.derived).rank;
  const durationPlan = computeSpellDurationPlan({
    spell: sp,
    spellcastingRank: scRank,
    selectedExtraOptions: normalizedSelected,
    castingExtraSuccesses,
    supportsCastingExtraStep,
  });

  const nonStepTags = Array.from(tagCounts.entries()).map(([label, count]) => ({ label, count }));
  const effectEnhancements = nonStepTags.filter((t) => !t.label.includes('持续时间'));

  const parts: string[] = [];
  if (hasBaseRoll && baseStep !== null) {
    parts.push(
      `基础效果 ${sp?.effectFormula || '-'} (Step ${baseStep}${willforceRank > 0 ? `, 含意志力+${willforceRank}` : ''})`
    );
    if (extraThreadStepBonus > 0) {
      parts.push(`额外脉路 +${extraThreadStepBonus} STEP (${stepEnhanceCount}条)`);
    }
    if (castingExtraStepBonus > 0) {
      parts.push(`施法额外成功 +${castingExtraStepBonus} STEP (${castingExtraSuccesses}成功)`);
    }
  } else {
    parts.push(sp?.effectFormula || '-');
  }
  const breakdownText = parts.join(' + ');

  const tagsText =
    nonStepTags.length > 0
      ? nonStepTags.map((t) => (t.count > 1 ? `${t.label} ×${t.count}` : t.label)).join('、')
      : '';

  const playerSummaryText = hasBaseRoll
    ? `${breakdownText}${durationPlan.hasExtension ? `；${durationPlan.summaryText}` : ''}`
    : buildPlayerNonRollSummary(sp, normalizedSelected, nonStepTags);

  return {
    hasBaseRoll,
    baseFormula: sp?.effectFormula || '-',
    baseStep,
    willforceRank,
    willforceStrain,
    supportsStepBoost,
    supportsCastingExtraStep,
    extraThreadsCount,
    selectedExtraOptions: normalizedSelected,
    stepEnhanceCount,
    extraThreadStepBonus,
    castingExtraSuccesses,
    castingExtraStepBonus,
    totalBonusStep,
    finalStep,
    nonStepTags,
    effectEnhancements,
    durationPlan,
    playerSummaryText,
    breakdownText,
    tagsText,
  };
}

const WEAPON_BUFF_IDS = new Set([
  'flameweapon',
  'night-s-edge',
  'arrow-of-night',
  'venomous-fury',
  'netherblade',
  'weapon-back',
]);

const SHIELD_BUFF_IDS = new Set(['shield-willow']);

export function getBuffTargetKind(spell: any): BuffTargetKind {
  const sp = enrichSpellWithDb(spell);
  const id = String(sp?.id || '');
  if (WEAPON_BUFF_IDS.has(id)) return 'weapon';
  if (SHIELD_BUFF_IDS.has(id)) return 'shield';
  return 'character';
}

export function buildActiveBuffEntry(params: {
  spell: any;
  plan: SpellEffectPlan;
  targetItemId?: string;
  targetItemName?: string;
}): ActiveBuff {
  const sp = enrichSpellWithDb(params.spell);
  const { plan } = params;
  const targetKind = getBuffTargetKind(sp);
  const mods = emptyBuffModifiers();
  const opts = plan.selectedExtraOptions;
  const countOpt = (pred: (s: string) => boolean) => opts.filter(pred).length;

  let shortEffect = String(sp.effectFormula || '');

  switch (sp.id) {
    case 'air-armor': {
      const extra = countOpt((s) => s.includes('增强效果'));
      mods.pa += 3 + extra;
      shortEffect = `物理护甲 +${mods.pa}`;
      break;
    }
    case 'mage-armor': {
      const extra = countOpt((s) => s.includes('增强效果')) * 2;
      mods.pa += 3 + extra;
      shortEffect = `物理护甲 +${mods.pa}`;
      break;
    }
    case 'ironskin': {
      const extra = countOpt((s) => s.includes('增强效果'));
      const val = 3 + extra;
      mods.pa += val;
      mods.woundThreshold += val;
      mods.notes.push(`击倒检定 +${val}`);
      shortEffect = `物理护甲 +${val}、负伤阈值 +${val}、击倒检定 +${val}`;
      break;
    }
    case 'soul-armor': {
      const extra = countOpt((s) => s.includes('增强效果')) * 2;
      mods.ma += 3 + extra;
      shortEffect = `秘法护甲 +${mods.ma}`;
      break;
    }
    case 'circle-of-astral-protection': {
      const extra = countOpt((s) => s.includes('增强效果')) * 2;
      mods.ma += 4 + extra;
      shortEffect = `秘法护甲 +${mods.ma}`;
      break;
    }
    case 'astral-shield': {
      const extraMa = countOpt((s) => s.includes('秘法护甲')) * 2;
      mods.md += 2;
      mods.ma += extraMa;
      shortEffect = extraMa > 0 ? `秘法防御 +2、秘法护甲 +${extraMa}` : '秘法防御 +2';
      break;
    }
    case 'shield-willow': {
      const extra = countOpt((s) => s.includes('增强效果'));
      const val = 2 + extra;
      mods.pd += val;
      mods.md += val;
      shortEffect = `盾牌物防/秘防 +${val}`;
      break;
    }
    case 'lightning-step': {
      const extra = countOpt((s) => s.includes('增强效果'));
      const val = 2 + extra;
      mods.init += val;
      mods.move += val;
      mods.pd += val;
      shortEffect = `先攻 +${val}、移速 +${val}、物防 +${val}`;
      break;
    }
    case 'monstrous-mantle': {
      const extra = countOpt((s) => s.includes('增强效果'));
      const val = 2 + extra;
      mods.meleeAtk += val;
      mods.meleeDmgStep += val;
      mods.pd += val;
      shortEffect = `近战攻伤 +${val}、物防 +${val}`;
      break;
    }
    case 'aspect-of-the-fog-ghost': {
      const extra = countOpt((s) => s.includes('增强效果'));
      const val = 3 + extra;
      mods.meleeAtk += val;
      mods.meleeDmgStep += val;
      mods.pd += val;
      shortEffect = `近战攻伤 +${val}、物防 +${val}`;
      break;
    }
    case 'aspect-of-the-casual-murderer': {
      const extra = countOpt((s) => s.includes('增强效果'));
      const val = 5 + extra;
      mods.allAtk += val;
      mods.allDmgStep += val;
      shortEffect = `攻击与伤害检定 +${val}`;
      break;
    }
    case 'flameweapon': {
      const stepBoost = countOpt((s) => isStepEnhancementOption(s)) * 2;
      mods.weaponExtraDieStep = 4 + stepBoost;
      mods.weaponExtraDieElement = '火焰';
      const label = ED4Engine.getStepDice(mods.weaponExtraDieStep).label;
      shortEffect = `附加火焰伤害 Step ${mods.weaponExtraDieStep} (${label})`;
      break;
    }
    case 'night-s-edge': {
      const stepBoost = countOpt((s) => isStepEnhancementOption(s)) * 2;
      mods.weaponExtraDieStep = 3 + stepBoost;
      mods.weaponExtraDieElement = '寒冷';
      mods.notes.push('命中目标秘法防御 -2');
      const label = ED4Engine.getStepDice(mods.weaponExtraDieStep).label;
      shortEffect = `附加寒冷伤害 Step ${mods.weaponExtraDieStep} (${label})，目标秘防 -2`;
      break;
    }
    case 'arrow-of-night': {
      const dmgBoost = countOpt((s) => s.includes('伤害')) * 2;
      const maPen = countOpt((s) => s.includes('秘法护甲')) * 2;
      const dmgVal = 6 + dmgBoost;
      const maPenVal = 2 + maPen;
      mods.rangedDmgStep += dmgVal;
      mods.notes.push(`命中目标秘法护甲 -${maPenVal}`);
      shortEffect = `远程伤害 +${dmgVal}、目标秘法护甲 -${maPenVal}`;
      break;
    }
    case 'venomous-fury': {
      const extra = countOpt((s) => s.includes('增强效果'));
      const dmgVal = 3 + extra;
      mods.meleeDmgStep += dmgVal;
      mods.notes.push('命中附加中毒麻痹效果');
      shortEffect = `近战伤害 +${dmgVal}、附带麻痹毒素`;
      break;
    }
    case 'netherblade': {
      const extra = countOpt((s) => s.includes('伤害')) * 2;
      mods.meleeDmgStep += extra;
      mods.notes.push('武器可击中星界目标');
      shortEffect = extra > 0 ? `可击中星界目标、伤害 +${extra}` : '武器可击中星界目标';
      break;
    }
    case 'iron-hand': {
      mods.meleeDmgStep += 3;
      shortEffect = '近战伤害检定 +3';
      break;
    }
    case 'giant-size': {
      const extra = countOpt((s) => s.includes('增强效果')) * 2;
      const val = 4 + extra;
      mods.allDmgStep += val;
      mods.notes.push(`力量/体质相关检定 +${val}`);
      shortEffect = `力量/体质检定与伤害 +${val}`;
      break;
    }
    case 'rampage': {
      const extra = countOpt((s) => s.includes('增强效果')) * 2;
      const val = 3 + extra;
      mods.meleeAtk += val;
      mods.meleeDmgStep += val;
      shortEffect = `近战攻击与伤害 +${val}`;
      break;
    }
    case 'combat-fury': {
      const extra = countOpt((s) => s.includes('增强效果')) * 2;
      const val = 2 + extra;
      mods.meleeAtk += val;
      shortEffect = `近战攻击检定 +${val}`;
      break;
    }
    case 'seeking-sight': {
      const extra = countOpt((s) => s.includes('增强效果')) * 2;
      const val = 3 + extra;
      mods.rangedAtk += val;
      shortEffect = `远程攻击检定 +${val}`;
      break;
    }
    case 'quicken-pace': {
      const extra = countOpt((s) => s.includes('移动速率')) * 2;
      const val = 2 + extra;
      mods.move += val;
      shortEffect = `移动速率 +${val} 码`;
      break;
    }
    case 'mantle-of-the-lightning-vanguard': {
      const extraMove = countOpt((s) => s.includes('移动速率')) * 2;
      const extraInit = countOpt((s) => s.includes('先攻')) * 2;
      mods.move += 4 + extraMove;
      mods.init += 2 + extraInit;
      shortEffect = `飞行移速 16（移速 +${mods.move}）、先攻 +${mods.init}`;
      break;
    }
    case 'assuring-touch': {
      const extra = countOpt((s) => s.includes('增强效果')) * 2;
      const val = 3 + extra;
      mods.notes.push(`对抗恐惧秘防/社防/意志 +${val}`);
      shortEffect = `对抗恐惧秘防/社防 +${val}、意志检定 +${val}`;
      break;
    }
    default: {
      if (plan.effectEnhancements.length > 0) {
        const enh = plan.effectEnhancements
          .map((t) => (t.count > 1 ? `${t.label} ×${t.count}` : t.label))
          .join('、');
        shortEffect = `${shortEffect}（${enh}）`;
      }
      break;
    }
  }

  return {
    id: `buff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    spellId: sp.id,
    nameCn: sp.nameCn || sp.name,
    targetKind,
    targetItemId: targetKind === 'character' ? undefined : params.targetItemId,
    targetItemName: targetKind === 'character' ? undefined : params.targetItemName,
    effectSummary: shortEffect,
    durationText: plan.durationPlan.finalDisplay,
    extraThreadsCount: plan.extraThreadsCount,
    selectedExtraOptions: plan.selectedExtraOptions,
    modifiers: mods,
  };
}

export function computeActiveBuffModifiers(activeBuffs: ActiveBuff[] = [], pl?: any): ActiveBuffModifiers {
  const total = emptyBuffModifiers();
  const isBlindsided = Boolean(pl?.statuses?.blindsided);

  for (const buff of activeBuffs || []) {
    if (!buff || !buff.modifiers) continue;
    const m = buff.modifiers;
    // Shield buffs follow shield blindsided rule
    if (buff.targetKind === 'shield' && isBlindsided) {
      continue;
    }
    total.pa += Number(m.pa) || 0;
    total.ma += Number(m.ma) || 0;
    total.pd += Number(m.pd) || 0;
    total.md += Number(m.md) || 0;
    total.sd += Number(m.sd) || 0;
    total.init += Number(m.init) || 0;
    total.move += Number(m.move) || 0;
    total.woundThreshold += Number(m.woundThreshold) || 0;

    if (buff.targetKind === 'character') {
      total.meleeAtk += Number(m.meleeAtk) || 0;
      total.rangedAtk += Number(m.rangedAtk) || 0;
      total.allAtk += Number(m.allAtk) || 0;
      total.meleeDmgStep += Number(m.meleeDmgStep) || 0;
      total.rangedDmgStep += Number(m.rangedDmgStep) || 0;
      total.allDmgStep += Number(m.allDmgStep) || 0;
    }

    if (Array.isArray(m.notes)) {
      total.notes.push(...m.notes);
    }
  }

  return total;
}

export function isRangedWeaponName(name: string): boolean {
  const s = String(name || '').toLowerCase();
  return /弓|弩|箭|飞镖|投掷|投枪|标枪|弹弓|火铳|bow|crossbow|arrow|dart|sling|thrown|javelin|missile/.test(s);
}

export function getWeaponBuffEffects(
  activeBuffs: ActiveBuff[] = [],
  weaponId: string,
  weaponName: string
): {
  dmgStepBonus: number;
  extraDice: Array<{ step: number; label: string; element: string; spellName: string }>;
  notes: string[];
  buffNames: string[];
} {
  const isRanged = isRangedWeaponName(weaponName);
  let dmgStepBonus = 0;
  const extraDice: Array<{ step: number; label: string; element: string; spellName: string }> = [];
  const notes: string[] = [];
  const buffNames: string[] = [];

  for (const buff of activeBuffs || []) {
    if (!buff || !buff.modifiers) continue;
    const m = buff.modifiers;

    if (buff.targetKind === 'weapon') {
      if (buff.targetItemId && buff.targetItemId !== weaponId) continue;
      let applies = false;
      const wBonus = (Number(m.meleeDmgStep) || 0) + (Number(m.rangedDmgStep) || 0) + (Number(m.allDmgStep) || 0);
      if (wBonus !== 0) {
        dmgStepBonus += wBonus;
        applies = true;
      }
      if (Number(m.weaponExtraDieStep) > 0) {
        const step = Number(m.weaponExtraDieStep);
        extraDice.push({
          step,
          label: ED4Engine.getStepDice(step).label,
          element: m.weaponExtraDieElement || '附魔',
          spellName: buff.nameCn,
        });
        applies = true;
      }
      if (Array.isArray(m.notes) && m.notes.length > 0) {
        notes.push(...m.notes);
        applies = true;
      }
      if (applies) buffNames.push(buff.nameCn);
    } else if (buff.targetKind === 'character') {
      const charBonus =
        (Number(m.allDmgStep) || 0) +
        (isRanged ? Number(m.rangedDmgStep) || 0 : Number(m.meleeDmgStep) || 0);
      if (charBonus !== 0) {
        dmgStepBonus += charBonus;
        buffNames.push(buff.nameCn);
      }
    }
  }

  return { dmgStepBonus, extraDice, notes, buffNames };
}
