import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import ED4Engine from './ed4_engine.js';
import { getPlDerivedView } from './combatHelpers';
import { ED4_TEMPLATE_BASE64 } from '../templates/ed4TemplateBase64';

/**
 * 构建用于导出的完整装备清单：
 * 若面板手动填写了物理/秘法护甲或盾牌防御，则镜像为等价的已穿戴装备条目，保证回导无损。
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
 * 将法术列表按“常备法术矩阵在前、法术书在后”排序导出。
 */
function getOrderedSpellsForExport(pl: any) {
  const spells = pl.spells || [];
  const matrix = spells.filter((s: any) => s.inMatrix !== false);
  const grimoire = spells.filter((s: any) => s.inMatrix === false);
  return [...matrix, ...grimoire];
}

function decodeBase64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * 规范化 WPS / Office 生成的 .xlsx zip 内的注释与关系路径，确保 exceljs 稳定加载。
 */
async function normalizeXlsxForExcelJs(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  const renameMap: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    const cm = name.match(/^xl\/comments\/comment(\d+)\.xml$/i);
    if (cm) renameMap[name] = `xl/comments${cm[1]}.xml`;
    const vm = name.match(/^xl\/drawings\/commentsDrawing(\d+)\.vml$/i);
    if (vm) renameMap[name] = `xl/drawings/vmlDrawing${vm[1]}.vml`;
  }
  for (const [oldName, newName] of Object.entries(renameMap)) {
    zip.file(newName, await zip.files[oldName].async('uint8array'));
    zip.remove(oldName);
  }
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith('.rels') || name === '[Content_Types].xml') {
      let xml = (await zip.files[name].async('string'))
        .replace(/\/xl\/comments\/comment(\d+)\.xml/gi, '../comments$1.xml')
        .replace(/\.\.\/comments\/comment(\d+)\.xml/gi, '../comments$1.xml')
        .replace(/\/xl\/drawings\/commentsDrawing(\d+)\.vml/gi, '../drawings/vmlDrawing$1.vml')
        .replace(/\.\.\/drawings\/commentsDrawing(\d+)\.vml/gi, '../drawings/vmlDrawing$1.vml')
        .replace(/\/xl\/worksheets\//gi, 'worksheets/')
        .replace(/\/xl\/externalLinks\//gi, 'externalLinks/');
      if (name === '[Content_Types].xml') {
        xml = xml
          .replace(/\.\.\/comments(\d+)\.xml/gi, '/xl/comments$1.xml')
          .replace(/\.\.\/drawings\/vmlDrawing(\d+)\.vml/gi, '/xl/drawings/vmlDrawing$1.vml');
      }
      zip.file(name, xml);
    }
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

function colLetterToNumber(colStr: string): number {
  let n = 0;
  for (let i = 0; i < colStr.length; i++) n = n * 26 + (colStr.charCodeAt(i) - 64);
  return n;
}

function parseA1Range(rangeStr: string) {
  const [a, b] = rangeStr.split(':');
  const parsePart = (ref: string) => {
    const m = ref.match(/^([A-Z]+)(\d+)$/i)!;
    return { col: colLetterToNumber(m[1].toUpperCase()), row: Number(m[2]) };
  };
  return { s: parsePart(a), e: parsePart(b || a) };
}

function shiftFormulaRowRefs(
  formula: string,
  colStart: number,
  colEnd: number,
  fromRow: number,
  delta: number
): string {
  return formula.replace(
    /((?:'[^']+'|[A-Za-z0-9_\u4e00-\u9fa5]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)|(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
    (full, crossSheet, dCol, colStr, dRow, rowStr) => {
      if (crossSheet) return full;
      const colNum = colLetterToNumber(colStr.toUpperCase());
      const rowNum = Number(rowStr);
      if (colNum >= colStart && colNum <= colEnd && rowNum >= fromRow) {
        return `${dCol}${colStr}${dRow}${rowNum + delta}`;
      }
      return full;
    }
  );
}

/**
 * 局部下移指定列区间 [colStart..colEnd] 在 fromRow 及以下的所有单元格（值、样式、合并与列内公式行号），
 * 严禁影响左右相邻分栏的排版与行号。
 */
export function shiftColumnBlockDown(
  sheet: ExcelJS.Worksheet,
  colStart: number,
  colEnd: number,
  fromRow: number,
  delta: number
) {
  if (delta <= 0) return;

  const merges: string[] = Array.isArray((sheet.model as any).merges)
    ? [...(sheet.model as any).merges]
    : [];
  const movingMerges: Array<{ range: string; sCol: number; sRow: number; eCol: number; eRow: number }> = [];
  let maxRow = sheet.rowCount || 60;

  for (const mStr of merges) {
    const { s, e } = parseA1Range(mStr);
    if (s.col >= colStart && e.col <= colEnd && s.row >= fromRow) {
      movingMerges.push({ range: mStr, sCol: s.col, sRow: s.row, eCol: e.col, eRow: e.row });
      if (e.row > maxRow) maxRow = e.row;
    }
  }
  for (const m of movingMerges) sheet.unMergeCells(m.range);

  for (let r = maxRow; r >= fromRow; r--) {
    const srcRowObj = sheet.getRow(r);
    const dstRowObj = sheet.getRow(r + delta);
    if (srcRowObj.height && !dstRowObj.height) dstRowObj.height = srcRowObj.height;

    for (let c = colStart; c <= colEnd; c++) {
      const src = sheet.getCell(r, c);
      const dst = sheet.getCell(r + delta, c);

      dst.style = src.style ? JSON.parse(JSON.stringify(src.style)) : {};
      const val = src.value as any;
      if (val && typeof val === 'object' && typeof val.formula === 'string') {
        dst.value = { formula: shiftFormulaRowRefs(val.formula, colStart, colEnd, fromRow, delta) };
      } else {
        dst.value = val ?? null;
      }
      if (src.note) {
        dst.note = src.note;
        src.note = undefined as any;
      }
      src.value = null;
      src.style = {};
    }
  }

  for (const m of movingMerges) {
    sheet.mergeCells(m.sRow + delta, m.sCol, m.eRow + delta, m.eCol);
  }
}

function cloneRowBandStyle(
  sheet: ExcelJS.Worksheet,
  srcRow: number,
  dstRow: number,
  colStart: number,
  colEnd: number
) {
  const h = sheet.getRow(srcRow).height;
  if (h) sheet.getRow(dstRow).height = h;
  for (let c = colStart; c <= colEnd; c++) {
    const sStyle = sheet.getCell(srcRow, c).style;
    sheet.getCell(dstRow, c).style = sStyle ? JSON.parse(JSON.stringify(sStyle)) : {};
  }
}

/**
 * 从导入的原 .xlsx 文件中提取内嵌的角色立绘（优先匹配中栏 I:Q 区域图片）。
 */
export async function extractPortraitFromXlsxBuffer(buffer: ArrayBuffer): Promise<string> {
  try {
    const normBuf = await normalizeXlsxForExcelJs(buffer);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(normBuf);
    const sheet = wb.worksheets[0];
    if (!sheet) return '';
    const imgs = sheet.getImages();
    if (!imgs || imgs.length === 0) return '';
    const midImg =
      imgs.find((img: any) => {
        const col = img?.range?.tl?.nativeCol ?? img?.range?.tl?.col ?? 0;
        return col >= 7 && col <= 16;
      }) || imgs[0];
    const media = wb.getImage(Number(midImg.imageId));
    if (!media || !media.buffer) return '';
    const bytes = new Uint8Array(media.buffer as ArrayBuffer);
    const ext = String(media.extension || 'png').toLowerCase() === 'jpg' ? 'jpeg' : String(media.extension || 'png').toLowerCase();
    return `data:image/${ext};base64,${uint8ToBase64(bytes)}`;
  } catch {
    return '';
  }
}

/**
 * 基于无损 Base64 模板（或本次会话导入缓存的原始 .xlsx）通过 exceljs 注入数据与分栏动态扩展，导出 .xlsx 字节流。
 */
export async function exportCharacterExcelBuffer(
  pl: any,
  cachedTemplateBuffer?: ArrayBuffer | null
): Promise<ArrayBuffer> {
  const rawBuf = cachedTemplateBuffer
    ? cachedTemplateBuffer.slice(0)
    : decodeBase64ToArrayBuffer(ED4_TEMPLATE_BASE64);
  const normBuf = await normalizeXlsxForExcelJs(rawBuf);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(normBuf);

  const sheet = workbook.worksheets[0];
  const d = getPlDerivedView(pl);

  // === 1. 左栏 (A:G, cols 1..7) — 严格保留公式格 D12:F17, B20, B22:B23, E22, C26:D29, F34:G43 ===
  sheet.getCell('B2').value = pl.name || '';
  sheet.getCell('B3').value = d.race.name;
  sheet.getCell('B4').value = d.prog.disc.name;
  sheet.getCell('D4').value = Number(pl.circle) || 1;
  sheet.getCell('B5').value = pl.gender || '';
  sheet.getCell('D5').value = pl.age || '';
  sheet.getCell('B6').value = pl.eyeColor || '';
  sheet.getCell('D6').value = pl.hairColor || '';
  sheet.getCell('B7').value = pl.skinColor || '';
  sheet.getCell('D7').value = pl.height || '';
  sheet.getCell('B8').value = pl.weight || '';

  (['DEX', 'STR', 'TOU', 'PER', 'WIL', 'CHA'] as const).forEach((k, idx) => {
    const r = 12 + idx;
    const basePlusMod = (d.race.base[k] || 10) + ((pl.attrMods && Number(pl.attrMods[k])) || 0);
    const adj = (d.attrs[k] || basePlusMod) - basePlusMod;
    sheet.getCell(r, 2).value = basePlusMod;
    sheet.getCell(r, 3).value = adj;
  });

  const initPen = (Number(pl.armor?.initPen) || 0) + (Number(pl.shield?.initPen) || 0);
  const initAdj = (Number(pl.initBonus) || 0) - initPen + (d.prog.init || 0) + (d.itemBonuses?.init || 0);
  sheet.getCell('B21').value = initAdj;
  sheet.getCell('E20').value = pl.karmaCurrent ?? d.karmaMax;
  sheet.getCell('E21').value = d.race.karmaMod || 4;

  // 天赋区 (预设 34..43 共 10 行；超出部分复制第 43 行样式与公式向下追加)
  for (let r = 34; r <= 43; r++) {
    for (const c of [1, 2, 3, 4, 5]) sheet.getCell(r, c).value = null;
  }
  const talents = pl.talents || [];
  talents.forEach((t: any, idx: number) => {
    const r = 34 + idx;
    if (r > 43) {
      cloneRowBandStyle(sheet, 43, r, 1, 7);
      sheet.getCell(r, 6).value = { formula: `VLOOKUP(C${r},Sheet2!$A$10:$B$16,2,FALSE)+B${r}` };
      sheet.getCell(r, 7).value = { formula: `VLOOKUP(F${r},step表!$A$2:$B$41,2,FALSE)` };
    }
    sheet.getCell(r, 1).value = t.name || '';
    sheet.getCell(r, 2).value = Number(t.rank) || 1;
    sheet.getCell(r, 3).value = t.attr ? `RANK+${t.attr}` : 'RANK';
    sheet.getCell(r, 4).value = t.isAttack ? '攻击' : '';
    sheet.getCell(r, 5).value = Number(t.strain) || 0;
  });

  // === 2. 中栏 (I:Q, cols 9..17) — 严格保留 J6:J10, L10, J12, M15:N16 ===
  sheet.getCell('J4').value = Number(pl.currentDamage) || 0;
  sheet.getCell('J5').value = Number(pl.bloodDamage) || 0;
  sheet.getCell('L6').value = Number(d.durabilityTotal) || 0;
  sheet.getCell('J9').value = Number(pl.wounds) || 0;
  sheet.getCell('J11').value = d.moveDisplay ?? String(d.race.move);

  const weapons = pl.weapons || [];
  const exportGear = buildExportGearList(pl);
  const threadItems = pl.threadItems || [];

  const wExtra = Math.max(0, weapons.length - 2);
  const gExtra = Math.max(0, exportGear.length - 7);
  const tExtra = Math.max(0, threadItems.length - 3);
  const midShift = wExtra + gExtra + tExtra;

  if (wExtra > 0) shiftColumnBlockDown(sheet, 9, 17, 17, wExtra);
  if (gExtra > 0) shiftColumnBlockDown(sheet, 9, 17, 25 + wExtra, gExtra);
  if (tExtra > 0) shiftColumnBlockDown(sheet, 9, 17, 29 + wExtra + gExtra, tExtra);

  // 写入武器（15..16 保留公式 M15:N16，超出复制第 16 行样式并写入公式）
  for (let r = 15; r <= 16; r++) {
    for (const c of [10, 11, 12, 15, 16]) sheet.getCell(r, c).value = null;
  }
  weapons.forEach((w: any, idx: number) => {
    const r = 15 + idx;
    if (idx >= 2) {
      cloneRowBandStyle(sheet, 16, r, 9, 17);
      sheet.getCell(r, 13).value = { formula: `K${r}+E13+L${r}` };
      sheet.getCell(r, 14).value = { formula: `VLOOKUP(M${r},step表!$A$2:$B$41,2,FALSE)` };
    }
    sheet.getCell(r, 10).value = w.name || '';
    sheet.getCell(r, 11).value = Number(w.dmgStep) || 0;
    sheet.getCell(r, 12).value = 0;
  });

  // 写入装备
  const gearDataStart = 18 + wExtra;
  for (let i = 0; i < 7; i++) {
    for (const c of [10, 11, 12]) sheet.getCell(gearDataStart + i, c).value = null;
  }
  exportGear.forEach((g: any, idx: number) => {
    const r = gearDataStart + idx;
    if (idx >= 7) cloneRowBandStyle(sheet, gearDataStart + 6, r, 9, 17);
    sheet.getCell(r, 10).value = g.name || '';
    sheet.getCell(r, 11).value = g.rank || '';
    sheet.getCell(r, 12).value = g.effect || '';
  });

  // 写入脉路物品
  const tiDataStart = 26 + wExtra + gExtra;
  for (let i = 0; i < 3; i++) {
    for (const c of [10, 11, 12]) sheet.getCell(tiDataStart + i, c).value = null;
  }
  threadItems.forEach((ti: any, idx: number) => {
    const r = tiDataStart + idx;
    if (idx >= 3) cloneRowBandStyle(sheet, tiDataStart + 2, r, 9, 17);
    sheet.getCell(r, 10).value = ti.name || '';
    sheet.getCell(r, 11).value = ti.type || '';
    sheet.getCell(r, 12).value = ti.effect || '';
  });

  // 写入角色立绘（若存在 Data URL 图片则嵌入 I{29+midShift}:K{37+midShift}）
  const portraitMatch =
    typeof pl.portraitUrl === 'string'
      ? pl.portraitUrl.match(/^data:image\/(png|jpe?g|gif);base64,(.+)$/i)
      : null;
  if (portraitMatch) {
    const ext = (portraitMatch[1].toLowerCase() === 'jpg' ? 'jpeg' : portraitMatch[1].toLowerCase()) as
      | 'png'
      | 'jpeg'
      | 'gif';
    const imgId = workbook.addImage({ base64: portraitMatch[2], extension: ext });
    sheet.addImage(imgId, {
      tl: { col: 8.05, row: 28 + midShift + 0.05 },
      br: { col: 10.95, row: 37 + midShift - 0.05 },
      editAs: 'oneCell',
    } as any);
  }

  // 写入传说点数、财富与人物背景
  sheet.getCell(31 + midShift, 14).value = pl.legend?.total ?? '';
  sheet.getCell(32 + midShift, 14).value = pl.legend?.current ?? '';
  sheet.getCell(33 + midShift, 14).value = pl.legend?.status ?? '';
  sheet.getCell(34 + midShift, 14).value = pl.legend?.renown ?? '';
  sheet.getCell(35 + midShift, 14).value = pl.legend?.reputation ?? '';

  sheet.getCell(39 + midShift, 14).value = Number(pl.wealth?.copper ?? 0);
  sheet.getCell(40 + midShift, 14).value = Number(pl.wealth?.silver ?? 0);
  sheet.getCell(41 + midShift, 14).value = Number(pl.wealth?.gold ?? 0);
  sheet.getCell(42 + midShift, 14).value = pl.wealth?.other ?? '';

  const bgCell = sheet.getCell(44 + midShift, 9);
  bgCell.value = pl.background || '';
  bgCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };

  // === 3. 右栏 (R:AA, cols 18..27) — 严格保留 V28:W43 及下移后技能公式 ===
  const orderedSpells = getOrderedSpellsForExport(pl);
  const spExtra = Math.max(0, orderedSpells.length - 22);
  if (spExtra > 0) shiftColumnBlockDown(sheet, 18, 27, 26, spExtra);

  for (let r = 4; r <= 25; r++) {
    for (const c of [18, 19, 20, 21, 22, 23, 24, 25]) sheet.getCell(r, c).value = null;
  }
  orderedSpells.forEach((sp: any, idx: number) => {
    const r = 4 + idx;
    if (r >= 25) cloneRowBandStyle(sheet, 24, r, 18, 25);
    sheet.getCell(r, 19).value = sp.nameCn || sp.nameEn || '未命名法术';
    sheet.getCell(r, 20).value = Number(sp.circle) || 1;
    sheet.getCell(r, 21).value = Number(sp.threads) || 0;
    sheet.getCell(r, 22).value = Number(sp.weavingBase) || 5;
    sheet.getCell(r, 23).value = sp.castingType === 'fixed' ? Number(sp.castingDn) || 6 : 'TMD';
    sheet.getCell(r, 24).value = sp.duration || '-';
    sheet.getCell(r, 25).value = sp.effectFormula || 'WIL';
  });

  const skills = pl.skills || [];
  const skStart = 28 + spExtra;
  for (let i = 0; i < 16; i++) {
    for (const c of [18, 19, 20, 21, 24, 25]) sheet.getCell(skStart + i, c).value = null;
  }
  skills.forEach((sk: any, idx: number) => {
    const r = skStart + idx;
    if (idx >= 16) {
      cloneRowBandStyle(sheet, skStart + 15, r, 18, 25);
      sheet.getCell(r, 22).value = { formula: `VLOOKUP(U${r},Sheet2!$A$2:$C$7,3,FALSE)+T${r}` };
      sheet.getCell(r, 23).value = { formula: `VLOOKUP(V${r},step表!$A$2:$B$41,2,FALSE)` };
    }
    sheet.getCell(r, 18).value = sk.category || '通用技能';
    sheet.getCell(r, 19).value = sk.name || '';
    sheet.getCell(r, 20).value = Number(sk.rank) || 1;
    sheet.getCell(r, 21).value = sk.attr || 'PER';
    sheet.getCell(r, 24).value = sk.isAttack ? '攻击' : '';
    sheet.getCell(r, 25).value = Number(sk.strain) || 0;
  });

  const out = await workbook.xlsx.writeBuffer();
  return out instanceof ArrayBuffer ? out : new Uint8Array(out).slice().buffer;
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
  if (pl.gender) lines.push(`性别：${pl.gender}`);
  if (pl.age) lines.push(`年龄：${pl.age}`);
  if (pl.eyeColor) lines.push(`瞳色：${pl.eyeColor}`);
  if (pl.hairColor) lines.push(`发色：${pl.hairColor}`);
  if (pl.skinColor) lines.push(`肤色：${pl.skinColor}`);
  if (pl.height) lines.push(`身高：${pl.height}`);
  if (pl.weight) lines.push(`体重：${pl.weight}`);
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

export function downloadExcelBuffer(filename: string, buffer: ArrayBuffer) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
