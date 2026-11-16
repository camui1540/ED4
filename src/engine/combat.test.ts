import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import ED4Engine from './ed4_engine.js';
import {
  createInitialState,
  getPlDerivedView,
  applyDamageToMonsterPure,
  applyDamageToPlPure,
  sortInitiativeList,
  applyImportedCharacter,
} from './combatHelpers.ts';
import {
  buildCharacterWorkbook,
  getExportBaseName,
  serializeCharacterToTxt,
} from './characterExport.ts';

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

test('TXT and Excel export perform 100% lossless round-trip for default & customized caster characters', () => {
  const st = createInitialState();

  // 1. Default character (兰达尔)
  const defaultDerived = getPlDerivedView(st.pl);
  assert.equal(getExportBaseName(st.pl), '兰达尔_ED4_1环');

  const defaultTxt = serializeCharacterToTxt(st.pl);
  const reTxtDefault = applyImportedCharacter(st.pl, ED4Engine.parseTxtSheet(defaultTxt));
  const reTxtDefDerived = getPlDerivedView(reTxtDefault);
  assert.equal(reTxtDefault.name, st.pl.name);
  assert.equal(reTxtDefault.raceId, st.pl.raceId);
  assert.equal(reTxtDefault.disciplineId, st.pl.disciplineId);
  assert.equal(reTxtDefDerived.pd, defaultDerived.pd);
  assert.equal(reTxtDefDerived.pa, defaultDerived.pa);
  assert.equal(reTxtDefDerived.ma, defaultDerived.ma);
  assert.equal(reTxtDefDerived.initStep, defaultDerived.initStep);
  assert.equal(reTxtDefault.talents.length, st.pl.talents.length);
  assert.equal(reTxtDefault.skills.length, st.pl.skills.length);
  assert.equal(reTxtDefault.weapons.length, st.pl.weapons.length);

  // 2. Customized high-circle caster with 7 gear items + 2 thread items + 4 spells (3 matrix + 1 grimoire)
  const customPl = {
    ...st.pl,
    name: '赛琳娜',
    raceId: 'elf',
    disciplineId: 'wizard',
    circle: 5,
    attrMods: { DEX: 3, STR: 0, TOU: 2, PER: 6, WIL: 6, CHA: 2 },
    armor: { name: '附魔丝袍', pa: 2, ma: 3, initPen: 1 },
    shield: { name: '符文小盾', pd: 1, md: 1, initPen: 0 },
    currentDamage: 14,
    bloodDamage: 4,
    wounds: 1,
    karmaCurrent: 12,
    legend: { total: '3500', current: '1200', status: '第2阶', renown: '奥术学者', reputation: '塔楼客座' },
    wealth: { copper: 45, silver: 120, gold: 18, other: '秘法水晶x2' },
    talents: [
      { id: 't1', name: '脉路编织', attr: 'PER', rank: 5, strain: 0, isAttack: false },
      { id: 't2', name: '施法', attr: 'PER', rank: 5, strain: 0, isAttack: false },
      { id: 't3', name: '星界视界', attr: 'PER', rank: 3, strain: 1, isAttack: false },
    ],
    skills: [
      { id: 's1', category: '知识技能', name: '历史学', rank: 3, attr: 'PER', strain: 0, isAttack: false },
      { id: 's2', category: '工匠技能', name: '炼金术', rank: 2, attr: 'PER', strain: 1, isAttack: false },
    ],
    weapons: [{ id: 'w1', name: '符文短杖', dmgStep: 3 }],
    gear: [
      { name: '施法者背包', rank: '1', effect: '', equipped: true },
      { name: '风干口粮', rank: '5', effect: '', equipped: true },
      { name: '炼金火把', rank: '3', effect: '', equipped: true },
      { name: '治疗药水', rank: '2', effect: '', equipped: true },
      { name: '墨水与鹅毛笔', rank: '1', effect: '', equipped: true },
    ],
    threadItems: [
      { name: '星辉徽章', type: '护身符', effect: '意志+1 秘法防御+1', equipped: true },
      { name: '月影斗篷', type: '披风', effect: '感知+1 秘法护甲+1', equipped: true },
    ],
    spells: [
      { ...ED4Engine.findSpellInDb('心灵匕首'), instanceId: 'sp1', wovenThreads: 0, inMatrix: true },
      { ...ED4Engine.findSpellInDb('法师护甲'), instanceId: 'sp2', wovenThreads: 1, inMatrix: true },
      {
        id: 'custom_arc',
        instanceId: 'sp3',
        nameCn: '自定义奥术冲击',
        nameEn: '',
        discipline: 'wizard',
        circle: 3,
        threads: 2,
        weavingBase: 7,
        weavingHigh: 12,
        castingType: 'TMD',
        castingDn: null,
        range: '40码',
        duration: '即时',
        aoe: '',
        effectFormula: 'WIL+6',
        effectType: 'damage',
        armorType: 'ma',
        desc: '造成奥术震荡伤害',
        wovenThreads: 0,
        inMatrix: true,
      },
      { ...ED4Engine.findSpellInDb('猫眼'), instanceId: 'sp4', wovenThreads: 0, inMatrix: false },
    ],
  };

  const baseCustomDerived = getPlDerivedView(customPl);
  assert.equal(getExportBaseName(customPl), '赛琳娜_ED4_5环');

  // A) TXT round-trip
  const txtOut = serializeCharacterToTxt(customPl);
  const fromTxt = applyImportedCharacter(st.pl, ED4Engine.parseTxtSheet(txtOut));
  const txtDerived = getPlDerivedView(fromTxt);
  assert.equal(fromTxt.name, '赛琳娜');
  assert.equal(fromTxt.circle, 5);
  assert.deepEqual(txtDerived.attrs, baseCustomDerived.attrs);
  assert.equal(txtDerived.pd, baseCustomDerived.pd);
  assert.equal(txtDerived.md, baseCustomDerived.md);
  assert.equal(txtDerived.pa, baseCustomDerived.pa);
  assert.equal(txtDerived.ma, baseCustomDerived.ma);
  assert.equal(txtDerived.initStep, baseCustomDerived.initStep);
  assert.equal(txtDerived.effUncon, baseCustomDerived.effUncon);
  assert.equal(txtDerived.effDeath, baseCustomDerived.effDeath);
  assert.equal(fromTxt.currentDamage, 14);
  assert.equal(fromTxt.bloodDamage, 4);
  assert.equal(fromTxt.wounds, 1);
  assert.equal(fromTxt.karmaCurrent, 12);
  assert.equal(fromTxt.threadItems.length, 2);
  assert.equal(fromTxt.spells.length, 4);
  assert.equal(fromTxt.spells[3].inMatrix, false);
  assert.equal(fromTxt.spells[2].nameCn, '自定义奥术冲击');
  assert.equal(fromTxt.legend.total, '3500');
  assert.equal(Number(fromTxt.wealth.gold), 18);

  // B) Excel (.xlsx) write -> read -> parse -> apply round-trip
  const wb = buildCharacterWorkbook(customPl);
  const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const wbRead = XLSX.read(xlsxBuf, { type: 'array' });
  const fromXlsx = applyImportedCharacter(st.pl, ED4Engine.parseExcelWorkbook(wbRead));
  const xlsxDerived = getPlDerivedView(fromXlsx);

  assert.equal(fromXlsx.name, '赛琳娜');
  assert.equal(fromXlsx.raceId, 'elf');
  assert.equal(fromXlsx.disciplineId, 'wizard');
  assert.equal(fromXlsx.circle, 5);
  assert.deepEqual(xlsxDerived.attrs, baseCustomDerived.attrs);
  assert.equal(xlsxDerived.pd, baseCustomDerived.pd);
  assert.equal(xlsxDerived.md, baseCustomDerived.md);
  assert.equal(xlsxDerived.sd, baseCustomDerived.sd);
  assert.equal(xlsxDerived.pa, baseCustomDerived.pa);
  assert.equal(xlsxDerived.ma, baseCustomDerived.ma);
  assert.equal(xlsxDerived.initStep, baseCustomDerived.initStep);
  assert.equal(xlsxDerived.effUncon, baseCustomDerived.effUncon);
  assert.equal(xlsxDerived.effDeath, baseCustomDerived.effDeath);
  assert.equal(fromXlsx.currentDamage, 14);
  assert.equal(fromXlsx.bloodDamage, 4);
  assert.equal(fromXlsx.wounds, 1);
  assert.equal(fromXlsx.karmaCurrent, 12);
  assert.equal(fromXlsx.threadItems.length, 2);
  assert.equal(fromXlsx.skills.length, 2);
  assert.equal(fromXlsx.skills[1].strain, 1);
  assert.equal(fromXlsx.talents[2].strain, 1);
  assert.equal(fromXlsx.spells.length, 4);
  assert.equal(fromXlsx.spells.filter((s: any) => s.inMatrix).length, 3);
  assert.equal(fromXlsx.spells[3].inMatrix, false);
  assert.equal(fromXlsx.legend.renown, '奥术学者');
  assert.equal(fromXlsx.wealth.other, '秘法水晶x2');

  // C) Double round-trip idempotence (Excel -> Import -> Excel -> Import)
  const wb2 = buildCharacterWorkbook(fromXlsx);
  const xlsxBuf2 = XLSX.write(wb2, { bookType: 'xlsx', type: 'array' });
  const fromXlsx2 = applyImportedCharacter(st.pl, ED4Engine.parseExcelWorkbook(XLSX.read(xlsxBuf2, { type: 'array' })));
  const xlsxDerived2 = getPlDerivedView(fromXlsx2);
  assert.deepEqual(xlsxDerived2.attrs, xlsxDerived.attrs);
  assert.equal(xlsxDerived2.pa, xlsxDerived.pa);
  assert.equal(xlsxDerived2.ma, xlsxDerived.ma);
  assert.equal(xlsxDerived2.pd, xlsxDerived.pd);
  assert.equal(fromXlsx2.gear.length, fromXlsx.gear.length);
});
