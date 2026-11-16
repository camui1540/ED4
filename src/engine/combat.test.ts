import test from 'node:test';
import assert from 'node:assert/strict';
import ED4Engine from './ed4_engine.js';
import {
  createInitialState,
  getPlDerivedView,
  applyDamageToMonsterPure,
  applyDamageToPlPure,
  sortInitiativeList,
  applyImportedCharacter,
} from './combatHelpers.ts';

test('Step 1-40+ mapping and attribute step conversion match ED4 rules', () => {
  assert.equal(ED4Engine.attrToStep(10), 5);
  assert.equal(ED4Engine.attrToStep(16), 7);
  assert.equal(ED4Engine.getStepDice(1).label, 'D4-2');
  assert.equal(ED4Engine.getStepDice(7).label, 'D12');
  assert.equal(ED4Engine.getStepDice(8).label, '2D6');
  assert.equal(ED4Engine.getStepDice(19).label, 'D20+2D6');
  assert.equal(ED4Engine.getStepDice(30).label, '2D20+2D6');
});

test('rollStepTest enforces Rule of One and extra successes', () => {
  const origRandom = Math.random;
  try {
    // All base dice roll 1 on a 2-dice Step 8 (2D6)
    Math.random = () => 0;
    const ruleOfOne = ED4Engine.rollStepTest(8, { dn: 2, isAction: true });
    assert.equal(ruleOfOne.isRuleOfOne, true);
    assert.equal(ruleOfOne.isSuccess, false);

    // Deterministic high roll for extra successes
    Math.random = () => 0.7; // floor(0.7*6)+1 = 5 on 2D6 -> total 10
    const pass = ED4Engine.rollStepTest(8, { dn: 5, isAction: true });
    assert.equal(pass.isRuleOfOne, false);
    assert.equal(pass.isSuccess, true);
    assert.equal(pass.extraSuccesses, 1);
  } finally {
    Math.random = origRandom;
  }
});

test('Action vs Effect isolation and equipped item bonus toggle avoid double-counting', () => {
  const st = createInitialState();
  const baseDerived = getPlDerivedView(st.pl);
  assert.equal(st.pl.recoveryCurrent, baseDerived.recoveryMax);
  assert.equal(st.pl.karmaCurrent, baseDerived.karmaMax);
  assert.equal(baseDerived.pd, 10); // T'skrang DEX 11+5=16 -> floor(19/2)=9 + shield 1 = 10

  // Toggle aggressive option: PD/MD drop by 3
  const aggPl = { ...st.pl, options: { ...st.pl.options, aggressive: true } };
  const aggDerived = getPlDerivedView(aggPl);
  assert.equal(aggDerived.pd, baseDerived.pd - 3);
  assert.equal(aggDerived.md, baseDerived.md - 3);

  // Import TXT sheet with gear armor +5 and verify equipped toggle works cleanly
  const sampleTxt = [
    '角色名：测试法师',
    '种族：人类',
    '门类：巫师',
    '环数：2',
    '敏捷：12',
    '力量：10',
    '强韧：11',
    '感知：15',
    '意志：16',
    '魅力：10',
    '装备',
    '名称\t等级\t效果',
    '奥术皮甲\t1\t物理护甲+3 秘法护甲+2',
    '法术',
    '名称',
    '猫眼',
    '法师护甲',
  ].join('\n');

  const parsed = ED4Engine.parseTxtSheet(sampleTxt);
  const importedPl = applyImportedCharacter(st.pl, parsed);
  const impDerived = getPlDerivedView(importedPl);
  assert.equal(importedPl.name, '测试法师');
  assert.equal(importedPl.spells.length, 2);
  assert.equal(impDerived.pa, 3);

  // Unequip gear -> PA drops by 3 without touching base
  importedPl.gear[0].equipped = false;
  assert.equal(getPlDerivedView(importedPl).pa, 0);
});

test('Spell DB matching and effect roll detection work for aliases and formulas', () => {
  const sp1 = ED4Engine.findSpellInDb('星界之矛');
  assert.equal(sp1?.id, 'net_astral_spear');
  assert.equal(ED4Engine.hasSpellEffectRoll(sp1), true);

  const sp2 = ED4Engine.findSpellInDb('Catseyes');
  assert.equal(sp2?.id, 'wiz_catseyes');
  assert.equal(ED4Engine.hasSpellEffectRoll(sp2), false);
});

test('Damage resolution, wounds, and initiative sorting follow ED4 rules', () => {
  const st = createInitialState();
  const ghoul = { ...st.monsterTemplates[0], instanceId: 'm_1', currentDamage: 0, wounds: 0, knockedDown: false, blindsided: false, harried: false };
  const hit = applyDamageToMonsterPure(ghoul, 15, 'pa', false, false, '兰达尔');
  // 15 raw - 3 PA = 12 net >= woundThreshold 9 -> 1 wound
  assert.equal(hit.monster.currentDamage, 12);
  assert.equal(hit.monster.wounds, 1);

  const plHit = applyDamageToPlPure(st.pl, 20, 'pa', false, false, '食尸鬼');
  assert.ok(plHit.pl.currentDamage > 0);

  const sorted = sortInitiativeList([
    { id: 'm1', type: 'gm', name: '食尸鬼', initVal: 12, initStep: 7, dexVal: 0 },
    { id: 'pl', type: 'pl', name: '兰达尔', initVal: 12, initStep: 6, dexVal: 16 },
    { id: 'm2', type: 'gm', name: '首领', initVal: 15, initStep: 9, dexVal: 0 },
  ]);
  assert.equal(sorted[0].id, 'm2');
  assert.equal(sorted[1].id, 'pl');
});
