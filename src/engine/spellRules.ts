import ED4Engine from './ed4_engine.js';

export type ExtraThreadCapReason = 'empty' | 'versatility' | 'circle';

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

export interface SpellEffectPlan {
  hasBaseRoll: boolean;
  baseFormula: string;
  baseStep: number | null;
  willforceRank: number;
  willforceStrain: number;
  supportsStepBoost: boolean;
  extraThreadsCount: number;
  selectedExtraOptions: string[];
  stepEnhanceCount: number;
  extraThreadStepBonus: number;
  castingExtraSuccesses: number;
  castingExtraStepBonus: number;
  totalBonusStep: number;
  finalStep: number | null;
  nonStepTags: Array<{ label: string; count: number }>;
  breakdownText: string;
  tagsText: string;
}

export function enrichSpellWithDb<T extends Record<string, any>>(
  sp: T
): T & { extraThreads: string[]; extraEffectStepPerThread: number } {
  if (!sp || typeof sp !== 'object') return sp as T & { extraThreads: string[]; extraEffectStepPerThread: number };
  const dbById = sp.id ? ED4Engine.SPELLS_DB.find((item: any) => item.id === sp.id) : null;
  const dbMatch = dbById || ED4Engine.findSpellInDb(sp.nameCn || sp.nameEn || '');
  if (dbMatch && sp.matchedDb !== false) {
    return {
      ...dbMatch,
      ...sp,
      extraThreads: Array.isArray(dbMatch.extraThreads) ? dbMatch.extraThreads : [],
      extraEffectStepPerThread:
        typeof dbMatch.extraEffectStepPerThread === 'number' ? dbMatch.extraEffectStepPerThread : 0,
    };
  }
  return {
    ...sp,
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

  // Non-caster discipline has no Circle in any spellcasting discipline (cross-discipline via Versatility)
  if (!plDisc || !plDisc.isCaster) return true;

  // Spell belongs to another casting discipline where the character has no Circle
  if (spellDiscId && ED4Engine.DISCIPLINES[spellDiscId] && spellDiscId !== plDiscId) return true;

  // Explicit Versatility marker on the matching Thread Weaving talent
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

  // 1. Explicit manual TMD input takes precedence whenever non-empty & finite
  if (manualTmd !== undefined && manualTmd !== null && String(manualTmd).trim() !== '') {
    const num = Number(String(manualTmd).trim());
    if (Number.isFinite(num)) {
      return { dn: num, targetLabel: `TMD ${num}`, source: 'manual' };
    }
  }

  // 2. Fixed casting DN spells (e.g. DN 6)
  if (spell?.castingType === 'fixed') {
    const fixedDn = Number(spell.castingDn) || 6;
    return { dn: fixedDn, targetLabel: `固定难度 ${fixedDn}`, source: 'fixed' };
  }

  // 3. Target selector fallback when non-empty
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

  // 4. Empty TMD & no target -> roll only without success check
  return { dn: null, targetLabel: '无目标秘法防御', source: 'none' };
}

export function isStepEnhancementOption(optionText: string): boolean {
  const s = String(optionText || '').trim();
  if (!s) return false;
  return s.includes('效果阶数') || /\+\s*2\s*step/i.test(s);
}

export function parseBaseSpellEffectStep(
  effectFormula: string,
  pl: any,
  derived: any
): { hasBaseRoll: boolean; baseStep: number | null; willforceRank: number } {
  const f = String(effectFormula || '').trim().toUpperCase();
  const willforce = (pl?.talents || []).find(
    (t: any) => String(t?.name || '').includes('意志力') || String(t?.name || '').toLowerCase().includes('willforce')
  );
  const willforceRank = willforce ? Number(willforce.rank) || 0 : 0;
  const wilStep = Number(derived?.steps?.WIL ?? ED4Engine.attrToStep(10)) || 5;
  const baseWilStep = wilStep + willforceRank;
  const circle = Math.max(1, Number(pl?.circle) || 1);

  if (!f) return { hasBaseRoll: false, baseStep: null, willforceRank: 0 };

  // Handle WIL+Circle (e.g. Restrain Entity)
  if (/WIL\s*\+\s*CIRCLE/.test(f)) {
    return { hasBaseRoll: true, baseStep: baseWilStep + circle, willforceRank };
  }

  // Handle WIL+N
  const mWilPlus = f.match(/WIL\s*\+\s*(\d+)/);
  if (mWilPlus) {
    return { hasBaseRoll: true, baseStep: baseWilStep + Number(mWilPlus[1]), willforceRank };
  }

  // Handle standalone WIL (ignore formulas like 武器伤害 +D6 unless WIL token exists)
  if (/\bWIL\b/.test(f)) {
    return { hasBaseRoll: true, baseStep: baseWilStep, willforceRank };
  }

  // Handle Circle+N
  const mCirPlus = f.match(/CIRCLE\s*\+\s*(\d+)/);
  if (mCirPlus) {
    return { hasBaseRoll: true, baseStep: circle + Number(mCirPlus[1]), willforceRank: 0 };
  }

  return { hasBaseRoll: false, baseStep: null, willforceRank: 0 };
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

  const { hasBaseRoll, baseStep, willforceRank } = parseBaseSpellEffectStep(sp?.effectFormula || '', params.pl, params.derived);
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

  const extraThreadStepBonus = supportsStepBoost ? stepEnhanceCount * 2 : 0;
  const castingExtraStepBonus = supportsStepBoost ? castingExtraSuccesses * 2 : 0;
  const totalBonusStep = extraThreadStepBonus + castingExtraStepBonus;
  const finalStep = hasBaseRoll && baseStep !== null ? Math.max(1, baseStep + totalBonusStep) : null;

  const nonStepTags = Array.from(tagCounts.entries()).map(([label, count]) => ({ label, count }));
  const parts: string[] = [
    `基础效果 ${sp?.effectFormula || '-'}${hasBaseRoll && baseStep !== null ? ` (Step ${baseStep}${willforceRank > 0 ? `, 含意志力+${willforceRank}` : ''})` : ''}`,
  ];
  if (extraThreadStepBonus > 0) {
    parts.push(`额外脉路 +${extraThreadStepBonus} STEP (${stepEnhanceCount}条)`);
  }
  if (castingExtraStepBonus > 0) {
    parts.push(`施法额外成功 +${castingExtraStepBonus} STEP (${castingExtraSuccesses}成功)`);
  }
  const breakdownText = parts.join(' + ');

  const tagsText =
    nonStepTags.length > 0
      ? nonStepTags.map((t) => (t.count > 1 ? `${t.label} ×${t.count}` : t.label)).join('、')
      : '';

  return {
    hasBaseRoll,
    baseFormula: sp?.effectFormula || '-',
    baseStep,
    willforceRank,
    willforceStrain,
    supportsStepBoost,
    extraThreadsCount,
    selectedExtraOptions: normalizedSelected,
    stepEnhanceCount,
    extraThreadStepBonus,
    castingExtraSuccesses,
    castingExtraStepBonus,
    totalBonusStep,
    finalStep,
    nonStepTags,
    breakdownText,
    tagsText,
  };
}
