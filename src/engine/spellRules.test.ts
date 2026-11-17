import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ED4Engine from './ed4_engine.js';
import { createInitialState, getPlDerivedView } from './combatHelpers';
import {
  buildActiveBuffEntry,
  computeSpellDurationPlan,
  computeSpellEffectPlan,
  enrichSpellWithDb,
  getBuffTargetKind,
  getCircleExtraThreadCap,
  getExtraThreadRuleInfo,
  getWeaponBuffEffects,
  isStepEnhancementOption,
  isVersatilityWeaving,
  resolveCastingDn,
  resolveWeavingRollOutcome,
} from './spellRules';

test('SPELLS_DB matches uploaded ed4_spells_complete JSON (216 spells) and hydrates legacy IDs', () => {
  const raw = JSON.parse(
    fs.readFileSync('public/assets/aistudio/ed4_spells_complete_aa04f79e.json', 'utf8')
  );
  assert.equal(ED4Engine.SPELLS_DB.length, 216);
  assert.equal(ED4Engine.SPELLS_DB.length, raw.length);

  for (const jsonSpell of raw) {
    const dbSpell = ED4Engine.SPELLS_DB.find((s: any) => s.id === jsonSpell.id);
    assert.ok(dbSpell, `Missing spell ${jsonSpell.id}`);
    assert.deepEqual(dbSpell.extraThreads, jsonSpell.extraThreads);
    assert.equal(dbSpell.extraEffectStepPerThread, jsonSpell.extraEffectStepPerThread);
    assert.equal(dbSpell.discipline, String(jsonSpell.discipline).toLowerCase());
  }

  // Legacy saved spells hydrate cleanly to new complete schema
  const staleBolt = { id: 'ill_ephemeral_bolt', nameCn: '瞬息之箭', threads: 0, wovenThreads: 0 };
  const hydratedBolt = enrichSpellWithDb(staleBolt);
  assert.equal(hydratedBolt.id, 'ephemeral-bolt');
  assert.equal(hydratedBolt.extraEffectStepPerThread, 2);
  assert.ok(hydratedBolt.extraThreads.some((o: string) => isStepEnhancementOption(o)));

  const staleWillow = { id: 'ele_shield_willow', nameCn: '柳枝护盾', threads: 1, wovenThreads: 0 };
  const hydratedWillow = enrichSpellWithDb(staleWillow);
  assert.equal(hydratedWillow.id, 'shield-willow');
  assert.equal(hydratedWillow.effectType, 'buff');
});

test('Extra thread cap follows Circle tiers, empty extraThreads, and Versatility cross-discipline rules', () => {
  assert.equal(getCircleExtraThreadCap(1), 1);
  assert.equal(getCircleExtraThreadCap(4), 1);
  assert.equal(getCircleExtraThreadCap(5), 2);
  assert.equal(getCircleExtraThreadCap(8), 2);
  assert.equal(getCircleExtraThreadCap(9), 3);
  assert.equal(getCircleExtraThreadCap(12), 3);
  assert.equal(getCircleExtraThreadCap(13), 4);
  assert.equal(getCircleExtraThreadCap(15), 4);

  const st = createInitialState();
  const fireball = ED4Engine.findSpellInDb('火球术');
  const reverseWithering = ED4Engine.findSpellInDb('逆转萎缩');
  const bolt = ED4Engine.findSpellInDb('瞬息之箭');

  const ele5 = {
    ...st.pl,
    raceId: 'elf',
    disciplineId: 'elementalist',
    circle: 5,
    talents: [{ id: 't1', name: '元素编织', attr: 'PER', rank: 5, strain: 0, isAttack: false }],
  };
  const eleRule = getExtraThreadRuleInfo(ele5, fireball);
  assert.equal(eleRule.maxExtra, 2);
  assert.equal(eleRule.maxTotal, 3); // fireball base 1 + 2 extra = 3
  assert.equal(eleRule.reason, 'circle');

  const net10 = {
    ...st.pl,
    raceId: 'human',
    disciplineId: 'nethermancer',
    circle: 10,
    talents: [{ id: 't1', name: '下界编织', attr: 'PER', rank: 8, strain: 0, isAttack: false }],
  };
  const emptyRule = getExtraThreadRuleInfo(net10, reverseWithering);
  assert.equal(emptyRule.maxExtra, 0);
  assert.equal(emptyRule.maxTotal, reverseWithering.threads);
  assert.equal(emptyRule.reason, 'empty');

  const humanVersatility = {
    ...st.pl,
    raceId: 'human',
    disciplineId: 'swordmaster',
    circle: 7,
    talents: [{ id: 'tv', name: '多才多艺（幻术编织）', attr: 'PER', rank: 3, strain: 0, isAttack: false }],
  };
  assert.equal(isVersatilityWeaving(humanVersatility, bolt), true);
  const versRule = getExtraThreadRuleInfo(humanVersatility, bolt);
  assert.equal(versRule.maxExtra, 0);
  assert.equal(versRule.maxTotal, 0);
  assert.equal(versRule.reason, 'versatility');

  const wiz5 = {
    ...ele5,
    disciplineId: 'wizard',
    talents: [{ id: 'tw', name: '巫术编织', attr: 'PER', rank: 5, strain: 0, isAttack: false }],
  };
  assert.equal(isVersatilityWeaving(wiz5, fireball), true);
  assert.equal(getExtraThreadRuleInfo(wiz5, fireball).maxExtra, 0);
});

test('Weaving roll truncation clamps to maxTotalThreads and emits truncation warning', () => {
  const st = createInitialState();
  const spear = ED4Engine.findSpellInDb('星质长矛');
  const net5 = {
    ...st.pl,
    disciplineId: 'nethermancer',
    circle: 5,
    talents: [{ id: 't1', name: '下界编织', attr: 'PER', rank: 5, strain: 0, isAttack: false }],
  };
  const rule = getExtraThreadRuleInfo(net5, spear);
  assert.equal(rule.maxExtra, 2);
  assert.equal(rule.maxTotal, 3);

  const overflowRes = resolveWeavingRollOutcome({ currentWoven: 0, gained: 5, rule });
  assert.equal(overflowRes.nextWoven, 3);
  assert.equal(overflowRes.overflowed, true);
  assert.equal(overflowRes.overflowAmount, 2);
  assert.equal(overflowRes.extraThreadsCount, 2);
  assert.equal(overflowRes.logText, '成功，已达 5 环额外脉路上限 3/1，溢出成功度作废');
});

test('Spell effect plan computes STEP breakdown, duration extension, and PL-friendly copy without dev jargon', () => {
  const st = createInitialState();
  const bolt = ED4Engine.findSpellInDb('瞬息之箭');
  const airArmor = ED4Engine.findSpellInDb('气元素甲');
  const arrowNight = ED4Engine.findSpellInDb('夜之箭矢');
  const flameweapon = ED4Engine.findSpellInDb('火焰武器');

  assert.equal(resolveCastingDn({ spell: bolt, manualTmd: '', targetValue: '', monsters: [] }).dn, null);
  const manualDn = resolveCastingDn({ spell: bolt, manualTmd: '12', targetValue: '', monsters: [] });
  assert.equal(manualDn.dn, 12);

  const ill5 = {
    ...st.pl,
    raceId: 'elf',
    disciplineId: 'illusionist',
    circle: 5,
    attrMods: { DEX: 0, STR: 0, TOU: 0, PER: 3, WIL: 5, CHA: 0 }, // Elf WIL 11+5=16 -> Step 7
    talents: [
      { id: 't1', name: '幻术编织', attr: 'PER', rank: 5, strain: 0, isAttack: false },
      { id: 't2', name: '施法', attr: 'PER', rank: 5, strain: 0, isAttack: false },
    ],
  };
  const derived = getPlDerivedView(ill5);
  assert.equal(derived.steps.WIL, 7);

  // Damage spell: extra threads + casting extra successes add +2 STEP each
  const stepOpt = bolt.extraThreads.find((o: string) => isStepEnhancementOption(o));
  assert.ok(stepOpt);
  const planBolt = computeSpellEffectPlan({
    spell: bolt,
    pl: ill5,
    derived,
    extraThreadsCount: 2,
    selectedExtraOptions: [stepOpt, stepOpt],
    castingExtraSuccesses: 1,
  });
  assert.equal(planBolt.hasBaseRoll, true);
  assert.equal(planBolt.baseStep, 11); // WIL(7)+4
  assert.equal(planBolt.extraThreadStepBonus, 4);
  assert.equal(planBolt.castingExtraStepBonus, 2);
  assert.equal(planBolt.finalStep, 17);

  // Duration calculation: 夜之箭矢 (2轮) + 2 extra successes -> 6 轮
  const durArrow = computeSpellDurationPlan({
    spell: arrowNight,
    spellcastingRank: 5,
    selectedExtraOptions: [],
    castingExtraSuccesses: 2,
    supportsCastingExtraStep: false,
  });
  assert.equal(durArrow.baseDisplay, '2 轮');
  assert.equal(durArrow.finalDisplay, '6 轮');
  assert.equal(durArrow.summaryText, '持续时间：2 轮 → 6 轮（基础 2 轮 + 施法额外成功 +4 轮）');

  // Rank duration + extra thread "+2分钟" on shield-willow + casting extra successes
  const shieldWillow = ED4Engine.findSpellInDb('柳枝护盾');
  const durWillow = computeSpellDurationPlan({
    spell: shieldWillow,
    spellcastingRank: 5,
    selectedExtraOptions: ['提高持续时间（+2分钟）'],
    castingExtraSuccesses: 1,
    supportsCastingExtraStep: false,
  });
  assert.equal(durWillow.baseDisplay, '5 分钟');
  assert.equal(durWillow.finalDisplay, '9 分钟'); // 5 + 2 (thread) + 2 (casting)
  assert.ok(durWillow.summaryText.includes('5 分钟 → 9 分钟'));

  // Unit upgrade: 提高持续时间（分钟） on air-armor (等级数+5轮 -> 10 轮 -> 12 分钟)
  const durAirUpgrade = computeSpellDurationPlan({
    spell: airArmor,
    spellcastingRank: 5,
    selectedExtraOptions: ['提高持续时间（分钟）'],
    castingExtraSuccesses: 1,
    supportsCastingExtraStep: false,
  });
  assert.equal(durAirUpgrade.baseDisplay, '10 轮');
  assert.equal(durAirUpgrade.unitUpgradedToMinutes, true);
  assert.equal(durAirUpgrade.finalUnit, '分钟');
  assert.equal(durAirUpgrade.finalDisplay, '12 分钟');

  // PL-friendly copy contains NO developer meta-jargon
  const planArrow = computeSpellEffectPlan({
    spell: arrowNight,
    pl: ill5,
    derived,
    extraThreadsCount: 1,
    selectedExtraOptions: ['增强效果（+2伤害）'],
    castingExtraSuccesses: 2,
  });
  assert.equal(planArrow.hasBaseRoll, false);
  assert.ok(planArrow.playerSummaryText.includes('本次生效强化：'));
  assert.ok(planArrow.playerSummaryText.includes('远程伤害 +8'));
  assert.ok(!/文本提示|无独立效果骰|无基础阶数骰|不自动加 STEP|非掷骰效果/.test(planArrow.playerSummaryText));

  // isStepEnhancementOption supports both 效果阶数 and 效果Step / 伤害Step
  assert.equal(isStepEnhancementOption('增强效果（+2效果Step）'), true);
  assert.equal(isStepEnhancementOption('增强效果（+2伤害Step）'), true);
  assert.equal(isStepEnhancementOption('增强效果（+2 效果阶数）'), true);
  assert.equal(isStepEnhancementOption('增强效果（-2 物理护甲）'), false);
});

test('Active Buffs dynamically stack into derived stats and weapon rolls without mutating base character or gear values', () => {
  const st = createInitialState();
  const basePl = {
    ...st.pl,
    armor: { name: '硬皮甲', pa: 5, ma: 0, initPen: 1 },
    shield: { name: '圆盾', pd: 1, md: 0, initPen: 0 },
    weapons: [
      { id: 'w1', name: '阔剑', dmgStep: 5 },
      { id: 'w_bow', name: '长弓', dmgStep: 4 },
    ],
    talents: [...st.pl.talents, { id: 't_sc', name: '施法', attr: 'PER', rank: 4, strain: 0, isAttack: false }],
  };
  const baseDerived = getPlDerivedView(basePl);

  const airArmor = ED4Engine.findSpellInDb('气元素甲');
  const willow = ED4Engine.findSpellInDb('柳枝护盾');
  const flameweapon = ED4Engine.findSpellInDb('火焰武器');
  const arrowNight = ED4Engine.findSpellInDb('夜之箭矢');

  assert.equal(getBuffTargetKind(airArmor), 'character');
  assert.equal(getBuffTargetKind(willow), 'shield');
  assert.equal(getBuffTargetKind(flameweapon), 'weapon');
  assert.equal(getBuffTargetKind(arrowNight), 'weapon');

  const airPlan = computeSpellEffectPlan({
    spell: airArmor,
    pl: basePl,
    derived: baseDerived,
    extraThreadsCount: 1,
    selectedExtraOptions: ['增强效果（+1物理护甲）'],
    castingExtraSuccesses: 1,
  });
  const airBuff = buildActiveBuffEntry({ spell: airArmor, plan: airPlan });

  const willowPlan = computeSpellEffectPlan({
    spell: willow,
    pl: basePl,
    derived: baseDerived,
    extraThreadsCount: 0,
    selectedExtraOptions: [],
    castingExtraSuccesses: 2,
  });
  const willowBuff = buildActiveBuffEntry({
    spell: willow,
    plan: willowPlan,
    targetItemId: 'shield',
    targetItemName: '圆盾',
  });

  const flameStepOpt = flameweapon.extraThreads.find((o: string) => isStepEnhancementOption(o));
  const flamePlan = computeSpellEffectPlan({
    spell: flameweapon,
    pl: basePl,
    derived: baseDerived,
    extraThreadsCount: 1,
    selectedExtraOptions: [flameStepOpt],
    castingExtraSuccesses: 1,
  });
  const flameBuff = buildActiveBuffEntry({
    spell: flameweapon,
    plan: flamePlan,
    targetItemId: 'w1',
    targetItemName: '阔剑',
  });

  const arrowPlan = computeSpellEffectPlan({
    spell: arrowNight,
    pl: basePl,
    derived: baseDerived,
    extraThreadsCount: 0,
    selectedExtraOptions: [],
    castingExtraSuccesses: 1,
  });
  const arrowBuff = buildActiveBuffEntry({
    spell: arrowNight,
    plan: arrowPlan,
    targetItemId: 'w_bow',
    targetItemName: '长弓',
  });

  const buffedPl = {
    ...basePl,
    activeBuffs: [airBuff, willowBuff, flameBuff, arrowBuff],
  };

  // Base armor / shield / weapon fields are NEVER mutated
  assert.equal(buffedPl.armor.pa, 5);
  assert.equal(buffedPl.shield.pd, 1);
  assert.equal(buffedPl.weapons[0].dmgStep, 5);
  assert.equal(buffedPl.weapons[1].dmgStep, 4);

  // Derived view stacks Air Armor (+4 PA) and Willow Shield (+2 PD, +2 MD)
  const buffedDerived = getPlDerivedView(buffedPl);
  assert.equal(buffedDerived.pa, baseDerived.pa + 4);
  assert.equal(buffedDerived.pd, baseDerived.pd + 2);
  assert.equal(buffedDerived.md, baseDerived.md + 2);

  // Blindsided disables shield buff just like shield PD/MD
  const blindBuffedDerived = getPlDerivedView({
    ...buffedPl,
    statuses: { ...buffedPl.statuses, blindsided: true },
  });
  assert.equal(blindBuffedDerived.pd, getPlDerivedView({ ...basePl, statuses: { ...basePl.statuses, blindsided: true } }).pd);

  // Weapon effects apply per attached weapon ID
  const swordFx = getWeaponBuffEffects(buffedPl.activeBuffs, 'w1', '阔剑');
  assert.equal(swordFx.dmgStepBonus, 0);
  assert.equal(swordFx.extraDice.length, 1);
  assert.equal(swordFx.extraDice[0].step, 6); // Step 4 + 2 from extra thread
  assert.equal(swordFx.extraDice[0].element, '火焰');

  const bowFx = getWeaponBuffEffects(buffedPl.activeBuffs, 'w_bow', '长弓');
  assert.equal(bowFx.dmgStepBonus, 6);
  assert.ok(bowFx.notes.some((n) => n.includes('秘法护甲 -2')));

  // Removing buffs cleanly reverts derived stats back to base
  const unbuffedDerived = getPlDerivedView({ ...buffedPl, activeBuffs: [] });
  assert.equal(unbuffedDerived.pa, baseDerived.pa);
  assert.equal(unbuffedDerived.pd, baseDerived.pd);
  assert.equal(unbuffedDerived.md, baseDerived.md);
});
