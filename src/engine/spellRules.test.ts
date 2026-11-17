import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ED4Engine from './ed4_engine.js';
import { createInitialState, getPlDerivedView } from './combatHelpers';
import {
  computeSpellEffectPlan,
  enrichSpellWithDb,
  getCircleExtraThreadCap,
  getExtraThreadRuleInfo,
  isStepEnhancementOption,
  isVersatilityWeaving,
  resolveCastingDn,
  resolveWeavingRollOutcome,
} from './spellRules';

test('SPELLS_DB matches uploaded ed4_spells_with_extra_threads JSON and includes extraThreads fields', () => {
  const raw = JSON.parse(
    fs.readFileSync('public/assets/aistudio/ed4_spells_with_extra_threads_82420fd9.json', 'utf8')
  );
  assert.equal(ED4Engine.SPELLS_DB.length, raw.length);

  for (const jsonSpell of raw) {
    const dbSpell = ED4Engine.SPELLS_DB.find((s: any) => s.id === jsonSpell.id);
    assert.ok(dbSpell, `Missing spell ${jsonSpell.id}`);
    assert.deepEqual(dbSpell.extraThreads, jsonSpell.extraThreads);
    assert.equal(dbSpell.extraEffectStepPerThread, jsonSpell.extraEffectStepPerThread);
  }

  // Legacy saved spell without extraThreads hydrates cleanly
  const staleSpell = { id: 'ill_ephemeral_bolt', nameCn: '瞬息之箭', threads: 0, wovenThreads: 0 };
  const hydrated = enrichSpellWithDb(staleSpell);
  assert.equal(hydrated.extraEffectStepPerThread, 2);
  assert.ok(hydrated.extraThreads.includes('增强效果（+2 效果阶数）'));
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
  const physician = ED4Engine.findSpellInDb('残酷医者之貌');
  const bolt = ED4Engine.findSpellInDb('瞬息之箭');

  // 1. 5-circle Elementalist casting Elementalist spell -> +2 extra (2+2=4)
  const ele5 = {
    ...st.pl,
    raceId: 'elf',
    disciplineId: 'elementalist',
    circle: 5,
    talents: [{ id: 't1', name: '元素编织', attr: 'PER', rank: 5, strain: 0, isAttack: false }],
  };
  const eleRule = getExtraThreadRuleInfo(ele5, fireball);
  assert.equal(eleRule.maxExtra, 2);
  assert.equal(eleRule.maxTotal, 4);
  assert.equal(eleRule.reason, 'circle');

  // 2. Empty extraThreads -> 0 even for high-circle matching Nethermancer
  const net10 = {
    ...st.pl,
    raceId: 'human',
    disciplineId: 'nethermancer',
    circle: 10,
    talents: [{ id: 't1', name: '下界编织', attr: 'PER', rank: 8, strain: 0, isAttack: false }],
  };
  const physicianRule = getExtraThreadRuleInfo(net10, physician);
  assert.equal(physicianRule.maxExtra, 0);
  assert.equal(physicianRule.maxTotal, physician.threads);
  assert.equal(physicianRule.reason, 'empty');

  // 3. Human Swordmaster with Versatility -> 0 extra threads
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

  // 4. Cross-discipline caster (Wizard casting Elementalist spell without Elementalist Circle) -> 0 extra
  const wiz5 = { ...ele5, disciplineId: 'wizard', talents: [{ id: 'tw', name: '巫术编织', attr: 'PER', rank: 5, strain: 0, isAttack: false }] };
  assert.equal(isVersatilityWeaving(wiz5, fireball), true);
  assert.equal(getExtraThreadRuleInfo(wiz5, fireball).maxExtra, 0);
});

test('Weaving roll truncation clamps to maxTotalThreads and emits truncation warning', () => {
  const st = createInitialState();
  const spear = ED4Engine.findSpellInDb('星质长矛'); // base threads: 1
  const net5 = {
    ...st.pl,
    disciplineId: 'nethermancer',
    circle: 5,
    talents: [{ id: 't1', name: '下界编织', attr: 'PER', rank: 5, strain: 0, isAttack: false }],
  };
  const rule = getExtraThreadRuleInfo(net5, spear);
  assert.equal(rule.maxExtra, 2);
  assert.equal(rule.maxTotal, 3); // 1 base + 2 extra

  // Overflow from 0 -> gained 5 -> clamped to 3/1
  const overflowRes = resolveWeavingRollOutcome({ currentWoven: 0, gained: 5, rule });
  assert.equal(overflowRes.nextWoven, 3);
  assert.equal(overflowRes.overflowed, true);
  assert.equal(overflowRes.overflowAmount, 2);
  assert.equal(overflowRes.extraThreadsCount, 2);
  assert.equal(overflowRes.logText, '成功，已达 5 环额外脉路上限 3/1，溢出成功度作废');

  // Within cap
  const normalRes = resolveWeavingRollOutcome({ currentWoven: 0, gained: 2, rule });
  assert.equal(normalRes.nextWoven, 2);
  assert.equal(normalRes.overflowed, false);
  assert.equal(normalRes.extraThreadsCount, 1);
  assert.ok(normalRes.logText.includes('2/1'));
});

test('TMD input resolves optional casting DN and Effect Plan calculates STEP breakdown cleanly', () => {
  const st = createInitialState();
  const bolt = ED4Engine.findSpellInDb('瞬息之箭'); // WIL+4, extraEffectStepPerThread: 2
  const airArmor = ED4Engine.findSpellInDb('气元素甲'); // +3 物理护甲, extraEffectStepPerThread: 0

  // Blank TMD + no target -> roll-only (dn: null)
  assert.equal(resolveCastingDn({ spell: bolt, manualTmd: '', targetValue: '', monsters: [] }).dn, null);

  // Explicit TMD overrides even when target dropdown empty
  const manualDn = resolveCastingDn({ spell: bolt, manualTmd: '12', targetValue: '', monsters: [] });
  assert.equal(manualDn.dn, 12);
  assert.equal(manualDn.source, 'manual');

  // Effect Plan: Illusionist 5-circle, WIL 16 (Step 7), no Willforce, 2 extra threads both "+2 效果阶数", 1 casting extra success
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

  const planFullStep = computeSpellEffectPlan({
    spell: bolt,
    pl: ill5,
    derived,
    extraThreadsCount: 2,
    selectedExtraOptions: ['增强效果（+2 效果阶数）', '增强效果（+2 效果阶数）'],
    castingExtraSuccesses: 1,
  });
  assert.equal(planFullStep.hasBaseRoll, true);
  assert.equal(planFullStep.baseStep, 11); // WIL(7)+4
  assert.equal(planFullStep.extraThreadStepBonus, 4);
  assert.equal(planFullStep.castingExtraStepBonus, 2);
  assert.equal(planFullStep.finalStep, 17);
  assert.ok(planFullStep.breakdownText.includes('基础效果 WIL+4'));
  assert.ok(planFullStep.breakdownText.includes('额外脉路 +4 STEP (2条)'));
  assert.ok(planFullStep.breakdownText.includes('施法额外成功 +2 STEP'));

  // Mixed choices: 1 STEP enhancement + 1 Range expansion
  const planMixed = computeSpellEffectPlan({
    spell: bolt,
    pl: ill5,
    derived,
    extraThreadsCount: 2,
    selectedExtraOptions: ['增强效果（+2 效果阶数）', '扩大范围（+10 码）'],
    castingExtraSuccesses: 1,
  });
  assert.equal(planMixed.extraThreadStepBonus, 2);
  assert.equal(planMixed.castingExtraStepBonus, 2);
  assert.equal(planMixed.finalStep, 15);
  assert.equal(planMixed.tagsText, '扩大范围（+10 码）');

  // Spell with extraEffectStepPerThread === 0: never adds STEP from extra threads or casting extra successes
  const planBuff = computeSpellEffectPlan({
    spell: airArmor,
    pl: ill5,
    derived,
    extraThreadsCount: 2,
    selectedExtraOptions: ['提高持续时间（+2 分钟）', '增强效果（+2 加值）'],
    castingExtraSuccesses: 3,
  });
  assert.equal(planBuff.hasBaseRoll, false);
  assert.equal(planBuff.extraThreadStepBonus, 0);
  assert.equal(planBuff.castingExtraStepBonus, 0);
  assert.equal(planBuff.finalStep, null);
  assert.ok(planBuff.tagsText.includes('提高持续时间（+2 分钟）'));
  assert.ok(planBuff.tagsText.includes('增强效果（+2 加值）'));

  // Verify isStepEnhancementOption rejects non-STEP enhancements like -2 PA or +2 bonus
  assert.equal(isStepEnhancementOption('增强效果（+2 效果阶数）'), true);
  assert.equal(isStepEnhancementOption('增强效果（-2 物理护甲）'), false);
  assert.equal(isStepEnhancementOption('增强效果（+2 加值）'), false);
});
