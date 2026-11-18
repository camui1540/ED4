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
import ExcelJS from 'exceljs';
import {
  exportCharacterExcelBuffer,
  extractPortraitFromXlsxBuffer,
  getExportBaseName,
  serializeCharacterToTxt,
} from './characterExport.ts';
import {
  buildCharacterSyncPayload,
  buildLogInsertPayload,
  buildRoomInviteUrl,
  buildRoomStatePayload,
  extractRoomCodeFromUrl,
  generateRoomCode,
  isSupabaseConfigured,
  mergeCharacterList,
  mergeIncomingLogs,
} from './supabaseSync.ts';

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
  assert.equal(sp1?.id, 'astral-spear');
  assert.equal(ED4Engine.hasSpellEffectRoll(sp1), true);
  assert.equal(ED4Engine.LEGACY_SPELL_ID_MAP.net_astral_spear, 'astral-spear');

  const sp2 = ED4Engine.findSpellInDb('Catseyes');
  assert.equal(sp2?.id, 'catseyes');
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

test('TXT and Excel export perform lossless round-trip for default & customized caster characters', async () => {
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

  // B) Excel (.xlsx) write -> read -> parse -> apply round-trip (all imported spells go into grimoire inMatrix=false)
  const xlsxBuf = await exportCharacterExcelBuffer(customPl);
  const wbRead = XLSX.read(new Uint8Array(xlsxBuf), { type: 'array' });
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
  assert.deepEqual(
    fromXlsx.spells.map((s: any) => s.nameCn),
    ['心灵匕首', '法师护甲', '自定义奥术冲击', '猫眼']
  );
  assert.equal(fromXlsx.spells.every((s: any) => s.inMatrix === false), true);
  assert.equal(fromXlsx.legend.renown, '奥术学者');
  assert.equal(fromXlsx.wealth.other, '秘法水晶x2');

  // C) Double round-trip idempotence (Excel -> Import -> Excel -> Import)
  const xlsxBuf2 = await exportCharacterExcelBuffer(fromXlsx);
  const fromXlsx2 = applyImportedCharacter(st.pl, ED4Engine.parseExcelWorkbook(XLSX.read(new Uint8Array(xlsxBuf2), { type: 'array' })));
  const xlsxDerived2 = getPlDerivedView(fromXlsx2);
  assert.deepEqual(xlsxDerived2.attrs, xlsxDerived.attrs);
  assert.equal(xlsxDerived2.pa, xlsxDerived.pa);
  assert.equal(xlsxDerived2.ma, xlsxDerived.ma);
  assert.equal(xlsxDerived2.pd, xlsxDerived.pd);
  assert.equal(fromXlsx2.gear.length, fromXlsx.gear.length);
});

test('Supabase Realtime sync helpers handle graceful offline fallback, arbitrary room codes, and idempotent merges', () => {
  assert.equal(isSupabaseConfigured, false);

  const code = generateRoomCode();
  assert.match(code, /^\d{6}$/);

  assert.equal(extractRoomCodeFromUrl('?room=ED4921'), 'ED4921');
  assert.equal(extractRoomCodeFromUrl('?foo=1&room=%E9%BE%99%E4%B8%8E%E5%9C%B0%E4%B8%8B%E5%9F%8E'), '龙与地下城');
  assert.equal(buildRoomInviteUrl('龙与地下城'), '?room=%E9%BE%99%E4%B8%8E%E5%9C%B0%E4%B8%8B%E5%9F%8E');

  const st = createInitialState();
  const roomState = buildRoomStatePayload({ ...st, round: 3, turnIndex: 1 }, 'client_gm');
  assert.equal(roomState.round, 3);
  assert.equal(roomState.turnIndex, 1);
  assert.equal(roomState.updatedBy, 'client_gm');

  const charPayload = buildCharacterSyncPayload({
    roomCode: '114514',
    clientId: 'client_pl1',
    nickname: '小王',
    role: 'pl',
    pl: {
      ...st.pl,
      currentDamage: 12,
      wounds: 1,
      spells: [{ nameCn: '心灵匕首', threads: 1, wovenThreads: 1, inMatrix: true }],
      gear: [{ name: '附魔盾', effect: '物理防御+1', equipped: true }],
    },
  });
  assert.equal(charPayload.id, '114514::client_pl1');
  assert.equal(charPayload.current_damage, 12);
  assert.equal(charPayload.wounds, 1);
  assert.equal(charPayload.spells_summary[0].wovenThreads, 1);
  assert.equal(charPayload.gear_summary.length, 1);

  // Idempotent character upsert & delete
  let roster = mergeCharacterList([], 'INSERT', charPayload);
  roster = mergeCharacterList(roster, 'UPDATE', { ...charPayload, wounds: 2 });
  assert.equal(roster.length, 1);
  assert.equal(roster[0].wounds, 2);
  roster = mergeCharacterList(roster, 'DELETE', null, { id: charPayload.id, client_id: charPayload.client_id });
  assert.equal(roster.length, 0);

  // Idempotent log deduplication
  const logRow = buildLogInsertPayload({
    roomCode: '114514',
    clientId: 'client_pl1',
    senderName: '小王',
    senderRole: 'pl',
    log: { id: 'log_abc', text: '掷骰 → 14', detail: 'D20[14]', type: 'hit', time: '12:00:00' },
  });
  assert.equal(logRow.room_code, '114514');
  const logs1 = mergeIncomingLogs([], [{ id: 'log_abc', text: '掷骰 → 14' }]);
  const logs2 = mergeIncomingLogs(logs1, [{ id: 'log_abc', text: '掷骰 → 14' }, { id: 'log_xyz', text: '掷骰 → 9' }]);
  assert.equal(logs2.length, 2);
});

test('Character background supports TXT tags, Excel label/I44 merged fallback, and lossless round-trip export', async () => {
  const st = createInitialState();
  assert.equal(st.pl.background, '');

  const bgStory = '出生于风之峭壁。\n曾随飞空艇航行三年。\n\n如今寻找失落的塔拉林遗迹。';
  const richPl = { ...st.pl, background: bgStory };

  // 1. TXT round-trip & tag variants
  const exportedTxt = serializeCharacterToTxt(richPl);
  assert.ok(exportedTxt.endsWith(`\n\n【背景故事】\n${bgStory}`));
  const fromTxt = applyImportedCharacter(st.pl, ED4Engine.parseTxtSheet(exportedTxt));
  assert.equal(fromTxt.background, bgStory);

  const variantTxt = [
    '角色名：行者',
    '装备',
    '名称\t等级\t效果',
    '长袍\t1\t物理护甲+1',
    '[背景]',
    '第一行背景',
    '第二行背景',
    '【备注】',
    '不应计入背景的行',
  ].join('\n');
  const parsedVariant = ED4Engine.parseTxtSheet(variantTxt);
  assert.equal(parsedVariant.background, '第一行背景\n第二行背景');
  assert.equal(parsedVariant.gear.length, 1);

  const inlineColonTxt = '角色名：行者\n背景：单行起点\n后续第二行';
  assert.equal(ED4Engine.parseTxtSheet(inlineColonTxt).background, '单行起点\n后续第二行');

  // 2. Excel export -> I44 lossless round-trip
  const wbBytes = await exportCharacterExcelBuffer(richPl);
  const readExported = XLSX.read(new Uint8Array(wbBytes), { type: 'array' });
  assert.equal(readExported.Sheets['Sheet1']?.I44?.v, bgStory);
  const fromXlsx = applyImportedCharacter(st.pl, ED4Engine.parseExcelWorkbook(readExported));
  assert.equal(fromXlsx.background, bgStory);

  // 3. Excel I44 merged-cell fallback (merge starts at H44:J48, covering I44 without header label)
  const mergedWs: XLSX.WorkSheet = {
    A2: { t: 's', v: '角色名' },
    B2: { t: 's', v: '卡林' },
    H44: { t: 's', v: '合并单元格多行\n背景故事' },
    '!merges': [{ s: { r: 43, c: 7 }, e: { r: 47, c: 9 } }],
    '!ref': 'A1:J48',
  };
  const mergedWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(mergedWb, mergedWs, 'Sheet1');
  assert.equal(ED4Engine.parseExcelWorkbook(mergedWb).background, '合并单元格多行\n背景故事');

  // 4. Excel explicit "人物背景" label (below cell)
  const labeledWs: XLSX.WorkSheet = {
    A2: { t: 's', v: '角色名' },
    B2: { t: 's', v: '艾拉' },
    A50: { t: 's', v: '人物背景' },
    A51: { t: 's', v: '标签下方文本' },
    I44: { t: 's', v: '不应优先使用的I44' },
    '!ref': 'A1:I52',
  };
  const labeledWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(labeledWb, labeledWs, 'Sheet1');
  assert.equal(ED4Engine.parseExcelWorkbook(labeledWb).background, '标签下方文本');

  // 5. Supabase payload carries background
  const syncRow = buildCharacterSyncPayload({
    roomCode: '114514',
    clientId: 'c_1',
    nickname: '玩家',
    role: 'pl',
    pl: richPl,
  });
  assert.equal(syncRow.background, bgStory);

  // 6. Excel I44 with zero "背景" text anywhere (including _x000D_, stale !ref, cell.w-only, stray empty label, multi-sheet)
  const plainI44Wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(plainI44Wb, {
    A2: { t: 's', v: '角色名' },
    B2: { t: 's', v: '无标题行者' },
    I44: { t: 's', v: '纯I44第一行_x000D_\n纯I44第二行' },
    '!ref': 'A1:D10',
  }, 'Sheet1');
  assert.equal(ED4Engine.parseExcelWorkbook(plainI44Wb).background, '纯I44第一行\n纯I44第二行');

  const wOnlyWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wOnlyWb, {
    I44: { t: 's', v: '', w: '来自w字段的背景' },
    '!ref': 'A1:I44',
  }, 'Sheet1');
  assert.equal(ED4Engine.parseExcelWorkbook(wOnlyWb).background, '来自w字段的背景');

  const emptyAnchorFallbackWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(emptyAnchorFallbackWb, {
    A10: { t: 's', v: '背景' },
    I44: { t: 's', v: '空标签时兜底I44内容' },
    '!ref': 'A1:I44',
  }, 'Sheet1');
  assert.equal(ED4Engine.parseExcelWorkbook(emptyAnchorFallbackWb).background, '空标签时兜底I44内容');

  const multiSheetWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(multiSheetWb, { A2: { t: 's', v: '角色名' }, B2: { t: 's', v: '跨表角色' }, '!ref': 'A1:B2' }, '主表');
  XLSX.utils.book_append_sheet(multiSheetWb, { I44: { t: 's', v: '第二页I44背景' }, '!ref': 'A1:I44' }, '附加');
  assert.equal(ED4Engine.parseExcelWorkbook(multiSheetWb).background, '第二页I44背景');
});

test('ExcelJS template export preserves formulas, shifts column bands independently on overflow, embeds portrait, and honors cached buffer', async () => {
  const st = createInitialState();
  const samplePngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEwMhAAQAyAAQBwQ5pGgAAAABJRU5ErkJggg==';
  const portraitDataUrl = `data:image/png;base64,${samplePngBase64}`;

  const overflowPl = {
    ...st.pl,
    name: '多栏溢出测试者',
    raceId: 'elf',
    disciplineId: 'wizard',
    circle: 6,
    gender: '女',
    age: '142',
    eyeColor: '银灰',
    hairColor: '月白',
    skinColor: '苍白',
    height: '176cm',
    weight: '58kg',
    portraitUrl: portraitDataUrl,
    background: '来自星界边缘的学者。\n精通古代秘法与符文锻造。',
    armor: { name: '', pa: 0, ma: 0, initPen: 0 },
    shield: { name: '', pd: 0, md: 0, initPen: 0 },
    weapons: [
      { id: 'w1', name: '武器1', dmgStep: 4 },
      { id: 'w2', name: '武器2', dmgStep: 5 },
      { id: 'w3', name: '武器3', dmgStep: 6 },
      { id: 'w4', name: '武器4', dmgStep: 7 },
    ],
    gear: Array.from({ length: 9 }, (_, i) => ({
      name: `装备${i + 1}`,
      rank: `${i + 1}`,
      effect: i === 0 ? '物理护甲+1' : '',
      equipped: true,
    })),
    threadItems: Array.from({ length: 5 }, (_, i) => ({
      name: `脉路物品${i + 1}`,
      type: '护符',
      effect: i === 0 ? '秘法防御+1' : '',
      equipped: true,
    })),
    talents: Array.from({ length: 12 }, (_, i) => ({
      id: `t_${i}`,
      name: `天赋${i + 1}`,
      attr: 'PER',
      rank: i + 1,
      strain: i % 2,
      isAttack: false,
    })),
    spells: Array.from({ length: 25 }, (_, i) => ({
      ...ED4Engine.SPELLS_DB[i % ED4Engine.SPELLS_DB.length],
      instanceId: `sp_ov_${i}`,
      inMatrix: i < 4,
      wovenThreads: 0,
    })),
    skills: Array.from({ length: 18 }, (_, i) => ({
      id: `sk_${i}`,
      category: '通用技能',
      name: `技能${i + 1}`,
      rank: (i % 5) + 1,
      attr: 'DEX',
      strain: 0,
      isAttack: false,
    })),
  };

  const outBuf = await exportCharacterExcelBuffer(overflowPl);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(outBuf);

  assert.deepEqual(
    wb.worksheets.map((s) => s.name),
    ['Sheet1', 'Sheet2', '属性表', 'step表', '秘法护甲表']
  );

  const sheet = wb.worksheets[0];

  // Protected formula cells must still hold formulas
  for (const addr of [
    'D12', 'E12', 'F12', 'D17', 'E17', 'F17',
    'J6', 'J7', 'J8', 'J10', 'L10', 'J12',
    'B20', 'B22', 'B23', 'C26', 'D29', 'E22',
    'M15', 'N15', 'M16', 'N16', 'F34', 'G34', 'F43', 'G43',
  ]) {
    const val = sheet.getCell(addr).value as any;
    assert.ok(val && typeof val === 'object' && typeof val.formula === 'string', `Formula lost at ${addr}`);
  }

  // Weapon overflow rows 17..18 have injected formulas
  assert.equal((sheet.getCell('M17').value as any)?.formula, 'K17+E13+L17');
  assert.equal((sheet.getCell('N18').value as any)?.formula, 'VLOOKUP(M18,step表!$A$2:$B$41,2,FALSE)');

  // Talent overflow rows 44..45 have injected formulas, while Left column A:G was NOT shifted by middle/right overflow
  assert.equal(sheet.getCell('A34').value, '天赋1');
  assert.equal(sheet.getCell('A45').value, '天赋12');
  assert.equal((sheet.getCell('F44').value as any)?.formula, 'VLOOKUP(C44,Sheet2!$A$10:$B$16,2,FALSE)+B44');
  assert.equal((sheet.getCell('G45').value as any)?.formula, 'VLOOKUP(F45,step表!$A$2:$B$41,2,FALSE)');

  // Middle column shifted progressively: 装备 at 17+wExtra(2)=19, 脉路物品 at 25+wExtra(2)+gExtra(2)=29, 背景 at 44+midShift(6)=50
  assert.equal(sheet.getCell('I19').value, '装备');
  assert.equal(sheet.getCell('I29').value, '脉路物品');
  assert.equal(sheet.getCell('I50').value, overflowPl.background);

  // Right column shifted by spExtra = 25 - 22 = 3; skill header at R30, skills at 31..48
  assert.equal(sheet.getCell('T29').value, '8点可分配');
  assert.equal(sheet.getCell('R30').value, '技能');
  assert.equal(sheet.getCell('S31').value, '技能1');
  assert.equal(sheet.getCell('S48').value, '技能18');
  assert.equal((sheet.getCell('V31').value as any)?.formula, 'VLOOKUP(U31,Sheet2!$A$2:$C$7,3,FALSE)+T31');
  assert.equal((sheet.getCell('W31').value as any)?.formula, 'VLOOKUP(V31,step表!$A$2:$B$41,2,FALSE)');
  assert.equal((sheet.getCell('V47').value as any)?.formula, 'VLOOKUP(U47,Sheet2!$A$2:$C$7,3,FALSE)+T47');
  assert.equal((sheet.getCell('W48').value as any)?.formula, 'VLOOKUP(V48,step表!$A$2:$B$41,2,FALSE)');

  // Portrait round-trip extraction
  const extractedPortrait = await extractPortraitFromXlsxBuffer(outBuf);
  assert.ok(extractedPortrait.startsWith('data:image/png;base64,'));

  // Dynamic importer round-trips all overflow items + appearance fields
  const parsedOverflow = ED4Engine.parseExcelWorkbook(XLSX.read(new Uint8Array(outBuf), { type: 'array' }));
  assert.equal(parsedOverflow.gender, '女');
  assert.equal(parsedOverflow.age, '142');
  assert.equal(parsedOverflow.eyeColor, '银灰');
  assert.equal(parsedOverflow.hairColor, '月白');
  assert.equal(parsedOverflow.skinColor, '苍白');
  assert.equal(parsedOverflow.height, '176cm');
  assert.equal(parsedOverflow.weight, '58kg');
  assert.equal(parsedOverflow.weapons.length, 4);
  assert.equal(parsedOverflow.gear.length, 9);
  assert.equal(parsedOverflow.threadItems.length, 5);
  assert.equal(parsedOverflow.talents.length, 12);
  assert.equal(parsedOverflow.spells.length, 25);
  assert.equal(parsedOverflow.skills.length, 18);
  assert.equal(parsedOverflow.background, overflowPl.background);

  // Cached user template buffer overrides built-in Base64 template
  const customTplWb = new ExcelJS.Workbook();
  await customTplWb.xlsx.load(outBuf);
  customTplWb.worksheets[0].getCell('A1').value = 'CUSTOM_CACHED_MARKER';
  const customTplBuf = await customTplWb.xlsx.writeBuffer();
  const cachedOutBuf = await exportCharacterExcelBuffer(st.pl, customTplBuf as ArrayBuffer);
  const cachedCheckWb = new ExcelJS.Workbook();
  await cachedCheckWb.xlsx.load(cachedOutBuf);
  assert.equal(cachedCheckWb.worksheets[0].getCell('A1').value, 'CUSTOM_CACHED_MARKER');
});

test('Talent/Skill action & strain rules, Excel dataValidation sync, and upgraded reversible TXT export/import', async () => {
  // 1. Rule dictionary official defaults
  assert.deepEqual(ED4Engine.lookupTalentSkillRule('闪避 Avoid Blow'), { action: '自由', strain: 1 });
  assert.deepEqual(ED4Engine.lookupTalentSkillRule('杂耍防御 Acrobatic Defense'), { action: '自由', strain: 1 });
  assert.deepEqual(ED4Engine.lookupTalentSkillRule('捕风者 Wind Catcher'), { action: '简单', strain: 1 });
  assert.deepEqual(ED4Engine.lookupTalentSkillRule('投射武器 Missile Weapons'), { action: '标准', strain: 0 });
  assert.deepEqual(ED4Engine.lookupTalentSkillRule('脉路编织 Thread Weaving'), { action: '简单', strain: 0 });
  assert.equal(ED4Engine.lookupTalentSkillRule('完全自创未知天赋'), null);

  const st = createInitialState();
  const base64Img =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEwMhAAQAyAAQBwQ5pGgAAAABJRU5ErkJggg==';

  const richPl = {
    ...st.pl,
    name: '星轨',
    raceId: 'elf',
    disciplineId: 'wizard',
    circle: 4,
    gender: '女',
    age: '110',
    eyeColor: '金',
    hairColor: '银',
    skinColor: '白',
    height: '175cm',
    weight: '55kg',
    portraitUrl: base64Img,
    background: '双行背景一\n双行背景二',
    talents: Array.from({ length: 12 }, (_, i) => ({
      id: `t_${i}`,
      name: i === 0 ? '回避打击' : i === 1 ? '施法' : `测试天赋${i + 1}`,
      attr: i === 0 ? 'DEX' : 'PER',
      rank: i + 1,
      action: i === 0 ? '自由' : i === 1 ? '标准' : '简单',
      strain: i === 0 ? 1 : 0,
      isAttack: false,
    })),
    skills: Array.from({ length: 18 }, (_, i) => ({
      id: `sk_${i}`,
      category: i % 2 === 0 ? '通用技能' : '知识技能',
      name: i === 0 ? '察觉' : i === 1 ? '杂耍防御' : `测试技能${i + 1}`,
      attr: 'PER',
      rank: (i % 4) + 1,
      action: i === 1 ? '自由' : '标准',
      strain: i === 1 ? 1 : 0,
      isAttack: false,
    })),
    spells: Array.from({ length: 25 }, (_, i) => ({
      ...ED4Engine.SPELLS_DB[i % ED4Engine.SPELLS_DB.length],
      instanceId: `sp_r_${i}`,
      inMatrix: i < 2,
      wovenThreads: i === 0 ? 1 : 0,
    })),
  };

  // 2. Excel export writes action/strain 1:1 (blank when strain=0) and preserves/extends dataValidation
  const xlsxBuf = await exportCharacterExcelBuffer(richPl);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsxBuf);
  const ws = wb.worksheets[0];

  assert.equal(ws.getCell('D34').value, '自由');
  assert.equal(ws.getCell('E34').value, 1);
  assert.equal(ws.getCell('D35').value, '标准');
  assert.equal(ws.getCell('E35').value, null);
  assert.equal(ws.getCell('D45').value, '简单');

  // Right column shifted by spExtra = 3 -> skills start at row 31..48
  assert.equal(ws.getCell('X31').value, '标准');
  assert.equal(ws.getCell('Y31').value, null);
  assert.equal(ws.getCell('X32').value, '自由');
  assert.equal(ws.getCell('Y32').value, 1);
  assert.equal(ws.getCell('X48').value, '标准');

  // Verify dropdown dataValidations exist on base, shifted, and overflow rows
  assert.deepEqual(ws.getCell('D34').dataValidation?.formulae, ['"标准,简单,自由,持续,无"']);
  assert.deepEqual(ws.getCell('D44').dataValidation?.formulae, ['"标准,简单,自由,持续,无"']);
  assert.deepEqual(ws.getCell('C45').dataValidation?.formulae, ['"RANK+DEX,RANK+STR,RANK+TOU,RANK+PER,RANK+WIL,RANK+CHA,RANK"']);
  assert.deepEqual(ws.getCell('X31').dataValidation?.formulae, ['"标准,简单,自由,持续,无"']);
  assert.deepEqual(ws.getCell('X48').dataValidation?.formulae, ['"标准,简单,自由,持续,无"']);
  assert.deepEqual(ws.getCell('R48').dataValidation?.formulae, ['"通用技能,工匠技能,知识技能,语言技能"']);
  assert.deepEqual(ws.getCell('U48').dataValidation?.formulae, ['"DEX,STR,TOU,PER,WIL,CHA"']);

  // Import back from Excel preserves action & strain
  const importedFromXlsx = ED4Engine.parseExcelWorkbook(XLSX.read(new Uint8Array(xlsxBuf), { type: 'array' }));
  assert.equal(importedFromXlsx.talents[0].action, '自由');
  assert.equal(importedFromXlsx.talents[0].strain, 1);
  assert.equal(importedFromXlsx.talents[1].action, '标准');
  assert.equal(importedFromXlsx.talents[1].strain, 0);
  assert.equal(importedFromXlsx.skills[1].action, '自由');
  assert.equal(importedFromXlsx.skills[1].strain, 1);

  // 3. TXT export skips Base64 data:image, preserves http link when set, and round-trips action/strain/matrix/appearance
  const txtWithBase64 = serializeCharacterToTxt(richPl);
  assert.ok(!txtWithBase64.includes('data:image/png;base64'));
  assert.ok(!txtWithBase64.includes('立绘链接'));
  assert.ok(txtWithBase64.includes('- 回避打击 | 等级 1 | RANK+DEX | 动作: 自由 | 负荷: 1 |'));
  assert.ok(txtWithBase64.includes('- 知识技能 | 杂耍防御 | 等级 2 | PER | 动作: 自由 | 负荷: 1 |'));
  assert.ok(txtWithBase64.includes('已装载(常备矩阵)'));
  assert.ok(txtWithBase64.includes('未装载'));
  assert.ok(txtWithBase64.endsWith('\n\n【背景故事】\n双行背景一\n双行背景二'));

  const parsedTxt = applyImportedCharacter(st.pl, ED4Engine.parseTxtSheet(txtWithBase64));
  assert.equal(parsedTxt.gender, '女');
  assert.equal(parsedTxt.height, '175cm');
  assert.equal(parsedTxt.talents[0].action, '自由');
  assert.equal(parsedTxt.talents[0].strain, 1);
  assert.equal(parsedTxt.skills[1].action, '自由');
  assert.equal(parsedTxt.skills[1].strain, 1);
  assert.equal(parsedTxt.spells.length, 25);
  assert.equal(parsedTxt.spells[0].inMatrix, true);
  assert.equal(parsedTxt.spells[0].wovenThreads, 1);
  assert.equal(parsedTxt.spells[2].inMatrix, false);
  assert.equal(parsedTxt.background, '双行背景一\n双行背景二');

  const httpPortraitTxt = serializeCharacterToTxt({ ...richPl, portraitUrl: 'https://example.com/hero.png' });
  assert.ok(httpPortraitTxt.includes('立绘链接：https://example.com/hero.png'));
  assert.equal(ED4Engine.parseTxtSheet(httpPortraitTxt).portraitUrl, 'https://example.com/hero.png');

  // 4. Backward compatibility: legacy short TXT without 动作/负荷/外貌/背景 auto-fills dictionary defaults
  const legacyShortTxt = [
    '角色名：老版本风行者',
    '种族：人类',
    '门类：剑术大师',
    '环：3',
    '天赋',
    '名称\t等级\t属性\t属性步\t总步数\t负荷',
    '回避打击\t3\t敏捷\t7\t10\t1',
    '自创无记录天赋\t1\t意志\t5\t6\t0',
    '技能',
    '名称\t等级\t属性',
    '投射武器\t2\t敏捷',
    '未知冷门技能\t1\t感知',
  ].join('\n');
  const parsedLegacy = ED4Engine.parseTxtSheet(legacyShortTxt);
  assert.equal(parsedLegacy.circle, 3);
  assert.equal(parsedLegacy.talents[0].action, '自由');
  assert.equal(parsedLegacy.talents[0].strain, 1);
  assert.equal(parsedLegacy.talents[1].action, '');
  assert.equal(parsedLegacy.skills[0].action, '标准');
  assert.equal(parsedLegacy.skills[1].action, '');
});




