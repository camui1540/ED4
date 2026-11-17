import * as XLSX from 'xlsx';
import ED4Engine from './ed4_engine.js';
import { getPlDerivedView } from './combatHelpers';

/**
 * 构建用于导出的完整装备清单：
 * 若面板手动填写了物理/秘法护甲或盾牌防御，且尚未通过装备/脉路物品效果体现，
 * 则镜像为等价的已穿戴装备条目，保证导入后防御与护甲总值 100% 无损且不重复叠加。
 */
function buildExportGearList(pl: any) {
  const list = (pl.gear || []).map((g: any) => ({
    name: String(g.name || '').trim(),
    rank: String(g.rank || '').trim(),
    effect: String(g.effect || '').trim(),
    equipped: g.equipped !== false,
  }));

  const armorPa = Number(pl.armor?.pa) || 0;
  const armorMa = Number(pl.armor?.ma) || 0;
  if (armorPa > 0 || armorMa > 0) {
    const effParts: string[] = [];
    if (armorPa > 0) effParts.push(`物理护甲+${armorPa}`);
    if (armorMa > 0) effParts.push(`秘法护甲+${armorMa}`);
    list.push({
      name: String(pl.armor?.name || '护甲').trim() || '护甲',
      rank: '-',
      effect: effParts.join(' '),
      equipped: true,
    });
  }

  const shieldPd = Number(pl.shield?.pd) || 0;
  const shieldMd = Number(pl.shield?.md) || 0;
  if (shieldPd > 0 || shieldMd > 0) {
    const effParts: string[] = [];
    if (shieldPd > 0) effParts.push(`物理防御+${shieldPd}`);
    if (shieldMd > 0) effParts.push(`秘法防御+${shieldMd}`);
    list.push({
      name: String(pl.shield?.name || '盾牌').trim() || '盾牌',
      rank: '-',
      effect: effParts.join(' '),
      equipped: true,
    });
  }

  return list;
}

/**
 * 将法术列表按“常备法术矩阵在前、法术书在后”排序，
 * 以便导入时前 3 条自动恢复至常备矩阵。
 */
function getOrderedSpellsForExport(pl: any) {
  const spells = pl.spells || [];
  const matrix = spells.filter((s: any) => s.inMatrix !== false);
  const grimoire = spells.filter((s: any) => s.inMatrix === false);
  return [...matrix, ...grimoire];
}

/**
 * 将实时角色状态序列化为可被 ED4Engine.parseTxtSheet 100% 无损回读的 TXT 文本
 */
export function serializeCharacterToTxt(pl: any): string {
  const d = getPlDerivedView(pl);
  const lines: string[] = [];

  lines.push(`角色名：${pl.name || ''}`);
  lines.push(`种族：${d.race.name}`);
  lines.push(`门类：${d.prog.disc.name}`);
  lines.push(`环数：${pl.circle}`);
  lines.push('');

  lines.push('属性');
  Object.entries(ED4Engine.ATTR_NAMES).forEach(([k, cn]) => {
    lines.push(`${cn}：${d.attrs[k]}`);
  });
  lines.push('');

  lines.push('先攻');
  lines.push(`基础：${d.steps.DEX}`);
  lines.push(`护甲调整：${Number(pl.armor?.initPen) || 0}`);
  lines.push(`先攻步数：${d.initStep}`);
  lines.push('');

  lines.push('业力');
  lines.push(`可用：${pl.karmaCurrent ?? d.karmaMax}`);
  lines.push(`上限：${d.karmaMax}`);
  lines.push('');

  lines.push('健康等级');
  lines.push(`当前伤害：${Number(pl.currentDamage) || 0}`);
  lines.push(`血魔法伤害：${Number(pl.bloodDamage) || 0}`);
  lines.push(`负伤：${Number(pl.wounds) || 0}`);
  lines.push(`意识丧失：${d.effUncon}`);
  lines.push(`死亡：${d.effDeath}`);
  lines.push(`负伤阈值：${d.woundThreshold}`);
  lines.push('');

  lines.push('天赋');
  lines.push('名称\t等级\t属性\t属性步\t总步数\t负荷');
  (pl.talents || []).forEach((t: any) => {
    const attrStep = d.steps[t.attr] || 1;
    const rank = Number(t.rank) || 1;
    lines.push(
      [
        t.name,
        rank,
        ED4Engine.ATTR_NAMES[t.attr] || '敏捷',
        attrStep,
        attrStep + rank,
        Number(t.strain) || 0,
      ].join('\t')
    );
  });
  lines.push('');

  lines.push('武器');
  lines.push('名称\t基础伤害');
  (pl.weapons || []).forEach((w: any) => {
    lines.push([w.name, Number(w.dmgStep) || 0].join('\t'));
  });
  lines.push('');

  const orderedSpells = getOrderedSpellsForExport(pl);
  if (orderedSpells.length > 0) {
    lines.push('法术');
    lines.push('名称\t环数\t脉路\t编织\t施法\t持续\t效果');
    orderedSpells.forEach((sp: any) => {
      lines.push(
        [
          sp.nameCn || sp.nameEn || '未命名法术',
          Number(sp.circle) || 1,
          Number(sp.threads) || 0,
          Number(sp.weavingBase) || 5,
          sp.castingType === 'fixed' ? (Number(sp.castingDn) || 6) : 'TMD',
          sp.duration || '-',
          sp.effectFormula || 'WIL',
        ].join('\t')
      );
    });
    lines.push('');
  }

  lines.push('装备');
  lines.push('名称\t等级\t效果');
  const exportGear = buildExportGearList(pl);
  exportGear.forEach((g: any) => {
    const rankCol = g.rank || (g.effect ? '-' : '');
    const cols = [g.name];
    if (rankCol) cols.push(rankCol);
    if (g.effect) cols.push(g.effect);
    lines.push(cols.join('\t'));
  });
  lines.push('');

  if ((pl.threadItems || []).length > 0) {
    lines.push('脉路物品和编织脉路');
    lines.push('名称\t类型\t效果');
    pl.threadItems.forEach((ti: any) => {
      const typeCol = ti.type || (ti.effect ? '-' : '');
      const cols = [ti.name];
      if (typeCol) cols.push(typeCol);
      if (ti.effect) cols.push(ti.effect);
      lines.push(cols.join('\t'));
    });
    lines.push('');
  }

  lines.push('技能');
  lines.push('名称\t等级\t属性');
  (pl.skills || []).forEach((sk: any) => {
    lines.push([sk.name, Number(sk.rank) || 1, ED4Engine.ATTR_NAMES[sk.attr] || '感知'].join('\t'));
  });
  lines.push('');

  lines.push('传说点数');
  lines.push(`总计：${pl.legend?.total ?? ''}`);
  lines.push(`现有：${pl.legend?.current ?? ''}`);
  lines.push(`传说状态：${pl.legend?.status ?? ''}`);
  lines.push(`名望：${pl.legend?.renown ?? ''}`);
  lines.push(`声誉：${pl.legend?.reputation ?? ''}`);
  lines.push('');

  lines.push('财富');
  lines.push(`铜币：${pl.wealth?.copper ?? 0}`);
  lines.push(`银币：${pl.wealth?.silver ?? 0}`);
  lines.push(`金币：${pl.wealth?.gold ?? 0}`);
  lines.push(`其他：${pl.wealth?.other ?? ''}`);

  return `${lines.join('\n')}\n\n【背景】\n${String(pl.background || '')}`;
}

/**
 * 生成严格对齐 ED4Engine.parseExcelWorkbook 锚点与列结构的纯数值 Excel 工作簿
 */
export function buildCharacterWorkbook(pl: any): XLSX.WorkBook {
  const d = getPlDerivedView(pl);
  const ws: XLSX.WorkSheet = {};
  let maxR = 1;
  let maxC = 1;

  const setCell = (r: number, c: number, val: string | number) => {
    if (val === undefined || val === null || val === '') return;
    const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
    ws[addr] = typeof val === 'number' ? { t: 'n', v: val } : { t: 's', v: String(val) };
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  };

  // 1. 基础信息 (r=2..4, c=1..4)
  setCell(2, 1, '角色名');
  setCell(2, 2, pl.name || '');
  setCell(3, 1, '种族');
  setCell(3, 2, d.race.name);
  setCell(4, 1, '门类');
  setCell(4, 2, d.prog.disc.name);
  setCell(4, 3, '环数');
  setCell(4, 4, Number(pl.circle) || 1);

  // 2. 属性区 (r=8..14, c=1..4)
  setCell(8, 1, '属性');
  setCell(8, 2, '数值');
  setCell(8, 3, '总值');
  setCell(8, 4, '步数');
  Object.entries(ED4Engine.ATTR_NAMES).forEach(([k, cn], idx) => {
    const r = 9 + idx;
    const basePlusMod = (d.race.base[k] || 10) + ((pl.attrMods && pl.attrMods[k]) || 0);
    setCell(r, 1, cn);
    setCell(r, 2, basePlusMod);
    setCell(r, 3, d.attrs[k]);
    setCell(r, 4, d.steps[k]);
  });

  // 3. 先攻与业力 (r=16..19, c=1..5)
  const initPen = (Number(pl.armor?.initPen) || 0) + (Number(pl.shield?.initPen) || 0);
  const initBonus = Number(pl.initBonus) || 0;
  const initAdj = initBonus - initPen;

  setCell(16, 1, '先攻');
  setCell(17, 1, '基础');
  setCell(17, 2, d.steps.DEX);
  setCell(18, 1, '护甲调整');
  setCell(18, 2, initAdj);
  setCell(19, 1, '先攻步数');
  setCell(19, 2, d.initStep);

  setCell(16, 4, '业力');
  setCell(17, 4, '可用');
  setCell(17, 5, pl.karmaCurrent ?? d.karmaMax);
  setCell(18, 4, '上限');
  setCell(18, 5, d.karmaMax);
  setCell(19, 4, '业力骰');
  setCell(19, 5, `D${pl.karmaDie || 6}`);

  // 4. 天赋区 (r=24.., c=1..6)
  setCell(24, 1, '天赋');
  setCell(25, 1, '名称');
  setCell(25, 2, '等级');
  setCell(25, 3, '属性');
  setCell(25, 4, '属性步');
  setCell(25, 5, '总步数');
  setCell(25, 6, '负荷');
  (pl.talents || []).forEach((t: any, idx: number) => {
    const r = 26 + idx;
    const attrStep = d.steps[t.attr] || 1;
    const rank = Number(t.rank) || 1;
    setCell(r, 1, t.name);
    setCell(r, 2, rank);
    setCell(r, 3, ED4Engine.ATTR_NAMES[t.attr] || '敏捷');
    setCell(r, 4, attrStep);
    setCell(r, 5, attrStep + rank);
    setCell(r, 6, Number(t.strain) || 0);
  });

  // 5. 健康区 (r=2..4, c=8..11)
  setCell(2, 8, '当前伤害');
  setCell(2, 9, Number(pl.currentDamage) || 0);
  setCell(3, 8, '血魔法伤害');
  setCell(3, 9, Number(pl.bloodDamage) || 0);
  setCell(4, 8, '负伤');
  setCell(4, 9, Number(pl.wounds) || 0);
  setCell(2, 10, '意识丧失');
  setCell(2, 11, d.effUncon);
  setCell(3, 10, '死亡');
  setCell(3, 11, d.effDeath);
  setCell(4, 10, '负伤阈值');
  setCell(4, 11, d.woundThreshold);

  // 6. 衍生防御面板镜像 (r=6..8, c=8..11)
  setCell(6, 8, '物理防御');
  setCell(6, 9, d.pd);
  setCell(7, 8, '秘法防御');
  setCell(7, 9, d.md);
  setCell(8, 8, '社交防御');
  setCell(8, 9, d.sd);
  setCell(6, 10, '物理护甲');
  setCell(6, 11, d.pa);
  setCell(7, 10, '秘法护甲');
  setCell(7, 11, d.ma);

  // 7. 武器区 (锚点 r=10, c=8..11)
  const weapons = pl.weapons || [];
  setCell(10, 8, '武器');
  setCell(10, 9, '名称');
  setCell(10, 10, '伤害步数');
  setCell(10, 11, '基础伤害');
  weapons.forEach((w: any, idx: number) => {
    const r = 11 + idx;
    const baseDmg = Number(w.dmgStep) || 0;
    setCell(r, 9, w.name);
    setCell(r, 10, d.steps.STR + baseDmg);
    setCell(r, 11, baseDmg);
  });

  // 8. 装备区 (锚点 r>=14, c=8..11)
  const exportGear = buildExportGearList(pl);
  const gearStart = Math.max(14, 11 + weapons.length);
  setCell(gearStart, 8, '装备');
  setCell(gearStart, 9, '名称');
  setCell(gearStart, 10, '等级');
  setCell(gearStart, 11, '效果');
  exportGear.forEach((g: any, idx: number) => {
    const r = gearStart + 1 + idx;
    setCell(r, 9, g.name);
    setCell(r, 10, g.rank || '');
    setCell(r, 11, g.effect || '');
  });

  // 9. 脉路物品区 (锚点 r>=16, c=8..11)
  const threadItems = pl.threadItems || [];
  const tiStart = Math.max(16, gearStart + 1 + exportGear.length);
  setCell(tiStart, 8, '脉路物品');
  setCell(tiStart, 9, '名称');
  setCell(tiStart, 10, '类型');
  setCell(tiStart, 11, '属性');
  threadItems.forEach((ti: any, idx: number) => {
    const r = tiStart + 1 + idx;
    setCell(r, 9, ti.name);
    setCell(r, 10, ti.type || '');
    setCell(r, 11, ti.effect || '');
  });

  // 10. 传说点数与财富 (c=13..14, 动态排在脉路物品区下方避免触发 ed4_engine line 739 提前截断)
  const lpStart = Math.min(36, Math.max(16, tiStart + Math.max(1, threadItems.length) + 2));
  const wStart = lpStart + 7;

  setCell(lpStart, 13, '传说点数');
  setCell(lpStart + 1, 13, '总计');
  setCell(lpStart + 1, 14, pl.legend?.total ?? '');
  setCell(lpStart + 2, 13, '现有');
  setCell(lpStart + 2, 14, pl.legend?.current ?? '');
  setCell(lpStart + 3, 13, '传说状态');
  setCell(lpStart + 3, 14, pl.legend?.status ?? '');
  setCell(lpStart + 4, 13, '名望');
  setCell(lpStart + 4, 14, pl.legend?.renown ?? '');
  setCell(lpStart + 5, 13, '声誉');
  setCell(lpStart + 5, 14, pl.legend?.reputation ?? '');

  setCell(wStart, 13, '财富');
  setCell(wStart + 1, 13, '铜币');
  setCell(wStart + 1, 14, pl.wealth?.copper ?? 0);
  setCell(wStart + 2, 13, '银币');
  setCell(wStart + 2, 14, pl.wealth?.silver ?? 0);
  setCell(wStart + 3, 13, '金币');
  setCell(wStart + 3, 14, pl.wealth?.gold ?? 0);
  setCell(wStart + 4, 13, '其他');
  setCell(wStart + 4, 14, pl.wealth?.other ?? '');

  // 11. 法术区 (锚点 r=2, c=16..23)
  const orderedSpells = getOrderedSpellsForExport(pl);
  setCell(2, 16, '法术');
  setCell(3, 17, '名称');
  setCell(3, 18, '环数');
  setCell(3, 19, '脉路');
  setCell(3, 20, '编织');
  setCell(3, 21, '施法');
  setCell(3, 22, '持续');
  setCell(3, 23, '效果');
  orderedSpells.forEach((sp: any, idx: number) => {
    const r = 4 + idx;
    setCell(r, 17, sp.nameCn || sp.nameEn || '未命名法术');
    setCell(r, 18, Number(sp.circle) || 1);
    setCell(r, 19, Number(sp.threads) || 0);
    setCell(r, 20, Number(sp.weavingBase) || 5);
    setCell(r, 21, sp.castingType === 'fixed' ? (Number(sp.castingDn) || 6) : 'TMD');
    setCell(r, 22, sp.duration || '-');
    setCell(r, 23, sp.effectFormula || 'WIL');
  });

  // 12. 技能区 (锚点 r>=10, c=16..20; col16='技能' 同时作为法术解析终止标记)
  const skills = pl.skills || [];
  const skStart = Math.max(10, 4 + orderedSpells.length + 1);
  setCell(skStart, 16, '技能');
  setCell(skStart, 17, '名称');
  setCell(skStart, 18, '等级');
  setCell(skStart, 19, '属性');
  setCell(skStart, 20, '负荷');
  skills.forEach((sk: any, idx: number) => {
    const r = skStart + 1 + idx;
    setCell(r, 16, sk.category || '通用技能');
    setCell(r, 17, sk.name);
    setCell(r, 18, Number(sk.rank) || 1);
    setCell(r, 19, ED4Engine.ATTR_NAMES[sk.attr] || '感知');
    setCell(r, 20, Number(sk.strain) || 0);
  });

  // 13. 人物背景 (写入 I44 单元格以对齐模板与无损回导)
  setCell(44, 9, pl.background || '');

  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(maxR - 1, 0), c: Math.max(maxC - 1, 0) },
  });
  ws['!cols'] = [
    { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
    { wch: 3 },
    { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 24 },
    { wch: 3 },
    { wch: 12 }, { wch: 14 },
    { wch: 3 },
    { wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 14 }, { wch: 24 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '角色卡');
  return wb;
}

export function getExportBaseName(pl: any): string {
  const safeName = String(pl?.name || '未命名角色').trim().replace(/[\\/:*?"<>|]/g, '_') || '未命名角色';
  const circle = Number(pl?.circle) || 1;
  return `${safeName}_ED4_${circle}环`;
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadWorkbookFile(filename: string, wb: XLSX.WorkBook) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
