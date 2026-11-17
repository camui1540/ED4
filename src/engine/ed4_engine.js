/**
 * ============================================================================
 * Earthdawn 4E (《地球黎明》第四版) 核心业务规则与角色卡解析引擎 (ed4_engine.js)
 * ============================================================================
 * 【给 AI Studio / 后续开发 AI 的说明】
 * 1. 本文件是零 DOM 依赖的纯业务规则与数据解析层（Pure Business Rules & Importer Engine），
 *    可直接导入 Vite + React + TypeScript (`import ED4Engine from './ed4_engine.js'`)，
 *    也可在单文件 HTML 中通过 `window.ED4Engine` 调用。
 * 2. 在 AI Studio 中重构 UI、切换皮肤或升级为多人 VTT 时，请直接调用本引擎的函数，
 *    确保《地球黎明》第四版所有数值与检定规则 100% 准确无损：
 *    - Step 1–40+ 阶数骰池映射 (`getStepDice`) 与无限爆炸骰 (`rollStepTest`)
 *    - 动作检定全一规则 (Rule of One) 与额外成功度 (`Math.floor((total - dn) / 5)`)
 *    - 8 大种族 (`RACES`)、25 点购点表 (`ATTR_COST`)、负重表 (`CARRY_TABLE`)、15 门类 (`DISCIPLINES`) 1–15 环进阶
 *    - 动作检定 (`Action Test`) 与效果检定 (`Effect Test`) 严格隔离（负伤与战斗姿态只扣动作，不扣伤害）
 *    - 装备与脉路物品穿脱动态重算 (`parseItemBonuses`, `calcEquippedBonuses`, `normalizeImportedCharacter`)
 *    - 四大施法门类 1–8 环完整结构化法术库 (`SPELLS_DB`)、中英文/别名匹配 (`findSpellInDb`)
 *    - 攻防受创、护甲减免、负伤阈值与击倒难度纯函数 (`resolveDamage`, `resolveAvoidBlow`, `resolveRiposte`)
 *    - 动态表头锚点 Excel (.xlsx) 与 TXT 角色卡双格式解析器 (`parseExcelWorkbook`, `parseTxtSheet`)
 */

import SPELLS_DB from './ed4_spells_data.js';

const RACES = {
      human: { name: '人类', aliases: ['人类', 'Human'], base: { DEX: 10, STR: 10, TOU: 10, PER: 10, WIL: 10, CHA: 10 }, move: 12, karmaMod: 5, traits: '多才多艺' },
      dwarf: { name: '矮人', aliases: ['矮人', 'Dwarf'], base: { DEX: 9, STR: 10, TOU: 12, PER: 11, WIL: 11, CHA: 10 }, move: 10, karmaMod: 4, traits: '热能视觉、强壮脊背(负重力量+2)' },
      elf: { name: '精灵', aliases: ['精灵', 'Elf'], base: { DEX: 12, STR: 10, TOU: 8, PER: 11, WIL: 11, CHA: 11 }, move: 14, karmaMod: 4, traits: '低光视觉' },
      obsidiman: { name: '黑曜石人', aliases: ['黑曜石人', 'Obsidiman'], base: { DEX: 8, STR: 18, TOU: 13, PER: 9, WIL: 10, CHA: 9 }, move: 10, karmaMod: 3, traits: '天然护甲(+3物理护甲)、负伤阈值+3', naturalArmor: 3, woundBonus: 3 },
      ork: { name: '奥克', aliases: ['奥克', 'Ork'], base: { DEX: 10, STR: 13, TOU: 11, PER: 10, WIL: 8, CHA: 9 }, move: 12, karmaMod: 5, traits: '加哈德、低光视觉' },
      troll: { name: '巨魔', aliases: ['巨魔', 'Troll'], base: { DEX: 10, STR: 14, TOU: 12, PER: 9, WIL: 11, CHA: 10 }, move: 14, karmaMod: 3, traits: '热能视觉' },
      tskrang: { name: '蜥蜴人', aliases: ['蜥蜴人', "T'skrang", 'Tskrang'], base: { DEX: 11, STR: 10, TOU: 11, PER: 10, WIL: 10, CHA: 11 }, move: 12, karmaMod: 4, traits: '尾击战斗', canTailAttack: true },
      windling: { name: '风灵', aliases: ['风灵', 'Windling'], base: { DEX: 11, STR: 4, TOU: 8, PER: 11, WIL: 10, CHA: 12 }, move: '6/16', karmaMod: 6, traits: '星界视觉、飞行、物理防御+2', pdBonus: 2 }
    };

    const DISCIPLINES = {
      swordmaster: {
        name: '剑术大师', en: 'Swordmaster', aliases: ['剑术大师', '剑圣', 'Swordmaster'],
        durability: 7, isCaster: false, weavingName: '武器编织',
        bonuses: { 2: { sd: 1 }, 4: { pd: 1 }, 6: { sd: 2 }, 7: { init: 1 }, 8: { pd: 2 } }
      },
      warrior: {
        name: '战士', en: 'Warrior', aliases: ['战士', 'Warrior'],
        durability: 7, isCaster: false, weavingName: '战争编织',
        bonuses: { 2: { pd: 1 }, 4: { md: 1 }, 6: { pd: 2 }, 7: { rec: 1 }, 8: { pd: 3 } }
      },
      sky_raider: {
        name: '空贼', en: 'Sky Raider', aliases: ['空贼', '天空掠夺者', 'Sky Raider'],
        durability: 7, isCaster: false, weavingName: '天空编织',
        bonuses: { 2: { pd: 1 }, 4: { sd: 1 }, 6: { pd: 2 }, 7: { rec: 1 }, 8: { pd: 3 } }
      },
      cavalryman: {
        name: '骑兵', en: 'Cavalryman', aliases: ['骑兵', 'Cavalryman'],
        durability: 7, isCaster: false, weavingName: '骑乘编织',
        bonuses: { 2: { pd: 1 }, 4: { sd: 1 }, 6: { pd: 2 }, 7: { rec: 1 }, 8: { pd: 3 } }
      },
      beastmaster: {
        name: '驯兽师', en: 'Beastmaster', aliases: ['驯兽师', 'Beastmaster'],
        durability: 7, isCaster: false, weavingName: '野兽编织',
        bonuses: { 2: { pd: 1 }, 4: { sd: 1 }, 6: { pd: 2 }, 7: { rec: 1 }, 8: { pd: 3 } }
      },
      air_sailor: {
        name: '空帆手', en: 'Air Sailor', aliases: ['空帆手', '飞空水手', 'Air Sailor'],
        durability: 5, isCaster: false, weavingName: '航行编织',
        bonuses: { 2: { pd: 1 }, 4: { sd: 1 }, 6: { pd: 2 }, 7: { rec: 1 }, 8: { pd: 3 } }
      },
      archer: {
        name: '弓箭手', en: 'Archer', aliases: ['弓箭手', 'Archer'],
        durability: 5, isCaster: false, weavingName: '箭矢编织',
        bonuses: { 2: { pd: 1 }, 4: { md: 1 }, 6: { pd: 2 }, 7: { init: 1 }, 8: { pd: 3 } }
      },
      scout: {
        name: '斥候', en: 'Scout', aliases: ['斥候', 'Scout'],
        durability: 5, isCaster: false, weavingName: '斥候编织',
        bonuses: { 2: { pd: 1 }, 4: { md: 1 }, 6: { pd: 2 }, 7: { init: 1 }, 8: { pd: 3 } }
      },
      thief: {
        name: '盗贼', en: 'Thief', aliases: ['盗贼', 'Thief'],
        durability: 5, isCaster: false, weavingName: '窃贼编织',
        bonuses: { 2: { pd: 1 }, 4: { sd: 1 }, 6: { pd: 2 }, 7: { init: 1 }, 8: { pd: 3 } }
      },
      troubadour: {
        name: '吟游诗人', en: 'Troubadour', aliases: ['吟游诗人', 'Troubadour'],
        durability: 5, isCaster: false, weavingName: '故事编织',
        bonuses: { 2: { sd: 1 }, 4: { md: 1 }, 6: { sd: 2 }, 7: { init: 1 }, 8: { sd: 3 } }
      },
      weaponsmith: {
        name: '武器匠', en: 'Weaponsmith', aliases: ['武器匠', 'Weaponsmith'],
        durability: 5, isCaster: false, weavingName: '匠脉编织',
        bonuses: { 2: { md: 1 }, 4: { pd: 1 }, 6: { md: 2 }, 7: { ma: 1 }, 8: { md: 3 } }
      },
      elementalist: {
        name: '元素师', en: 'Elementalist', aliases: ['元素师', '元素使', 'Elementalist'],
        durability: 3, isCaster: true, weavingName: '元素编织',
        bonuses: { 2: { md: 1 }, 4: { pd: 1 }, 6: { md: 2 }, 7: { rec: 1 }, 8: { md: 3 } }
      },
      illusionist: {
        name: '幻术师', en: 'Illusionist', aliases: ['幻术师', 'Illusionist'],
        durability: 3, isCaster: true, weavingName: '幻术编织',
        bonuses: { 2: { md: 1 }, 4: { sd: 1 }, 6: { md: 2 }, 7: { init: 1 }, 8: { md: 3 } }
      },
      nethermancer: {
        name: '下界术士', en: 'Nethermancer', aliases: ['下界术士', '死灵法师', 'Nethermancer'],
        durability: 3, isCaster: true, weavingName: '下界编织',
        bonuses: { 2: { md: 1 }, 4: { sd: 1 }, 6: { md: 2 }, 7: { ma: 1 }, 8: { md: 3 } }
      },
      wizard: {
        name: '巫师', en: 'Wizard', aliases: ['巫师', 'Wizard'],
        durability: 3, isCaster: true, weavingName: '巫术编织',
        bonuses: { 2: { md: 1 }, 4: { sd: 1 }, 6: { md: 2 }, 7: { ma: 1 }, 8: { md: 3 } }
      }
    };

    // SPELLS_DB imported from ./ed4_spells_data.js

    const ATTR_NAMES = { DEX: '敏捷', STR: '力量', TOU: '强韧', PER: '感知', WIL: '意志', CHA: '魅力' };
    const ATTR_COST = { '-2': -2, '-1': -1, 0: 0, 1: 1, 2: 2, 3: 3, 4: 5, 5: 7, 6: 9, 7: 12, 8: 15 };
    const CARRY_TABLE = [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 95, 110, 125, 140, 155, 175, 195, 215, 235, 255, 280, 305, 330, 355, 380, 410, 440, 470, 500, 530];

    const STEP_BASE = {
      1: { dice: [4], mod: -2, label: 'D4-2' },
      2: { dice: [4], mod: -1, label: 'D4-1' },
      3: { dice: [4], mod: 0, label: 'D4' },
      4: { dice: [6], mod: 0, label: 'D6' },
      5: { dice: [8], mod: 0, label: 'D8' },
      6: { dice: [10], mod: 0, label: 'D10' },
      7: { dice: [12], mod: 0, label: 'D12' }
    };

    const STEP_CYCLE = [
      { dice: [6, 6], label: '2D6' },
      { dice: [8, 6], label: 'D8+D6' },
      { dice: [8, 8], label: '2D8' },
      { dice: [10, 8], label: 'D10+D8' },
      { dice: [10, 10], label: '2D10' },
      { dice: [12, 10], label: 'D12+D10' },
      { dice: [12, 12], label: '2D12' },
      { dice: [12, 6, 6], label: 'D12+2D6' },
      { dice: [12, 8, 6], label: 'D12+D8+D6' },
      { dice: [12, 8, 8], label: 'D12+2D8' },
      { dice: [12, 10, 8], label: 'D12+D10+D8' }
    ];

    function getStepDice(step) {
      const s = Math.max(1, Math.floor(step));
      if (s <= 7) return STEP_BASE[s];
      const offset = s - 8;
      const d20Count = Math.floor(offset / 11);
      const rem = STEP_CYCLE[offset % 11];
      const dice = [];
      for (let i = 0; i < d20Count; i++) dice.push(20);
      dice.push(...rem.dice);
      const prefix = d20Count > 0 ? (d20Count === 1 ? 'D20+' : `${d20Count}D20+`) : '';
      return { dice, mod: 0, label: prefix + rem.label };
    }

    function attrToStep(val) {
      return Math.floor((Math.max(1, val) + 2) / 3) + 1;
    }

    function rollExplodingDie(sides) {
      let sum = 0;
      const rolls = [];
      while (true) {
        const r = Math.floor(Math.random() * sides) + 1;
        rolls.push(r);
        sum += r;
        if (r < sides) break;
      }
      const text = rolls.length > 1 ? `D${sides}[${rolls.join('!→')}]` : `D${sides}[${rolls[0]}]`;
      return { sum, first: rolls[0], text };
    }

    function rollStepTest(step, opts = {}) {
      const { karma = false, karmaDie = 6, dn = null, isAction = true } = opts;
      const cfg = getStepDice(step);
      const allDice = [...cfg.dice];
      if (karma) allDice.push(Number(karmaDie) || 6);
      let rawSum = 0;
      const traces = [];
      let allOnes = allDice.length >= 2;

      allDice.forEach((sides, idx) => {
        const res = rollExplodingDie(sides);
        rawSum += res.sum;
        if (res.first !== 1) allOnes = false;
        const tag = karma && idx === allDice.length - 1 ? `业力${res.text}` : res.text;
        traces.push(tag);
      });

      const total = Math.max(1, rawSum + cfg.mod);
      const isRuleOfOne = isAction && allOnes;
      let isSuccess = null;
      let extraSuccesses = 0;

      if (dn !== null && dn !== '' && !isNaN(Number(dn))) {
        const targetDn = Number(dn);
        if (isRuleOfOne) {
          isSuccess = false;
        } else if (total >= targetDn) {
          isSuccess = true;
          extraSuccesses = Math.floor((total - targetDn) / 5);
        } else {
          isSuccess = false;
        }
      }

      const modStr = cfg.mod !== 0 ? (cfg.mod > 0 ? `+${cfg.mod}` : `${cfg.mod}`) : '';
      return {
        step: Math.max(1, Math.floor(step)),
        diceLabel: cfg.label + (karma ? `+业力D${karmaDie}` : ''),
        total,
        isRuleOfOne,
        isSuccess,
        extraSuccesses,
        trace: `${traces.join(' + ')}${modStr} = ${total}`
      };
    }

    

    const LEGACY_SPELL_ID_MAP = {
      ele_air_armor: 'air-armor',
      ele_earth_darts: 'earth-darts',
      ele_flameweapon: 'flameweapon',
      ele_heat_food: 'heat-food',
      ele_resist_element: 'resist-element',
      ele_shelter: 'shelter',
      ele_air_mattress: 'air-mattress',
      ele_icy_surface: 'icy-surface',
      ele_shield_willow: 'shield-willow',
      ill_assuring_touch: 'assuring-touch',
      ill_cloak: 'cloak',
      ill_ephemeral_bolt: 'ephemeral-bolt',
      ill_monstrous_mantle: 'monstrous-mantle',
      ill_unseen_voices: 'unseen-voices',
      ill_blindness: 'blindness',
      ill_displace_image: 'displace-image',
      ill_phantom_flame: 'phantom-flame',
      ill_see_unseen: 'see-the-unseen',
      net_astral_spear: 'astral-spear',
      net_ethereal_darkness: 'ethereal-darkness',
      net_soul_armor: 'soul-armor',
      net_soulless_eyes: 'soulless-eyes',
      net_spirit_dart: 'spirit-dart',
      net_aspect_fog_ghost: 'aspect-of-the-fog-ghost',
      net_chilling_circle: 'chilling-circle',
      net_nights_edge: 'night-s-edge',
      wiz_logic_display: 'bedazzling-display-of-logical-analysis',
      wiz_catseyes: 'catseyes',
      wiz_flame_flash: 'flame-flash',
      wiz_mage_armor: 'mage-armor',
      wiz_mind_dagger: 'mind-dagger',
      wiz_quicken_pace: 'quicken-pace',
      wiz_astral_shield: 'astral-shield',
      wiz_crushing_will: 'crushing-will',
      wiz_seeking_sight: 'seeking-sight',
      ele_ice_mace: 'ice-mace-and-chain',
      ele_lightning_bolt: 'lightning-bolt',
      ele_winds_deflection: 'winds-of-deflection',
      ele_blizzard_sphere: 'blizzard-sphere',
      ele_elemental_spear: 'elemental-spear',
      ele_lightning_step: 'lightning-step',
      ele_fireball: 'fireball',
      ele_heat_armor: 'heat-armor',
      ele_fireweave: 'fireweave',
      ele_thunderclap: 'thunderclap',
      ele_whirlwind: 'whirlwind',
      ele_crushing_hand: 'crushing-hand-of-earth',
      ill_nobody_here: 'nobody-here',
      ill_phantom_warrior: 'phantom-warrior',
      ill_notice_not: 'notice-not',
      ill_phantom_lightning: 'phantom-lightning',
      ill_eye_of_truth: 'eye-of-truth',
      ill_phantom_fireball: 'phantom-fireball',
      ill_astral_shadow: 'astral-shadow',
      ill_stampede: 'stampede',
      ill_shadow_spell: 'shadow-spell',
      net_arrow_of_night: 'arrow-of-night',
      net_pain: 'pain',
      net_fog_of_fear: 'fog-of-fear',
      net_evil_eye: 'evil-eye',
      net_aspect_tyrant: 'aspect-of-the-menacing-tyrant',
      net_aspect_physician: 'aspect-of-the-cruel-physician',
      net_wither_limb: 'wither-limb',
      net_astral_maw: 'astral-maw',
      net_debilitating_gloom: 'debilitating-gloom',
      net_restrain_entity: 'restrain-entity',
      net_netherblade: 'netherblade',
      net_shadow_tether: 'shadow-tether',
      wiz_astral_targeting: 'astral-targeting',
      wiz_aura_strike: 'aura-strike',
      wiz_binding_threads: 'binding-threads',
      wiz_wizards_cloak: 'wizard-s-cloak',
      wiz_mystic_shock: 'mystic-shock',
      wiz_sever_talent: 'sever-talent',
      wiz_slow: 'slow',
      wiz_energy_shield: 'energy-shield',
      wiz_confusing_weave: 'confusing-weave',
      wiz_astral_catastrophe: 'astral-catastrophe',
      wiz_compression_bubble: 'compression-bubble',
    };

    const SPELL_ALIASES = {
      '星界长矛': 'astral-spear',
      '星界之矛': 'astral-spear',
      '星质矛': 'astral-spear',
      '灵魂甲': 'soul-armor',
      '精神镖': 'spirit-dart',
      '精神飞刺': 'spirit-dart',
      '恐惧迷雾': 'fog-of-fear',
      '夜箭': 'arrow-of-night',
      '夜之箭': 'arrow-of-night',
      '夜之矢': 'arrow-of-night',
      '迷雾幽魂': 'aspect-of-the-fog-ghost',
      '残酷医者': 'aspect-of-the-cruel-physician',
      '险恶暴君': 'aspect-of-the-menacing-tyrant',
      '枯萎术': 'wither-limb',
      '凋零': 'wither-limb',
      '寒霜法阵': 'chilling-circle',
      '火球': 'fireball',
      '闪电': 'lightning-bolt',
      '法师甲': 'mage-armor',
      '心灵匕': 'mind-dagger'
    };

    const WEAVING_KEYWORDS = [
      '脉路编织', '元素编织', '幻术编织', '下界编织', '巫术编织',
      '武器编织', '战争编织', '天空编织', '骑乘编织', '野兽编织',
      '航行编织', '箭矢编织', '斥候编织', '窃贼编织', '故事编织', '匠脉编织',
      '元素主义', '幻术', '下界术', '巫术',
      'thread weaving', 'elementalism', 'illusionism', 'nethermancy', 'wizardry',
      'air weaving', 'arrow weaving', 'beast weaving', 'rider weaving',
      'scout weaving', 'sky weaving', 'weapon weaving', 'thief weaving',
      'story weaving', 'war weaving', 'thread smithing'
    ];

    // ========================================================================
    // 1. 门类环数进阶、装备穿脱解析与角色衍生属性计算 (Pure Functions)
    // ========================================================================
    function getDisciplineBonuses(disciplineId, circle) {
      const disc = DISCIPLINES[disciplineId] || DISCIPLINES.warrior;
      const c = Math.max(1, Math.min(15, Number(circle) || 1));
      let pd = 0, md = 0, sd = 0, init = 0, rec = 0, ma = 0;
      if (c >= 2) pd += 1;
      if (c >= 4) {
        if (disc.c4 === 'pd') pd += 1;
        else if (disc.c4 === 'md') md += 1;
        else if (disc.c4 === 'sd') sd += 1;
      }
      if (c >= 6) pd += 1;
      if (c >= 7) {
        if (disc.c7 === 'init') init += 1;
        else if (disc.c7 === 'rec') rec += 1;
        else if (disc.c7 === 'ma') ma += 1;
      }
      if (c >= 8) pd += 1;
      return { disc, pd, md, sd, init, rec, ma };
    }

    function parseItemBonuses(text) {
      const b = { pa: 0, ma: 0, pd: 0, md: 0, sd: 0, init: 0, DEX: 0, STR: 0, TOU: 0, PER: 0, WIL: 0, CHA: 0 };
      const s = String(text || '');
      if (!s) return b;
      const sumMatches = (re) => {
        let total = 0, m;
        while ((m = re.exec(s)) !== null) total += Number(m[1]) || 0;
        return total;
      };
      b.pa = sumMatches(/物理护甲\s*([+-]?\d+)/g);
      b.ma = sumMatches(/秘法护甲\s*([+-]?\d+)/g);
      b.pd = sumMatches(/物理防御\s*([+-]?\d+)/g);
      b.md = sumMatches(/秘法防御\s*([+-]?\d+)/g);
      b.sd = sumMatches(/社交防御\s*([+-]?\d+)/g);
      b.init = sumMatches(/先攻\s*([+-]?\d+)/g);
      b.DEX = sumMatches(/(?:敏捷|DEX)\s*([+-]?\d+)/gi);
      b.STR = sumMatches(/(?:力量|STR)\s*([+-]?\d+)/gi);
      b.TOU = sumMatches(/(?:强韧|TOU)\s*([+-]?\d+)/gi);
      b.PER = sumMatches(/(?:感知|PER)\s*([+-]?\d+)/gi);
      b.WIL = sumMatches(/(?:意志|WIL)\s*([+-]?\d+)/gi);
      b.CHA = sumMatches(/(?:魅力|CHA)\s*([+-]?\d+)/gi);
      return b;
    }

    function calcEquippedBonuses(gear = [], threadItems = []) {
      const total = { pa: 0, ma: 0, pd: 0, md: 0, sd: 0, init: 0, DEX: 0, STR: 0, TOU: 0, PER: 0, WIL: 0, CHA: 0 };
      [...(gear || []), ...(threadItems || [])].forEach(item => {
        if (!item || item.equipped === false) return;
        const b = parseItemBonuses(`${item.name || ''} ${item.effect || ''}`);
        for (const k of Object.keys(total)) total[k] += b[k];
      });
      return total;
    }

    function calcPlDerived(pl) {
      const race = RACES[pl.raceId] || RACES.human;
      const prog = getDisciplineBonuses(pl.disciplineId, pl.circle);
      const attrs = {};
      const steps = {};
      let spentPoints = 0;
      const itemBonuses = calcEquippedBonuses(pl.gear, pl.threadItems);

      for (const k of Object.keys(ATTR_NAMES)) {
        const mod = (pl.attrMods && pl.attrMods[k]) || 0;
        spentPoints += ATTR_COST[mod] !== undefined ? ATTR_COST[mod] : mod;
        attrs[k] = race.base[k] + mod + (itemBonuses[k] || 0);
        steps[k] = attrToStep(attrs[k]);
      }

      let pd = Math.floor((attrs.DEX + 3) / 2) + (race.pdBonus || 0) + prog.pd + (itemBonuses.pd || 0);
      let md = Math.floor((attrs.PER + 3) / 2) + prog.md + (itemBonuses.md || 0);
      let sd = Math.floor((attrs.CHA + 3) / 2) + prog.sd + (itemBonuses.sd || 0);

      if (!pl.statuses?.blindsided) {
        pd += Number(pl.shield?.pd) || 0;
        md += Number(pl.shield?.md) || 0;
      }
      if (pl.options?.defensive) { pd += 3; md += 3; }
      if (pl.options?.aggressive) { pd -= 3; md -= 3; }
      if (pl.statuses?.knockedDown) { pd -= 3; md -= 3; sd -= 3; }
      if (pl.statuses?.blindsided) { pd -= 3; }
      if (pl.statuses?.harried) { pd -= 2; md -= 2; sd -= 2; }

      pd = Math.max(1, pd);
      md = Math.max(1, md);
      sd = Math.max(1, sd);

      const pa = (Number(pl.armor?.pa) || 0) + (race.naturalArmor || 0) + (itemBonuses.pa || 0);
      const ma = Math.floor(attrs.WIL / 5) + (Number(pl.armor?.ma) || 0) + prog.ma + (itemBonuses.ma || 0);

      const uncon = attrs.TOU * 2 + prog.disc.durability * pl.circle + (Number(pl.durabilityBonus) || 0);
      const death = uncon + attrs.TOU + pl.circle + (pl.raceId === 'obsidiman' ? 10 : 0);
      const woundThreshold = Math.floor((attrs.TOU + 4) / 2) + (race.woundBonus || 0);
      const recoveryMax = Math.max(1, Math.round(attrs.TOU / 6)) + prog.rec;
      const karmaMax = pl.circle * race.karmaMod;

      const initPen = (Number(pl.armor?.initPen) || 0) + (Number(pl.shield?.initPen) || 0);
      const initStep = Math.max(1, steps.DEX - initPen + (Number(pl.initBonus) || 0) + prog.init + (itemBonuses.init || 0));

      return {
        race, prog, attrs, steps, spentPoints, itemBonuses,
        pd, md, sd, pa, ma,
        uncon, death, woundThreshold, recoveryMax, karmaMax, initStep
      };
    }

    function getPlActionMod(pl) {
      let mod = -Math.max(0, Number(pl.wounds) || 0);
      if (pl.options?.defensive) mod -= 3;
      if (pl.options?.knockdownAttack) mod -= 2;
      if (pl.options?.splitMove) mod -= 2;
      if (pl.statuses?.knockedDown) mod -= 3;
      if (pl.statuses?.harried) mod -= 2;
      return mod;
    }

    // ========================================================================
    // 2. 法术匹配、脉路编织与效果计算
    // ========================================================================
    function findSpellInDb(name) {
      const raw = (name || '').trim();
      if (!raw) return null;
      const mappedLegacyId = LEGACY_SPELL_ID_MAP[raw];
      if (mappedLegacyId) {
        const legacyHit = SPELLS_DB.find(s => s.id === mappedLegacyId);
        if (legacyHit) return legacyHit;
      }
      const byId = SPELLS_DB.find(s => s.id === raw);
      if (byId) return byId;

      const norm = (str) => String(str || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[（）()【】\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      const clean = norm(raw);

      const exact = SPELLS_DB.find(s => {
        const cn = norm(s.nameCn || s.name);
        const en = norm(s.nameEn);
        const aliasList = Array.isArray(s.aliases) ? s.aliases.map(norm) : [];
        return cn === clean || en === clean || aliasList.includes(clean);
      });
      if (exact) return exact;

      const fuzzy = SPELLS_DB.find(s => {
        const cn = norm(s.nameCn || s.name);
        const en = norm(s.nameEn);
        const aliasList = Array.isArray(s.aliases) ? s.aliases.map(norm) : [];
        return (
          (clean.length >= 2 && (cn.includes(clean) || clean.includes(cn))) ||
          (en && clean.length >= 3 && (en.includes(clean) || clean.includes(en))) ||
          aliasList.some(a => a.length >= 2 && (a === clean || (clean.length >= 3 && (a.includes(clean) || clean.includes(a)))))
        );
      });
      if (fuzzy) return fuzzy;

      for (const [alias, id] of Object.entries(SPELL_ALIASES)) {
        if (clean.includes(alias)) return SPELLS_DB.find(s => s.id === id) || null;
      }
      return null;
    }

    function hasSpellEffectRoll(sp) {
      if (!sp) return false;
      if (sp.effectStepBonus !== null && sp.effectStepBonus !== undefined) return true;
      if (sp.usesCircleAsBase) return true;
      if (sp.effectType === 'damage') return true;
      const f = String(sp.effectFormula || '');
      if (sp.effectType === 'buff') return false;
      return /\bWIL\b|意志|\bCIRCLE\b|环数/i.test(f);
    }

    function getThreadWeavingStep(pl, derived = null, spell = null) {
      const d = derived || calcPlDerived(pl);
      const talents = pl.talents || [];
      const disc = spell?.discipline ? DISCIPLINES[spell.discipline] : null;
      const discWeaving = disc?.weavingName ? disc.weavingName.toLowerCase() : '';
      let t = null;
      if (discWeaving) {
        t = talents.find(x => (x.name || '').toLowerCase().includes(discWeaving));
      }
      if (!t) {
        t = talents.find(x => {
          const nm = (x.name || '').toLowerCase();
          return nm.includes('编织') || WEAVING_KEYWORDS.some(k => nm.includes(k));
        });
      }
      const rank = t ? t.rank : 0;
      return {
        step: Math.max(1, d.steps.PER + rank + getPlActionMod(pl)),
        rank,
        talentName: t ? t.name : (disc?.weavingName || '脉路编织'),
        isVersatilityTalent: Boolean(t && (t.isVersatility || (t.name || '').includes('多才多艺') || (t.name || '').toLowerCase().includes('versatility')))
      };
    }

    function getSpellcastingStep(pl, derived = null) {
      const d = derived || calcPlDerived(pl);
      const t = (pl.talents || []).find(x => x.name.includes('施法') || x.name.toLowerCase().includes('spellcasting'));
      const rank = t ? t.rank : 0;
      return { step: Math.max(1, d.steps.PER + rank + getPlActionMod(pl)), rank };
    }

    // ========================================================================
    // 3. 攻防反应、护甲减免、负伤阈值与击倒判定纯函数
    // ========================================================================
    function resolveDamage({ rawDamage, armor = 0, currentDamage = 0, uncon = 35, death = 44, woundThreshold = 9, isStun = false }) {
      const net = Math.max(0, (Number(rawDamage) || 0) - (Number(armor) || 0));
      const nextDamage = currentDamage + net;
      const causedWound = net >= woundThreshold;
      const knockdownDn = causedWound ? (net - woundThreshold + 5) : 0;
      const isUnconscious = nextDamage >= uncon;
      const isDead = !isStun && nextDamage >= death;
      return { net, nextDamage, causedWound, knockdownDn, isUnconscious, isDead };
    }

    function resolveAvoidBlow({ avoidStep, attackRollTotal, karma = false, karmaDie = 6 }) {
      const res = rollStepTest(avoidStep, { karma, karmaDie, dn: attackRollTotal, isAction: true });
      return { avoided: res.isSuccess, strainCost: 1, rollResult: res };
    }

    function resolveRiposte({ riposteStep, attackRollTotal, karma = false, karmaDie = 6 }) {
      const res = rollStepTest(riposteStep, { karma, karmaDie, dn: attackRollTotal, isAction: true });
      return { riposted: res.isSuccess, strainCost: 2, rollResult: res };
    }

    // ========================================================================
    // 4. 动态表头锚点 Excel (.xlsx) 与 TXT 角色卡双格式解析器 + 防重复叠加归一化
    // ========================================================================
function matchRaceId(raw) {
      const s = (raw || '').trim().toLowerCase();
      for (const [id, r] of Object.entries(RACES)) {
        if (r.aliases.some(a => s.includes(a.toLowerCase()))) return id;
      }
      return null;
    }

    function matchDisciplineId(raw) {
      const s = (raw || '').trim().toLowerCase();
      for (const [id, d] of Object.entries(DISCIPLINES)) {
        if (d.aliases.some(a => s.includes(a.toLowerCase()))) return id;
      }
      return null;
    }

    function parseAttrKey(raw) {
      const s = (raw || '').trim().toUpperCase();
      if (s.includes('敏捷') || s.includes('DEX')) return 'DEX';
      if (s.includes('力量') || s.includes('STR')) return 'STR';
      if (s.includes('强韧') || s.includes('TOU')) return 'TOU';
      if (s.includes('感知') || s.includes('PER')) return 'PER';
      if (s.includes('意志') || s.includes('WIL')) return 'WIL';
      if (s.includes('魅力') || s.includes('CHA')) return 'CHA';
      return 'DEX';
    }

    
    function parseExcelWorkbook(wb) {
      const ws = wb.Sheets[wb.SheetNames[0]];
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z80');
      const maxR = Math.min(80, range.e.r + 1);
      const maxC = Math.min(28, range.e.c + 1);

      const cellStr = (r, c) => {
        const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
        const cell = ws[addr];
        if (!cell || cell.v === undefined || cell.v === null) return '';
        const s = String(cell.v).trim();
        return s === '#N/A' || s === 'NaN' ? '' : s;
      };
      const extractCellText = (cell) => {
        if (!cell) return '';
        let raw = '';
        if (cell.v !== undefined && cell.v !== null && String(cell.v) !== '') {
          raw = String(cell.v);
        } else if (cell.w) {
          raw = String(cell.w);
        } else if (cell.h) {
          raw = String(cell.h)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&#x0*d;/gi, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
        } else if (typeof cell.r === 'string') {
          raw = cell.r.replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<[^>]+>/g, '');
        }
        const clean = raw.replace(/_x000D_\r?\n?/g, '\n').replace(/\r\n?/g, '\n').trim();
        return clean === '#N/A' || clean === 'NaN' ? '' : clean;
      };
      const merges = Array.isArray(ws['!merges']) ? ws['!merges'] : [];
      const findMerge = (r, c, list = merges) =>
        list.find(m => m.s.r <= r - 1 && r - 1 <= m.e.r && m.s.c <= c - 1 && c - 1 <= m.e.c) || null;
      const readSheetMergedText = (sheet, r, c) => {
        const sMerges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : [];
        const m = findMerge(r, c, sMerges);
        if (m) {
          const topAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
          const topText = extractCellText(sheet[topAddr]);
          if (topText) return topText;
        }
        const directAddr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
        return extractCellText(sheet[directAddr]);
      };
      const readMergedText = (r, c) => readSheetMergedText(ws, r, c);
      const cellNum = (r, c) => {
        const s = cellStr(r, c);
        if (!s) return undefined;
        const n = Number(s);
        return isNaN(n) ? undefined : n;
      };
      const findCell = (exactText, rMin = 1, rMax = maxR, cMin = 1, cMax = maxC) => {
        for (let r = rMin; r <= rMax; r++) {
          for (let c = cMin; c <= cMax; c++) {
            if (cellStr(r, c) === exactText) return { r, c };
          }
        }
        return null;
      };

      const findRightVal = (label, rMax = 10, cMax = 6) => {
        const anc = findCell(label, 1, rMax, 1, cMax);
        return anc ? cellStr(anc.r, anc.c + 1) : '';
      };
      const findRightNum = (label, rMax = 10, cMax = 6) => {
        const anc = findCell(label, 1, rMax, 1, cMax);
        return anc ? cellNum(anc.r, anc.c + 1) : undefined;
      };

      const data = {
        name: findRightVal('角色名') || cellStr(2, 2),
        raceId: matchRaceId(findRightVal('种族') || cellStr(3, 2)),
        disciplineId: matchDisciplineId(findRightVal('门类') || cellStr(4, 2)),
        circle: findRightNum('环数') || cellNum(4, 4),
        background: '',
        attrs: {},
        talents: [],
        weapons: [],
        spells: [],
        skills: [],
        gear: [],
        threadItems: []
      };

      // 1. 动态解析属性区
      const attrAnchor = findCell('属性', 8, 20, 1, 3);
      if (attrAnchor) {
        const hr = attrAnchor.r;
        let valCol = 2, totalCol = -1;
        for (let c = attrAnchor.c + 1; c <= attrAnchor.c + 6; c++) {
          const h = cellStr(hr, c);
          if (h === '总值') totalCol = c;
          else if (h === '数值') valCol = c;
        }
        const targetCol = totalCol > 0 ? totalCol : valCol;
        for (let r = hr + 1; r <= hr + 6; r++) {
          const label = cellStr(r, attrAnchor.c);
          const v = cellNum(r, targetCol);
          if (label && v !== undefined) {
            data.attrs[parseAttrKey(label)] = v;
          }
        }
      }

      // 2. 先攻调整 / 业力 / 健康
      const initAnchor = findCell('先攻', 15, 28, 1, 3);
      if (initAnchor) {
        for (let r = initAnchor.r + 1; r <= initAnchor.r + 4; r++) {
          const lbl = cellStr(r, initAnchor.c);
          if (lbl.includes('调整')) {
            const v = cellNum(r, initAnchor.c + 1);
            if (v !== undefined) data.initAdj = v;
          }
        }
      }
      const karmaAnchor = findCell('业力', 15, 28, 3, 6);
      if (karmaAnchor) {
        for (let r = karmaAnchor.r + 1; r <= karmaAnchor.r + 3; r++) {
          if (cellStr(r, karmaAnchor.c) === '可用') {
            data.karmaAvail = cellNum(r, karmaAnchor.c + 1);
          }
        }
      }
      const dmgCur = findCell('当前伤害', 1, 15, 8, 12);
      if (dmgCur) data.currentDamage = cellNum(dmgCur.r, dmgCur.c + 1);
      const dmgBlood = findCell('血魔法伤害', 1, 15, 8, 12);
      if (dmgBlood) data.bloodDamage = cellNum(dmgBlood.r, dmgBlood.c + 1);
      const dmgWound = findCell('负伤', 1, 15, 8, 12);
      if (dmgWound) data.wounds = cellNum(dmgWound.r, dmgWound.c + 1);

      // 3. 动态解析天赋区（解决插行错位 & 表头误导问题）
      const talAnchor = findCell('天赋', 24, 45, 1, 3);
      if (talAnchor) {
        let hr = talAnchor.r;
        // 寻找紧随其后的表头行（含“名称”）
        for (let r = talAnchor.r; r <= talAnchor.r + 2; r++) {
          if (cellStr(r, 1) === '名称' || cellStr(r, 2) === '名称') { hr = r; break; }
        }
        let nameCol = 1, rankCol = 2, attrCol = 3, strainCol = -1;
        for (let c = 1; c <= 10; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '等级') rankCol = c;
          else if (h === '属性') attrCol = c;
          else if (h.includes('负荷') || h.includes('劳累')) strainCol = c;
        }
        for (let r = hr + 1; r <= maxR; r++) {
          const tName = cellStr(r, nameCol).replace(/\s+/g, ' ').trim();
          if (!tName || tName === 'Value' || tName === '属性') break;
          if (tName === '天赋' || tName === '名称') continue;
          const rank = cellNum(r, rankCol);
          if (rank === undefined && !cellStr(r, attrCol)) continue;
          const attr = parseAttrKey(cellStr(r, attrCol));
          const strain = strainCol > 0 ? (cellNum(r, strainCol) || 0) : 0;
          const isAttack = tName.includes('攻击') || tName.includes('武器') || tName.includes('徒手') || tName.toLowerCase().includes('weapon');
          data.talents.push({ id: `t_imp_${r}`, name: tName, attr, rank: rank || 1, strain, isAttack });
        }
      }

      // 4. 动态解析武器区
      const wpnAnchor = findCell('武器', 10, 25, 8, 12);
      if (wpnAnchor) {
        const hr = wpnAnchor.r;
        let nameCol = wpnAnchor.c + 1, dmgCol = wpnAnchor.c + 3;
        for (let c = wpnAnchor.c; c <= wpnAnchor.c + 7; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '基础伤害' || h === '伤害') dmgCol = c;
        }
        for (let r = hr + 1; r <= hr + 10; r++) {
          const leftFlag = cellStr(r, wpnAnchor.c);
          if (leftFlag === '装备' || leftFlag === '脉路物品') break;
          const cnName = cellStr(r, nameCol);
          const enName = (leftFlag && leftFlag !== '武器') ? leftFlag : '';
          const wName = cnName || enName;
          if (!wName) continue;
          const dmgStep = cellNum(r, dmgCol) || 4;
          data.weapons.push({ id: `w_imp_${r}`, name: wName, dmgStep });
        }
      }

      // 5. 动态解析装备区（精确停止在“脉路物品”前）
      const gearAnchor = findCell('装备', 14, 35, 8, 12);
      if (gearAnchor) {
        const hr = gearAnchor.r;
        let nameCol = gearAnchor.c + 1, rankCol = gearAnchor.c + 2, effCol = gearAnchor.c + 3;
        for (let c = gearAnchor.c; c <= gearAnchor.c + 6; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '等级') rankCol = c;
          else if (h === '效果') effCol = c;
        }
        for (let r = hr + 1; r <= hr + 20; r++) {
          const leftFlag = cellStr(r, gearAnchor.c);
          if (leftFlag === '脉路物品' || leftFlag === '角色图像' || leftFlag === '传说点数') break;
          const cnName = cellStr(r, nameCol);
          const enName = (leftFlag && leftFlag !== '装备') ? leftFlag : '';
          const gName = cnName && enName ? `${cnName} (${enName})` : (cnName || enName);
          if (!gName) continue;
          data.gear.push({ name: gName, rank: cellStr(r, rankCol), effect: cellStr(r, effCol) });
        }
      }

      // 6. 动态解析脉路物品区（锚定“脉路物品”行，绝不误收普通装备）
      const tiAnchor = findCell('脉路物品', 16, 45, 8, 12);
      if (tiAnchor) {
        const hr = tiAnchor.r;
        let nameCol = tiAnchor.c + 1, typeCol = tiAnchor.c + 2, effCol = tiAnchor.c + 3;
        for (let c = tiAnchor.c; c <= tiAnchor.c + 6; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '类型') typeCol = c;
          else if (h === '属性' || h === '效果') effCol = c;
        }
        for (let r = hr + 1; r <= hr + 12; r++) {
          const leftFlag = cellStr(r, tiAnchor.c);
          if (leftFlag === '角色图像' || leftFlag === '传说点数' || leftFlag === '财富' || cellStr(r, tiAnchor.c + 4) === '传说点数' || cellStr(r, 13) === '传说点数' || cellStr(r, 13) === '财富') break;
          const cnName = cellStr(r, nameCol);
          const enName = (leftFlag && leftFlag !== '脉路物品') ? leftFlag : '';
          const tiName = cnName && enName ? `${cnName} (${enName})` : (cnName || enName);
          if (!tiName) continue;
          data.threadItems.push({ name: tiName, type: cellStr(r, typeCol), effect: cellStr(r, effCol) });
        }
      }

      // 7. 动态解析法术区（兼容表头偏移、中英文法术名及多行法术）
      const spAnchor = findCell('法术', 1, 15, 14, 22);
      if (spAnchor) {
        let hr = spAnchor.r;
        for (let r = spAnchor.r; r <= spAnchor.r + 1; r++) {
          if (cellStr(r, spAnchor.c + 1) === '名称' || cellStr(r, spAnchor.c) === '名称') { hr = r; break; }
        }
        let nameCol = spAnchor.c + 1, cirCol = spAnchor.c + 2, thrCol = spAnchor.c + 3, weavCol = spAnchor.c + 4, castCol = spAnchor.c + 5, durCol = spAnchor.c + 6, effCol = spAnchor.c + 7;
        for (let c = spAnchor.c; c <= Math.min(maxC, spAnchor.c + 10); c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '环数') cirCol = c;
          else if (h === '脉路') thrCol = c;
          else if (h === '编织') weavCol = c;
          else if (h === '施法') castCol = c;
          else if (h === '持续') durCol = c;
          else if (h === '效果') effCol = c;
        }
        for (let r = hr + 1; r <= maxR; r++) {
          const flag = cellStr(r, spAnchor.c);
          if (flag === '技能' || flag === '通用技能') break;
          const rawSName = cellStr(r, nameCol);
          const altSName = (flag && flag !== '法术') ? flag : '';
          const sName = ((rawSName && rawSName !== '名称') ? (altSName && !rawSName.includes(altSName) ? `${rawSName} (${altSName})` : rawSName) : altSName).replace(/^[-•·\s]+/, '');
          if (!sName || sName === '名称') continue;
          const dbMatch = findSpellInDb(sName);
          if (dbMatch) {
            data.spells.push({ ...dbMatch, instanceId: `sp_imp_${r}`, wovenThreads: 0, matchedDb: true });
          } else {
            const wText = cellStr(r, weavCol);
            const wBase = Number((wText.match(/\d+/) || [5])[0]);
            const cText = cellStr(r, castCol);
            const isFixed = /^\d+$/.test(cText);
            data.spells.push({
              id: `custom_${r}`,
              instanceId: `sp_imp_${r}`,
              nameCn: sName,
              nameEn: '',
              discipline: data.disciplineId || 'wizard',
              circle: cellNum(r, cirCol) || 1,
              threads: Number((cellStr(r, thrCol).match(/\d+/) || [0])[0]),
              weavingBase: wBase,
              weavingHigh: wBase + 5,
              castingType: isFixed ? 'fixed' : 'TMD',
              castingDn: isFixed ? Number(cText) : null,
              range: '见说明',
              duration: cellStr(r, durCol) || '-',
              aoe: '',
              effectFormula: cellStr(r, effCol) || 'WIL',
              effectType: 'utility',
              armorType: 'ma',
              desc: cellStr(r, effCol) || '自定义导入法术',
              extraThreads: [],
              extraEffectStepPerThread: 0,
              wovenThreads: 0,
              matchedDb: false
            });
          }
        }
      }

      // 8. 动态解析技能区（支持分类、等级、关键属性与负荷）
      const skAnchor = findCell('技能', 10, 40, 16, 20);
      if (skAnchor) {
        const hr = skAnchor.r;
        let catCol = skAnchor.c, nameCol = skAnchor.c + 1, rankCol = skAnchor.c + 2, attrCol = skAnchor.c + 3, strainCol = -1;
        for (let c = skAnchor.c; c <= skAnchor.c + 8; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '等级') rankCol = c;
          else if (h === '属性' || h === '关键属性') attrCol = c;
          else if (h.includes('负荷') || h.includes('劳累')) strainCol = c;
        }
        for (let r = hr + 1; r <= maxR; r++) {
          const skName = cellStr(r, nameCol);
          if (!skName) continue;
          const cat = cellStr(r, catCol) || '通用技能';
          const rank = cellNum(r, rankCol) || 1;
          const attr = parseAttrKey(cellStr(r, attrCol));
          const strain = strainCol > 0 ? (cellNum(r, strainCol) || 0) : 0;
          data.skills.push({
            id: `sk_imp_${r}`,
            category: cat,
            name: skName,
            rank,
            attr,
            strain,
            isAttack: skName.includes('武器') || skName.includes('攻击')
          });
        }
      }

      // 9. 解析传说点数与财富
      const lpAnchor = findCell('传说点数', 15, 45, 10, 18);
      if (lpAnchor) {
        data.legend = {
          total: findRightVal('总计', 45, 16) || '',
          current: findRightVal('现有', 45, 16) || '',
          status: findRightVal('传说状态', 45, 16) || '',
          renown: findRightVal('名望', 45, 16) || '',
          reputation: findRightVal('声誉', 45, 16) || ''
        };
      }
      const wAnchor = findCell('财富', 20, 50, 3, 18);
      if (wAnchor) {
        const readNext = (lbl) => {
          const c = findCell(lbl, wAnchor.r, wAnchor.r + 8, wAnchor.c - 1, wAnchor.c + 2);
          return c ? (cellStr(c.r, c.c + 1) || 0) : 0;
        };
        data.wealth = {
          copper: readNext('铜币'),
          silver: readNext('银币'),
          gold: readNext('金币'),
          other: readNext('其他') || ''
        };
      }
      // 10. 解析人物背景（优先匹配“背景”/“人物背景”标签，未命中或为空时自动回退读取 I44）
      let bgAnchor = null;
      const bgSearchR = Math.max(maxR, 60);
      const bgSearchC = Math.max(maxC, 20);
      for (let r = 1; r <= bgSearchR && !bgAnchor; r++) {
        for (let c = 1; c <= bgSearchC; c++) {
          const lbl = cellStr(r, c).replace(/[：:]$/, '').trim();
          if (lbl === '背景' || lbl === '人物背景') {
            bgAnchor = { r, c };
            break;
          }
        }
      }
      if (bgAnchor) {
        const m = findMerge(bgAnchor.r, bgAnchor.c);
        const rightCol = m ? m.e.c + 2 : bgAnchor.c + 1;
        const belowRow = m ? m.e.r + 2 : bgAnchor.r + 1;
        data.background = readMergedText(bgAnchor.r, rightCol) || readMergedText(belowRow, bgAnchor.c);
      }
      if (!data.background) {
        data.background = readMergedText(44, 9);
      }
      if (!data.background) {
        for (const sName of wb.SheetNames) {
          const hit = readSheetMergedText(wb.Sheets[sName], 44, 9);
          if (hit) {
            data.background = hit;
            break;
          }
        }
      }

      data.spells.forEach((sp, idx) => { sp.inMatrix = idx < 3; });

      return data;
    }

    function parseTxtSheet(text) {
      const lines = text.split(/\r?\n/);
      const grabField = (label) => {
        const re = new RegExp(`^${label}[：:]\\s*(.*)$`);
        for (const l of lines) {
          const m = l.trim().match(re);
          if (m) return m[1].trim();
        }
        return '';
      };

      const data = {
        name: grabField('角色名'),
        raceId: matchRaceId(grabField('种族')),
        disciplineId: matchDisciplineId(grabField('门类')),
        circle: Number((grabField('环数').match(/\d+/) || [1])[0]),
        background: '',
        attrs: {},
        talents: [],
        weapons: [],
        spells: [],
        skills: [],
        gear: [],
        threadItems: []
      };

      ['敏捷', '力量', '强韧', '感知', '意志', '魅力'].forEach(cn => {
        const v = grabField(cn);
        const m = v.match(/\d+/);
        if (m) data.attrs[parseAttrKey(cn)] = Number(m[0]);
      });

      const initPenStr = grabField('护甲调整');
      if (initPenStr && !isNaN(Number(initPenStr))) data.initAdj = -Math.abs(Number(initPenStr));
      const kAvail = grabField('可用');
      if (kAvail && !isNaN(Number(kAvail))) data.karmaAvail = Number(kAvail);
      const curDmg = grabField('当前伤害');
      if (curDmg && !isNaN(Number(curDmg))) data.currentDamage = Number(curDmg);
      const bDmg = grabField('血魔法伤害');
      if (bDmg && !isNaN(Number(bDmg))) data.bloodDamage = Number(bDmg);
      const wnd = grabField('负伤');
      if (wnd && !isNaN(Number(wnd))) data.wounds = Number(wnd);

      data.legend = {
        total: grabField('总计') || '',
        current: grabField('现有') || '',
        status: grabField('传说状态') || '',
        renown: grabField('名望') || '',
        reputation: grabField('声誉') || ''
      };
      data.wealth = {
        copper: grabField('铜币') || 0,
        silver: grabField('银币') || 0,
        gold: grabField('金币') || 0,
        other: grabField('其他') || ''
      };

      let section = '';
      let readingBg = false;
      const bgLines = [];
      const ALL_SECTIONS = ['属性', '先攻', '业力', '健康等级', '天赋', '武器', '法术', '装备', '传说点数', '财富', '技能', '脉路物品和编织脉路', '角色印象'];
      for (const rawLine of lines) {
        const l = rawLine.trim();
        const bgMatch = l.match(/^(?:【背景】|\[背景\]|背景[：:])(.*)$/);
        if (bgMatch) {
          readingBg = true;
          section = '背景';
          if (bgMatch[1].trim()) bgLines.push(bgMatch[1].trim());
          continue;
        }
        if (readingBg) {
          if (/^【[^】]+】$/.test(l) || /^\[[^\]]+\]$/.test(l) || ALL_SECTIONS.includes(l)) {
            readingBg = false;
          } else {
            bgLines.push(rawLine.replace(/\r$/, ''));
            continue;
          }
        }
        if (!l || l.startsWith('+++')) continue;
        if (ALL_SECTIONS.includes(l)) {
          section = l;
          continue;
        }
        if (/^【[^】]+】$/.test(l) || /^\[[^\]]+\]$/.test(l)) {
          section = '';
          continue;
        }
        if (['传说点数', '财富', '属性', '先攻', '业力', '健康等级', '角色印象', '背景'].includes(section)) continue;
        if (l.startsWith('名称')) continue;
        const cols = l.split(/\s{2,}|\t+/);
        if (section === '天赋' && cols.length >= 3) {
          const tName = cols[0];
          const rank = Number((cols[1].match(/\d+/) || [1])[0]);
          const attr = parseAttrKey(cols[2]);
          const strain = cols[5] ? Number((cols[5].match(/\d+/) || [0])[0]) : 0;
          data.talents.push({ id: `t_txt_${data.talents.length}`, name: tName, attr, rank, strain, isAttack: tName.includes('武器') || tName.includes('攻击') });
        } else if (section === '武器' && cols.length >= 2) {
          const dmgStep = Number((cols[2]?.match(/\d+/) || cols[1]?.match(/\d+/) || [4])[0]);
          data.weapons.push({ id: `w_txt_${data.weapons.length}`, name: cols[0], dmgStep });
        } else if (section === '法术' && cols.length >= 1) {
          const sName = cols[0].replace(/^[-•·\s]+/, '');
          const dbMatch = findSpellInDb(sName);
          if (dbMatch) {
            data.spells.push({ ...dbMatch, instanceId: `sp_txt_${data.spells.length}`, wovenThreads: 0, matchedDb: true });
          } else {
            data.spells.push({
              id: `custom_txt_${data.spells.length}`,
              instanceId: `sp_txt_${data.spells.length}`,
              nameCn: sName,
              nameEn: '',
              discipline: data.disciplineId || 'wizard',
              circle: Number((cols[1]?.match(/\d+/) || [1])[0]),
              threads: Number((cols[2]?.match(/\d+/) || [0])[0]),
              weavingBase: Number((cols[3]?.match(/\d+/) || [5])[0]),
              weavingHigh: 10,
              castingType: /^\d+$/.test(cols[4] || '') ? 'fixed' : 'TMD',
              castingDn: /^\d+$/.test(cols[4] || '') ? Number(cols[4]) : null,
              range: '见说明',
              duration: cols[5] || '-',
              aoe: '',
              effectFormula: cols[6] || 'WIL',
              effectType: 'utility',
              armorType: 'ma',
              desc: cols[6] || 'TXT导入法术',
              extraThreads: [],
              extraEffectStepPerThread: 0,
              wovenThreads: 0,
              matchedDb: false
            });
          }
        } else if (section === '装备') {
          data.gear.push({ name: cols[0], rank: cols[1] || '', effect: cols[2] || '' });
        } else if (section === '脉路物品和编织脉路') {
          data.threadItems.push({ name: cols[0], type: cols[1] || '', effect: cols[2] || '' });
        } else if (section === '技能' && cols.length >= 3) {
          data.skills.push({ id: `sk_txt_${data.skills.length}`, category: '通用技能', name: cols[0], rank: Number((cols[1].match(/\d+/) || [1])[0]), attr: parseAttrKey(cols[2]), strain: 0, isAttack: cols[0].includes('武器') || cols[0].includes('攻击') });
        }
      }

      data.background = bgLines.join('\n').trim();
      data.spells.forEach((sp, idx) => { sp.inMatrix = idx < 3; });
      return data;
    }

    

    function normalizeImportedCharacter(basePl, data) {
      const pl = JSON.parse(JSON.stringify(basePl));
      if (data.name) pl.name = data.name;
      if (data.raceId) pl.raceId = data.raceId;
      if (data.disciplineId) pl.disciplineId = data.disciplineId;
      if (data.circle && !isNaN(data.circle)) pl.circle = Math.max(1, Math.min(15, Number(data.circle)));
      if (data.gear) pl.gear = data.gear.map(g => ({ ...g, equipped: g.equipped !== false }));
      if (data.threadItems) pl.threadItems = data.threadItems.map(ti => ({ ...ti, equipped: ti.equipped !== false }));

      const race = RACES[pl.raceId] || RACES.human;
      const impBonuses = calcEquippedBonuses(pl.gear, pl.threadItems);
      if (impBonuses.pa > 0) pl.armor.pa = 0;
      if (impBonuses.ma > 0) pl.armor.ma = 0;
      if (impBonuses.pd > 0) pl.shield.pd = 0;
      if (impBonuses.md > 0) pl.shield.md = 0;

      if (data.attrs) {
        for (const k of Object.keys(ATTR_NAMES)) {
          if (data.attrs[k] && !isNaN(data.attrs[k])) {
            pl.attrMods[k] = data.attrs[k] - race.base[k] - (impBonuses[k] || 0);
          }
        }
      }
      if (data.talents && data.talents.length > 0) pl.talents = data.talents;
      if (data.skills) pl.skills = data.skills;
      if (data.weapons && data.weapons.length > 0) pl.weapons = data.weapons;
      if (data.spells) pl.spells = data.spells;
      if (data.legend) pl.legend = { ...pl.legend, ...data.legend };
      if (data.wealth) pl.wealth = { ...pl.wealth, ...data.wealth };

      const d = calcPlDerived(pl);
      if (data.uncon && !isNaN(data.uncon)) {
        const baseUncon = d.attrs.TOU * 2 + d.prog.disc.durability * pl.circle;
        pl.durabilityBonus = Number(data.uncon) - baseUncon;
      }
      const d2 = calcPlDerived(pl);
      pl.karmaCurrent = d2.karmaMax;
      pl.recoveryCurrent = d2.recoveryMax;
      pl.currentDamage = data.currentDamage || 0;
      pl.wounds = data.wounds || 0;
      pl.background = data.background !== undefined ? String(data.background) : '';
      return pl;
    }

    const ED4Engine = {
      ATTR_NAMES, ATTR_COST, CARRY_TABLE, STEP_BASE, STEP_CYCLE, RACES, DISCIPLINES, SPELLS_DB, SPELL_ALIASES, LEGACY_SPELL_ID_MAP, WEAVING_KEYWORDS,
      attrToStep, getStepDice, rollExplodingDie, rollStepTest,
      getDisciplineBonuses, parseItemBonuses, calcEquippedBonuses, calcPlDerived, getPlActionMod,
      findSpellInDb, hasSpellEffectRoll, getThreadWeavingStep, getSpellcastingStep,
      resolveDamage, resolveAvoidBlow, resolveRiposte,
      matchRaceId, matchDisciplineId, parseAttrKey,
      parseExcelWorkbook, parseTxtSheet, normalizeImportedCharacter
    };

    if (typeof module !== 'undefined' && module.exports) {
      module.exports = ED4Engine;
    }
    if (typeof window !== 'undefined') {
      window.ED4Engine = ED4Engine;
    }

export default ED4Engine;
