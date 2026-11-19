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
      swordmaster: { name: '剑术大师', en: 'Swordmaster', aliases: ['剑术大师', '剑圣', 'Swordmaster'], durability: 7, isCaster: false, weavingName: '武器编织', c2: 'sd', c4: 'pd', c6: 'sd', c7: 'init', c8: 'pd' },
      warrior: { name: '战士', en: 'Warrior', aliases: ['战士', 'Warrior'], durability: 7, isCaster: false, weavingName: '战争编织', c2: 'pd', c4: 'md', c6: 'pd', c7: 'rec', c8: 'pd' },
      sky_raider: { name: '空贼', en: 'Sky Raider', aliases: ['空贼', '天空掠夺者', 'Sky Raider'], durability: 7, isCaster: false, weavingName: '天空编织', c2: 'pd', c4: 'sd', c6: 'pd', c7: 'rec', c8: 'pd' },
      cavalryman: { name: '骑兵', en: 'Cavalryman', aliases: ['骑兵', 'Cavalryman'], durability: 7, isCaster: false, weavingName: '骑乘编织', c2: 'pd', c4: 'sd', c6: 'pd', c7: 'rec', c8: 'pd' },
      beastmaster: { name: '驯兽师', en: 'Beastmaster', aliases: ['驯兽师', 'Beastmaster'], durability: 7, isCaster: false, weavingName: '野兽编织', c2: 'pd', c4: 'sd', c6: 'pd', c7: 'rec', c8: 'pd' },
      air_sailor: { name: '空帆手', en: 'Air Sailor', aliases: ['空帆手', '飞空水手', 'Air Sailor'], durability: 5, isCaster: false, weavingName: '航行编织', c2: 'pd', c4: 'sd', c6: 'pd', c7: 'rec', c8: 'pd' },
      archer: { name: '弓箭手', en: 'Archer', aliases: ['弓箭手', 'Archer'], durability: 5, isCaster: false, weavingName: '箭矢编织', c2: 'pd', c4: 'md', c6: 'pd', c7: 'init', c8: 'pd' },
      scout: { name: '斥候', en: 'Scout', aliases: ['斥候', 'Scout'], durability: 5, isCaster: false, weavingName: '斥候编织', c2: 'pd', c4: 'md', c6: 'pd', c7: 'init', c8: 'pd' },
      thief: { name: '盗贼', en: 'Thief', aliases: ['盗贼', 'Thief'], durability: 5, isCaster: false, weavingName: '窃贼编织', c2: 'pd', c4: 'sd', c6: 'pd', c7: 'init', c8: 'pd' },
      troubadour: { name: '吟游诗人', en: 'Troubadour', aliases: ['吟游诗人', 'Troubadour'], durability: 5, isCaster: false, weavingName: '故事编织', c2: 'sd', c4: 'md', c6: 'sd', c7: 'init', c8: 'sd' },
      weaponsmith: { name: '武器匠', en: 'Weaponsmith', aliases: ['武器匠', 'Weaponsmith'], durability: 5, isCaster: false, weavingName: '匠脉编织', c2: 'md', c4: 'pd', c6: 'md', c7: 'ma', c8: 'md' },
      elementalist: { name: '元素师', en: 'Elementalist', aliases: ['元素师', '元素使', 'Elementalist'], durability: 3, isCaster: true, weavingName: '元素编织', c2: 'md', c4: 'pd', c6: 'md', c7: 'rec', c8: 'md' },
      illusionist: { name: '幻术师', en: 'Illusionist', aliases: ['幻术师', 'Illusionist'], durability: 3, isCaster: true, weavingName: '幻术编织', c2: 'md', c4: 'sd', c6: 'md', c7: 'init', c8: 'md' },
      nethermancer: { name: '下界术士', en: 'Nethermancer', aliases: ['下界术士', '死灵法师', 'Nethermancer'], durability: 3, isCaster: true, weavingName: '下界编织', c2: 'md', c4: 'sd', c6: 'md', c7: 'ma', c8: 'md' },
      wizard: { name: '巫师', en: 'Wizard', aliases: ['巫师', 'Wizard'], durability: 3, isCaster: true, weavingName: '巫术编织', c2: 'md', c4: 'sd', c6: 'md', c7: 'ma', c8: 'md' }
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

    const normSpellKey = (str) =>
      String(str || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[（）()【】\[\]]/g, ' ').replace(/\s+/g, ' ').trim();

    // 单一扁平法术索引：收敛 id、旧版 ID、中英文名与常用别称
    const SPELL_LOOKUP_MAP = new Map();
    const SPELL_EXTRA_ALIASES = [
      ['ele_air_armor', 'air-armor'], ['ele_earth_darts', 'earth-darts'], ['ele_flameweapon', 'flameweapon'],
      ['ele_heat_food', 'heat-food'], ['ele_resist_element', 'resist-element'], ['ele_shelter', 'shelter'],
      ['ele_air_mattress', 'air-mattress'], ['ele_icy_surface', 'icy-surface'], ['ele_shield_willow', 'shield-willow'],
      ['ill_assuring_touch', 'assuring-touch'], ['ill_cloak', 'cloak'], ['ill_ephemeral_bolt', 'ephemeral-bolt'],
      ['ill_monstrous_mantle', 'monstrous-mantle'], ['ill_unseen_voices', 'unseen-voices'], ['ill_blindness', 'blindness'],
      ['ill_displace_image', 'displace-image'], ['ill_phantom_flame', 'phantom-flame'], ['ill_see_unseen', 'see-the-unseen'],
      ['net_astral_spear', 'astral-spear'], ['net_ethereal_darkness', 'ethereal-darkness'], ['net_soul_armor', 'soul-armor'],
      ['net_soulless_eyes', 'soulless-eyes'], ['net_spirit_dart', 'spirit-dart'], ['net_aspect_fog_ghost', 'aspect-of-the-fog-ghost'],
      ['net_chilling_circle', 'chilling-circle'], ['net_nights_edge', 'night-s-edge'],
      ['wiz_logic_display', 'bedazzling-display-of-logical-analysis'], ['wiz_catseyes', 'catseyes'],
      ['wiz_flame_flash', 'flame-flash'], ['wiz_mage_armor', 'mage-armor'], ['wiz_mind_dagger', 'mind-dagger'],
      ['wiz_quicken_pace', 'quicken-pace'], ['wiz_astral_shield', 'astral-shield'], ['wiz_crushing_will', 'crushing-will'],
      ['wiz_seeking_sight', 'seeking-sight'], ['ele_ice_mace', 'ice-mace-and-chain'], ['ele_lightning_bolt', 'lightning-bolt'],
      ['ele_winds_deflection', 'winds-of-deflection'], ['ele_blizzard_sphere', 'blizzard-sphere'],
      ['ele_elemental_spear', 'elemental-spear'], ['ele_lightning_step', 'lightning-step'], ['ele_fireball', 'fireball'],
      ['ele_heat_armor', 'heat-armor'], ['ele_fireweave', 'fireweave'], ['ele_thunderclap', 'thunderclap'],
      ['ele_whirlwind', 'whirlwind'], ['ele_crushing_hand', 'crushing-hand-of-earth'], ['ill_nobody_here', 'nobody-here'],
      ['ill_phantom_warrior', 'phantom-warrior'], ['ill_notice_not', 'notice-not'], ['ill_phantom_lightning', 'phantom-lightning'],
      ['ill_eye_of_truth', 'eye-of-truth'], ['ill_phantom_fireball', 'phantom-fireball'], ['ill_astral_shadow', 'astral-shadow'],
      ['ill_stampede', 'stampede'], ['ill_shadow_spell', 'shadow-spell'], ['net_arrow_of_night', 'arrow-of-night'],
      ['net_pain', 'pain'], ['net_fog_of_fear', 'fog-of-fear'], ['net_evil_eye', 'evil-eye'],
      ['net_aspect_tyrant', 'aspect-of-the-menacing-tyrant'], ['net_aspect_physician', 'aspect-of-the-cruel-physician'],
      ['net_wither_limb', 'wither-limb'], ['net_astral_maw', 'astral-maw'], ['net_debilitating_gloom', 'debilitating-gloom'],
      ['net_restrain_entity', 'restrain-entity'], ['net_netherblade', 'netherblade'], ['net_shadow_tether', 'shadow-tether'],
      ['wiz_astral_targeting', 'astral-targeting'], ['wiz_aura_strike', 'aura-strike'], ['wiz_binding_threads', 'binding-threads'],
      ['wiz_wizards_cloak', 'wizard-s-cloak'], ['wiz_mystic_shock', 'mystic-shock'], ['wiz_sever_talent', 'sever-talent'],
      ['wiz_slow', 'slow'], ['wiz_energy_shield', 'energy-shield'], ['wiz_confusing_weave', 'confusing-weave'],
      ['wiz_astral_catastrophe', 'astral-catastrophe'], ['wiz_compression_bubble', 'compression-bubble'],
      ['星界长矛', 'astral-spear'], ['星界之矛', 'astral-spear'], ['星质矛', 'astral-spear'],
      ['灵魂甲', 'soul-armor'], ['精神镖', 'spirit-dart'], ['精神飞刺', 'spirit-dart'],
      ['恐惧迷雾', 'fog-of-fear'], ['夜箭', 'arrow-of-night'], ['夜之箭', 'arrow-of-night'], ['夜之矢', 'arrow-of-night'],
      ['迷雾幽魂', 'aspect-of-the-fog-ghost'], ['残酷医者', 'aspect-of-the-cruel-physician'],
      ['险恶暴君', 'aspect-of-the-menacing-tyrant'], ['枯萎术', 'wither-limb'], ['凋零', 'wither-limb'],
      ['寒霜法阵', 'chilling-circle'], ['火球', 'fireball'], ['闪电', 'lightning-bolt'],
      ['法师甲', 'mage-armor'], ['心灵匕', 'mind-dagger']
    ];
    for (const sp of SPELLS_DB) {
      SPELL_LOOKUP_MAP.set(sp.id, sp);
      const cn = normSpellKey(sp.nameCn || sp.name);
      if (cn) SPELL_LOOKUP_MAP.set(cn, sp);
      const en = normSpellKey(sp.nameEn);
      if (en) SPELL_LOOKUP_MAP.set(en, sp);
      if (sp.aliases) {
        for (const a of sp.aliases) {
          const ka = normSpellKey(a);
          if (ka && !SPELL_LOOKUP_MAP.has(ka)) SPELL_LOOKUP_MAP.set(ka, sp);
        }
      }
    }
    for (const [alias, id] of SPELL_EXTRA_ALIASES) {
      const target = SPELL_LOOKUP_MAP.get(id);
      if (target) SPELL_LOOKUP_MAP.set(alias, target);
    }

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

    const ACTION_TYPES = ['标准', '简单', '自由', '持续', '无'];

    const TALENT_SKILL_RULES = [
      // 常见自由动作天赋/技能
      { keys: ['回避打击', '闪避', 'avoid blow'], action: '自由', strain: 1 },
      { keys: ['杂耍防御', 'acrobatic defense'], action: '自由', strain: 1 },
      { keys: ['反击', 'riposte'], action: '自由', strain: 2 },
      { keys: ['负伤平衡', 'wound balance'], action: '自由', strain: 0 },
      { keys: ['钢铁意志', 'iron will'], action: '自由', strain: 0 },
      { keys: ['钢骨', 'steel thought'], action: '自由', strain: 0 },
      { keys: ['心智防御', 'mind armor'], action: '自由', strain: 0 },
      { keys: ['抵抗嘲讽', 'resist taunt'], action: '自由', strain: 0 },
      { keys: ['第二攻击', 'second attack'], action: '自由', strain: 1 },
      { keys: ['第二武器', 'second weapon'], action: '自由', strain: 1 },
      { keys: ['疾步', 'sprint'], action: '自由', strain: 1 },
      { keys: ['猛扑', 'tiger spring'], action: '自由', strain: 1 },
      { keys: ['惊吓一击', '奇袭打击', 'surprise strike'], action: '自由', strain: 1 },
      { keys: ['洞察弱点', 'spot armor flaw'], action: '自由', strain: 1 },
      { keys: ['木皮', 'wood skin'], action: '自由', strain: 1 },
      { keys: ['狂暴', 'frenzy'], action: '自由', strain: 1 },
      { keys: ['意志之力', 'willforce'], action: '自由', strain: 1 },
      { keys: ['法术矩阵', '强化矩阵', '共享矩阵', '护甲矩阵', 'spell matrix', 'enhanced matrix', 'shared matrix', 'armored matrix'], action: '自由', strain: 0 },
      { keys: ['跃起', 'kip up'], action: '自由', strain: 2 },

      // 常见简单动作天赋/技能
      { keys: ['捕风者', 'wind catcher'], action: '简单', strain: 1 },
      { keys: ['脉路编织', '元素编织', '幻术编织', '下界编织', '巫术编织', '武器编织', '战争编织', '天空编织', '骑乘编织', '野兽编织', '航行编织', '箭矢编织', '斥候编织', '窃贼编织', '故事编织', '匠脉编织', 'thread weaving', 'weaving'], action: '简单', strain: 0 },
      { keys: ['星界感知', '星界视界', 'astral sight'], action: '简单', strain: 1 },
      { keys: ['机动', 'maneuver'], action: '简单', strain: 1 },
      { keys: ['气之步', 'air dance'], action: '简单', strain: 1 },
      { keys: ['嘲讽', 'taunt'], action: '简单', strain: 0 },
      { keys: ['威胁', '恐吓', 'intimidate', 'threaten'], action: '简单', strain: 0 },
      { keys: ['战斗咆哮', 'battle shout', 'battle bellow'], action: '简单', strain: 0 },
      { keys: ['领导', 'leadership'], action: '简单', strain: 0 },
      { keys: ['察觉', '感知检定', '敏锐感官', 'awareness', 'perception'], action: '简单', strain: 0 },
      { keys: ['隐秘行动', '潜行', 'stealthy stride', 'stealth'], action: '简单', strain: 0 },
      { keys: ['空帆航行', '飞空航行', '驾空驭风', 'air sailing'], action: '简单', strain: 0 },
      { keys: ['攀爬', 'climbing'], action: '简单', strain: 0 },
      { keys: ['游泳', 'swimming'], action: '简单', strain: 0 },
      { keys: ['跳跃', 'jumping'], action: '简单', strain: 0 },
      { keys: ['追踪', 'tracking'], action: '简单', strain: 0 },
      { keys: ['杂技', '翻滚', 'acrobatics'], action: '简单', strain: 0 },
      { keys: ['骑术', '驾驭', 'riding', 'animal handling'], action: '简单', strain: 0 },

      // 常见标准动作天赋/技能
      { keys: ['近战武器', 'melee weapons'], action: '标准', strain: 0 },
      { keys: ['投射武器', '远程武器', 'missile weapons'], action: '标准', strain: 0 },
      { keys: ['投掷武器', 'throwing weapons'], action: '标准', strain: 0 },
      { keys: ['徒手搏斗', '空手搏斗', '格斗', 'unarmed combat'], action: '标准', strain: 0 },
      { keys: ['施法', 'spellcasting'], action: '标准', strain: 0 },
      { keys: ['交涉', '谈吐', '说服', '议价', '礼仪', '贿赂', '魅惑', 'first impression', 'persuasion', 'conversation', 'diplomacy', 'etiquette', 'bribery', 'seduction', 'haggling'], action: '标准', strain: 0 },
      { keys: ['第一印象'], action: '标准', strain: 0 },
      { keys: ['急救', '医疗', '治疗伤势', 'physician', 'treat wounds'], action: '标准', strain: 0 },
      { keys: ['撬锁', '开锁', 'lock picking'], action: '标准', strain: 0 },
      { keys: ['解除陷阱', 'disarm trap'], action: '标准', strain: 0 },
      { keys: ['扒窃', '妙手', 'pick pockets'], action: '标准', strain: 0 },
      { keys: ['炼金术', '制图', '工匠', '锻造', '知识', '历史', '学识', '语言', '读写', 'alchemy', 'artisan', 'mapmaking', 'knowledge', 'speak language', 'read and write'], action: '标准', strain: 0 },
      { keys: ['野兽契约', '驯兽', 'animal bond', 'dominate beast'], action: '标准', strain: 0 },

      // 持续 / 无动作
      { keys: ['冥想', '物品历史', '纹路学', '锻造武器', '锻造护甲', 'meditation', 'item history', 'patterncraft', 'forge weapon', 'forge armor'], action: '持续', strain: 0 },
      { keys: ['耐久', 'durability'], action: '无', strain: 0 },
    ];

    function normalizeActionType(raw) {
      const s = String(raw || '').trim();
      if (!s || s === '-' || s === '未设') return '';
      if (ACTION_TYPES.includes(s)) return s;
      const low = s.toLowerCase();
      if (low.includes('standard') || low === 'std' || s.includes('标准')) return '标准';
      if (low.includes('simple') || s.includes('简单')) return '简单';
      if (low.includes('free') || s.includes('自由')) return '自由';
      if (low.includes('sustained') || s.includes('持续')) return '持续';
      if (low === 'none' || low === 'na' || low === 'passive' || s === '无' || s === '无动作' || s === '被动') return '无';
      return '';
    }

    function lookupTalentSkillRule(name, category = '') {
      const clean = String(name || '').trim().toLowerCase();
      if (!clean) return null;
      for (const rule of TALENT_SKILL_RULES) {
        if (rule.keys.some(k => clean.includes(k))) {
          return { action: rule.action, strain: rule.strain };
        }
      }
      const cat = String(category || '');
      if (cat.includes('知识') || cat.includes('工匠') || cat.includes('语言')) {
        return { action: '标准', strain: 0 };
      }
      return null;
    }

    // 1. 门类环数进阶、装备穿脱解析与角色衍生属性计算
    function getDisciplineBonuses(disciplineId, circle) {
      const disc = DISCIPLINES[disciplineId] || DISCIPLINES.warrior;
      const c = Math.max(1, Math.min(15, Number(circle) || 1));
      const out = { disc, pd: 0, md: 0, sd: 0, init: 0, rec: 0, ma: 0 };
      if (c >= 2) out[disc.c2] += 1;
      if (c >= 4) out[disc.c4] += 1;
      if (c >= 6) out[disc.c6] += 1;
      if (c >= 7) out[disc.c7] += 1;
      if (c >= 8) out[disc.c8] += 1;
      return out;
    }

    function parseItemBonuses(text) {
      const b = { pa: 0, ma: 0, pd: 0, md: 0, sd: 0, init: 0, DEX: 0, STR: 0, TOU: 0, PER: 0, WIL: 0, CHA: 0 };
      const s = String(text || '');
      if (!s) return b;
      const sumMatches = (re) => {
        let total = 0, m;
        while ((m = re.exec(s)) !== null) total += Number(m[1]);
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
      for (const item of [...gear, ...threadItems]) {
        if (item.equipped === false) continue;
        const b = parseItemBonuses(`${item.name || ''} ${item.effect || ''}`);
        for (const k of Object.keys(total)) total[k] += b[k];
      }
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
        const mod = pl.attrMods[k] || 0;
        spentPoints += ATTR_COST[mod] !== undefined ? ATTR_COST[mod] : mod;
        attrs[k] = race.base[k] + mod + itemBonuses[k];
        steps[k] = attrToStep(attrs[k]);
      }

      let pd = Math.floor((attrs.DEX + 3) / 2) + (race.pdBonus || 0) + prog.pd + itemBonuses.pd;
      let md = Math.floor((attrs.PER + 3) / 2) + prog.md + itemBonuses.md;
      let sd = Math.floor((attrs.CHA + 3) / 2) + prog.sd + itemBonuses.sd;

      if (!pl.statuses.blindsided) {
        pd += Number(pl.shield.pd) || 0;
        md += Number(pl.shield.md) || 0;
      }
      if (pl.options.defensive) { pd += 3; md += 3; }
      if (pl.options.aggressive) { pd -= 3; md -= 3; }
      if (pl.statuses.knockedDown) { pd -= 3; md -= 3; sd -= 3; }
      if (pl.statuses.blindsided) { pd -= 3; }
      if (pl.statuses.harried) { pd -= 2; md -= 2; sd -= 2; }

      pd = Math.max(1, pd);
      md = Math.max(1, md);
      sd = Math.max(1, sd);

      const pa = (Number(pl.armor.pa) || 0) + (race.naturalArmor || 0) + itemBonuses.pa;
      const ma = Math.floor(attrs.WIL / 5) + (Number(pl.armor.ma) || 0) + prog.ma + itemBonuses.ma;

      const uncon = attrs.TOU * 2 + prog.disc.durability * pl.circle + (Number(pl.durabilityBonus) || 0);
      const death = uncon + attrs.TOU + pl.circle + (pl.raceId === 'obsidiman' ? 10 : 0);
      const woundThreshold = Math.floor((attrs.TOU + 4) / 2) + (race.woundBonus || 0);
      const recoveryMax = Math.max(1, Math.round(attrs.TOU / 6)) + prog.rec;
      const karmaMax = pl.circle * race.karmaMod;

      const initPen = (Number(pl.armor.initPen) || 0) + (Number(pl.shield.initPen) || 0);
      const initStep = Math.max(1, steps.DEX - initPen + (Number(pl.initBonus) || 0) + prog.init + itemBonuses.init);

      return {
        race, prog, attrs, steps, spentPoints, itemBonuses,
        pd, md, sd, pa, ma,
        uncon, death, woundThreshold, recoveryMax, karmaMax, initStep
      };
    }

    function getPlActionMod(pl) {
      let mod = -Math.max(0, Number(pl.wounds) || 0);
      if (pl.options.defensive) mod -= 3;
      if (pl.options.knockdown) mod -= 2;
      if (pl.options.splitMove) mod -= 2;
      if (pl.statuses.knockedDown) mod -= 3;
      if (pl.statuses.harried) mod -= 2;
      return mod;
    }

    // 2. 法术匹配、脉路编织与效果计算
    function findSpellInDb(name) {
      const raw = (name || '').trim();
      if (!raw) return null;
      const clean = normSpellKey(raw);
      const exact = SPELL_LOOKUP_MAP.get(raw) || SPELL_LOOKUP_MAP.get(clean);
      if (exact) return exact;

      const fuzzy = SPELLS_DB.find(s => {
        const cn = normSpellKey(s.nameCn || s.name);
        const en = normSpellKey(s.nameEn);
        const aliasList = s.aliases ? s.aliases.map(normSpellKey) : [];
        return (
          (clean.length >= 2 && (cn.includes(clean) || clean.includes(cn))) ||
          (en && clean.length >= 3 && (en.includes(clean) || clean.includes(en))) ||
          aliasList.some(a => a.length >= 2 && (a === clean || (clean.length >= 3 && (a.includes(clean) || clean.includes(a)))))
        );
      });
      if (fuzzy) return fuzzy;

      for (const [alias, id] of SPELL_EXTRA_ALIASES) {
        if (!alias.includes('_') && clean.includes(alias)) return SPELL_LOOKUP_MAP.get(id) || null;
      }
      return null;
    }

    function hasSpellEffectRoll(sp) {
      if (!sp) return false;
      if (sp.effectStepBonus !== null && sp.effectStepBonus !== undefined) return true;
      if (sp.usesCircleAsBase || sp.effectType === 'damage') return true;
      if (sp.effectType === 'buff') return false;
      return /\bWIL\b|意志|\bCIRCLE\b|环数/i.test(String(sp.effectFormula || ''));
    }

    function getThreadWeavingStep(pl, derived = null, spell = null) {
      const d = derived || calcPlDerived(pl);
      const talents = pl.talents || [];
      const disc = DISCIPLINES[(spell && spell.discipline) || pl.disciplineId] || null;
      const discWeaving = disc ? disc.weavingName.toLowerCase() : '';
      let t = discWeaving ? talents.find(x => x.name.toLowerCase().includes(discWeaving)) : null;
      if (!t) {
        t = talents.find(x => {
          const nm = x.name.toLowerCase();
          return nm.includes('编织') || WEAVING_KEYWORDS.some(k => nm.includes(k));
        });
      }
      const rank = t ? t.rank : 0;
      const nm = t ? t.name.toLowerCase() : '';
      return {
        step: Math.max(1, d.steps.PER + rank + getPlActionMod(pl)),
        rank,
        talentName: t ? t.name : (disc ? disc.weavingName : '脉路编织'),
        isVersatilityTalent: Boolean(t && (t.isVersatility || nm.includes('多才多艺') || nm.includes('versatility')))
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
      const colStrToIdx = (colStr) => {
        let n = 0;
        for (let i = 0; i < colStr.length; i++) n = n * 26 + (colStr.charCodeAt(i) - 64);
        return n - 1;
      };
      const idxToColStr = (c) => {
        let s = '';
        let n = c + 1;
        while (n > 0) {
          const r = (n - 1) % 26;
          s = String.fromCharCode(65 + r) + s;
          n = Math.floor((n - 1) / 26);
        }
        return s;
      };
      const decodeCell = (addr) => {
        const m = String(addr).match(/^([A-Z]+)(\d+)$/i);
        return m ? { r: Number(m[2]) - 1, c: colStrToIdx(m[1].toUpperCase()) } : { r: 0, c: 0 };
      };
      const encodeCell = ({ r, c }) => `${idxToColStr(c)}${r + 1}`;
      const decodeRange = (ref) => {
        const [a, b] = String(ref || 'A1').split(':');
        return { s: decodeCell(a), e: decodeCell(b || a) };
      };

      const ws = wb.Sheets[wb.SheetNames[0]];
      const refRange = decodeRange(ws['!ref'] || 'A1:Z80');
      let maxR = Math.max(80, refRange.e.r + 1);
      let maxC = Math.max(28, refRange.e.c + 1);
      for (const k of Object.keys(ws)) {
        if (k.startsWith('!')) continue;
        const pos = decodeCell(k);
        if (pos.r + 1 > maxR) maxR = pos.r + 1;
        if (pos.c + 1 > maxC) maxC = pos.c + 1;
      }

      const cellStr = (r, c) => {
        const addr = encodeCell({ r: r - 1, c: c - 1 });
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
          const topAddr = encodeCell({ r: m.s.r, c: m.s.c });
          const topText = extractCellText(sheet[topAddr]);
          if (topText) return topText;
        }
        const directAddr = encodeCell({ r: r - 1, c: c - 1 });
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
            if (cellStr(r, c).replace(/[：:]$/, '').trim() === exactText) return { r, c };
          }
        }
        return null;
      };
      const findAnchor = (texts, cMin, cMax, rMin = 1, rMax = maxR) => {
        const list = Array.isArray(texts) ? texts : [texts];
        for (let r = rMin; r <= rMax; r++) {
          for (let c = cMin; c <= cMax; c++) {
            const v = cellStr(r, c).replace(/[：:]$/, '').trim();
            if (list.includes(v)) return { r, c, text: v };
          }
        }
        return null;
      };
      const findRightText = (label, rMax = 20, cMin = 1, cMax = 7) => {
        const anc = findCell(label, 1, rMax, cMin, cMax);
        return anc ? readMergedText(anc.r, anc.c + 1) : '';
      };
      const findRightNum = (label, rMax = 20, cMin = 1, cMax = 7) => {
        const anc = findCell(label, 1, rMax, cMin, cMax);
        return anc ? cellNum(anc.r, anc.c + 1) : undefined;
      };

      const data = {
        name: findRightText('角色名') || readMergedText(2, 2),
        raceId: matchRaceId(findRightText('种族') || readMergedText(3, 2)),
        disciplineId: matchDisciplineId(findRightText('门类') || cellStr(4, 2)),
        circle: findRightNum('环数') || cellNum(4, 4),
        gender: findRightText('性别'),
        age: findRightText('年龄'),
        eyeColor: findRightText('瞳色'),
        hairColor: findRightText('发色'),
        skinColor: findRightText('肤色'),
        height: findRightText('身高'),
        weight: findRightText('体重'),
        portraitUrl: '',
        background: '',
        attrs: {},
        talents: [],
        weapons: [],
        spells: [],
        skills: [],
        gear: [],
        threadItems: []
      };

      // === 左栏 (A:G, cols 1..7) ===
      const attrAnchor = findCell('属性', 1, maxR, 1, 7);
      if (attrAnchor) {
        const hr = attrAnchor.r;
        let valCol = attrAnchor.c + 1, adjCol = -1, totalCol = -1;
        for (let c = attrAnchor.c + 1; c <= 7; c++) {
          const h = cellStr(hr, c);
          if (h === '总值') totalCol = c;
          else if (h === '调整') adjCol = c;
          else if (h === '数值') valCol = c;
        }
        for (let r = hr + 1; r <= hr + 6; r++) {
          const label = cellStr(r, attrAnchor.c);
          let v = totalCol > 0 ? cellNum(r, totalCol) : undefined;
          if (v === undefined) {
            const baseV = cellNum(r, valCol);
            if (baseV !== undefined) v = baseV + (adjCol > 0 ? (cellNum(r, adjCol) || 0) : 0);
          }
          if (label && v !== undefined) {
            data.attrs[parseAttrKey(label)] = v;
          }
        }
      }

      const initAnchor = findCell('先攻', 1, maxR, 1, 7);
      if (initAnchor) {
        for (let r = initAnchor.r + 1; r <= initAnchor.r + 4; r++) {
          const lbl = cellStr(r, initAnchor.c);
          if (lbl.includes('调整')) {
            const v = cellNum(r, initAnchor.c + 1);
            if (v !== undefined) data.initAdj = v;
          }
        }
      }
      const karmaAnchor = findCell('业力', 1, maxR, 1, 7);
      if (karmaAnchor) {
        for (let r = karmaAnchor.r + 1; r <= karmaAnchor.r + 3; r++) {
          if (cellStr(r, karmaAnchor.c) === '可用') {
            data.karmaAvail = cellNum(r, karmaAnchor.c + 1);
          }
        }
      }

      const extractExcelActionStrain = (name, rawAction, strainText, category = '') => {
        const parsedAction = normalizeActionType(rawAction);
        const rule = lookupTalentSkillRule(name, category);
        const action = parsedAction || (!rawAction || rawAction === '攻击' ? (rule?.action || '') : '');
        const strainMatch = strainText.match(/\d+/);
        const rawStrain = strainMatch ? Number(strainMatch[0]) : undefined;
        const strain = (rawStrain !== undefined && rawStrain > 0) ? rawStrain : (rule?.strain ?? 0);
        return { action, strain };
      };

      const talAnchor = findCell('天赋', 1, maxR, 1, 7);
      if (talAnchor) {
        let hr = talAnchor.r;
        for (let r = talAnchor.r; r <= talAnchor.r + 2; r++) {
          if (cellStr(r, 1) === '名称' || cellStr(r, 2) === '名称') { hr = r; break; }
        }
        let nameCol = 1, rankCol = 2, attrCol = 3, actionCol = 4, strainCol = 5;
        for (let c = 1; c <= 7; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '等级') rankCol = c;
          else if (h === '属性') attrCol = c;
          else if (h === '动作' || h.includes('动作') || h.toLowerCase().includes('action')) actionCol = c;
          else if (h.includes('负荷') || h.includes('劳累') || h.toLowerCase().includes('strain')) strainCol = c;
        }
        for (let r = hr + 1; r <= maxR; r++) {
          const tName = cellStr(r, nameCol).replace(/\s+/g, ' ').trim();
          if (!tName || tName === '天赋' || tName === '名称' || tName === 'Value') continue;
          if (tName === '属性' || tName === '先攻' || tName === '防御') break;
          const rank = cellNum(r, rankCol);
          if (rank === undefined && !cellStr(r, attrCol)) continue;
          const attr = parseAttrKey(cellStr(r, attrCol));
          const { action, strain } = extractExcelActionStrain(tName, cellStr(r, actionCol), strainCol > 0 ? cellStr(r, strainCol) : '');
          const isAttack = tName.includes('攻击') || tName.includes('武器') || tName.includes('徒手') || tName.toLowerCase().includes('weapon');
          data.talents.push({ id: `t_imp_${r}`, name: tName, attr, rank: rank || 1, action, strain, isAttack });
        }
      }

      // === 中栏 (I:Q, cols 9..17；兼容老测试表 H=8) ===
      const midMinC = findAnchor(['武器', '装备', '当前伤害'], 9, 17) ? 9 : 8;
      const dmgCur = findCell('当前伤害', 1, 30, midMinC, 17);
      if (dmgCur) data.currentDamage = cellNum(dmgCur.r, dmgCur.c + 1);
      const dmgBlood = findCell('血魔法伤害', 1, 30, midMinC, 17);
      if (dmgBlood) data.bloodDamage = cellNum(dmgBlood.r, dmgBlood.c + 1);
      const dmgWound = findCell('负伤', 1, 30, midMinC, 17);
      if (dmgWound) data.wounds = cellNum(dmgWound.r, dmgWound.c + 1);

      const wpnAnchor = findCell('武器', 1, maxR, midMinC, 17);
      const gearAnchor = findCell('装备', wpnAnchor ? wpnAnchor.r + 1 : 1, maxR, midMinC, 17);
      const tiAnchor = findCell('脉路物品', gearAnchor ? gearAnchor.r + 1 : 1, maxR, midMinC, 17);
      const portraitAnchor = findCell('角色图像', tiAnchor ? tiAnchor.r + 1 : 1, maxR, midMinC, 17);
      const lpAnchor = findCell('传说点数', 1, maxR, midMinC, 17);
      const wAnchor = findCell('财富', 1, maxR, midMinC, 17);

      if (wpnAnchor) {
        const hr = wpnAnchor.r;
        let nameCol = wpnAnchor.c + 1, dmgCol = wpnAnchor.c + 2;
        for (let c = wpnAnchor.c; c <= 17; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '基础伤害' || h === '伤害') dmgCol = c;
        }
        const stopR = gearAnchor ? gearAnchor.r - 1 : maxR;
        for (let r = hr + 1; r <= stopR; r++) {
          const leftFlag = cellStr(r, wpnAnchor.c);
          if (leftFlag === '装备' || leftFlag === '脉路物品') break;
          const cnName = cellStr(r, nameCol);
          const enName = (leftFlag && leftFlag !== '武器') ? leftFlag : '';
          const wName = cnName || enName;
          if (!wName) continue;
          const dmgStep = cellNum(r, dmgCol) ?? 4;
          data.weapons.push({ id: `w_imp_${r}`, name: wName, dmgStep });
        }
      }

      if (gearAnchor) {
        const hr = gearAnchor.r;
        let nameCol = gearAnchor.c + 1, rankCol = gearAnchor.c + 2, effCol = gearAnchor.c + 3;
        for (let c = gearAnchor.c; c <= 17; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '等级') rankCol = c;
          else if (h === '效果') effCol = c;
        }
        const stopR = tiAnchor ? tiAnchor.r - 1 : maxR;
        for (let r = hr + 1; r <= stopR; r++) {
          const leftFlag = cellStr(r, gearAnchor.c);
          if (leftFlag === '脉路物品' || leftFlag === '角色图像' || leftFlag === '传说点数') break;
          const cnName = cellStr(r, nameCol);
          const enName = (leftFlag && leftFlag !== '装备') ? leftFlag : '';
          const gName = cnName && enName ? `${cnName} (${enName})` : (cnName || enName);
          if (!gName) continue;
          data.gear.push({ name: gName, rank: cellStr(r, rankCol), effect: cellStr(r, effCol) });
        }
      }

      if (tiAnchor) {
        const hr = tiAnchor.r;
        let nameCol = tiAnchor.c + 1, typeCol = tiAnchor.c + 2, effCol = tiAnchor.c + 3;
        for (let c = tiAnchor.c; c <= 17; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '类型') typeCol = c;
          else if (h === '属性' || h === '效果') effCol = c;
        }
        const stopCandidates = [portraitAnchor?.r, lpAnchor?.r, wAnchor?.r].filter(Boolean);
        const stopR = stopCandidates.length > 0 ? Math.min(...stopCandidates) - 1 : maxR;
        for (let r = hr + 1; r <= stopR; r++) {
          const leftFlag = cellStr(r, tiAnchor.c);
          if (leftFlag === '角色图像' || leftFlag === '传说点数' || leftFlag === '财富') break;
          const cnName = cellStr(r, nameCol);
          const enName = (leftFlag && leftFlag !== '脉路物品') ? leftFlag : '';
          const tiName = cnName && enName ? `${cnName} (${enName})` : (cnName || enName);
          if (!tiName) continue;
          data.threadItems.push({ name: tiName, type: cellStr(r, typeCol), effect: cellStr(r, effCol) });
        }
      }

      if (lpAnchor) {
        const readLp = (lbl) => {
          const c = findCell(lbl, lpAnchor.r, lpAnchor.r + 8, lpAnchor.c, 17);
          return c ? cellStr(c.r, c.c + 1) : '';
        };
        data.legend = {
          total: readLp('总计'),
          current: readLp('现有'),
          status: readLp('传说状态'),
          renown: readLp('名望'),
          reputation: readLp('声誉')
        };
      }
      let wealthOtherRow = wAnchor ? wAnchor.r + 4 : 42;
      if (wAnchor) {
        const readW = (lbl) => {
          const c = findCell(lbl, wAnchor.r, wAnchor.r + 8, wAnchor.c - 1, 17);
          if (lbl === '其他' && c) wealthOtherRow = c.r;
          return c ? (cellStr(c.r, c.c + 1) || 0) : 0;
        };
        data.wealth = {
          copper: readW('铜币'),
          silver: readW('银币'),
          gold: readW('金币'),
          other: readW('其他') || ''
        };
      }

      // 人物背景（1. 显式“背景/人物背景”标签；2. 中栏财富/其他下方长文本；3. I44 合并兜底）
      let bgAnchor = null;
      for (let r = 1; r <= maxR && !bgAnchor; r++) {
        for (let c = 1; c <= maxC; c++) {
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
      if (!data.background && wAnchor) {
        const seen = new Set();
        const belowTexts = [];
        for (let r = wealthOtherRow + 1; r <= maxR; r++) {
          for (let c = 9; c <= 17; c++) {
            const m = findMerge(r, c);
            const key = m ? `${m.s.r}:${m.s.c}` : `${r}:${c}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const txt = readMergedText(r, c);
            if (txt) belowTexts.push(txt);
          }
        }
        if (belowTexts.length > 0) {
          belowTexts.sort((a, b) => b.length - a.length);
          data.background = belowTexts[0];
        }
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

      // === 右栏 (R:Z, cols 18..26；兼容老测试表 P:Q=16..17) ===
      const rightMinC = findAnchor(['法术', '技能'], 18, 27) ? 18 : 16;
      const spAnchor = findCell('法术', 1, maxR, rightMinC, 27);
      const allocAnchor = findCell('8点可分配', spAnchor ? spAnchor.r + 1 : 1, maxR, rightMinC, 27);
      const skAnchor = findCell('技能', 1, maxR, rightMinC, 27);

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
        const stopCandidates = [allocAnchor?.r, skAnchor?.r].filter(Boolean);
        const stopR = stopCandidates.length > 0 ? Math.min(...stopCandidates) - 1 : maxR;
        for (let r = hr + 1; r <= stopR; r++) {
          const flag = cellStr(r, spAnchor.c);
          if (flag === '技能' || flag === '通用技能') break;
          const rawSName = cellStr(r, nameCol);
          const altSName = (flag && flag !== '法术') ? flag : '';
          const sName = ((rawSName && rawSName !== '名称') ? (altSName && !rawSName.includes(altSName) ? `${rawSName} (${altSName})` : rawSName) : altSName).replace(/^[-•·\s]+/, '');
          if (!sName || sName === '名称') continue;
          const dbMatch = findSpellInDb(sName);
          if (dbMatch) {
            data.spells.push({ ...dbMatch, instanceId: `sp_imp_${r}`, wovenThreads: 0, inMatrix: false, matchedDb: true });
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
              inMatrix: false,
              matchedDb: false
            });
          }
        }
      }

      if (skAnchor) {
        const hr = skAnchor.r;
        let catCol = skAnchor.c, nameCol = skAnchor.c + 1, rankCol = skAnchor.c + 2, attrCol = skAnchor.c + 3, actionCol = 24, strainCol = 25;
        for (let c = skAnchor.c; c <= 26; c++) {
          const h = cellStr(hr, c);
          if (h === '名称') nameCol = c;
          else if (h === '等级') rankCol = c;
          else if (h === '属性' || h === '关键属性') attrCol = c;
          else if (h === '动作' || h.includes('动作') || h.toLowerCase().includes('action')) actionCol = c;
          else if (h.includes('负荷') || h.includes('劳累') || h.toLowerCase().includes('strain')) strainCol = c;
        }
        for (let r = hr + 1; r <= maxR; r++) {
          const skName = cellStr(r, nameCol);
          if (!skName || skName === '名称') continue;
          const cat = cellStr(r, catCol) || '通用技能';
          const rank = cellNum(r, rankCol) || 1;
          const attr = parseAttrKey(cellStr(r, attrCol));
          const { action, strain } = extractExcelActionStrain(skName, cellStr(r, actionCol), strainCol > 0 ? cellStr(r, strainCol) : '', cat);
          data.skills.push({
            id: `sk_imp_${r}`,
            category: cat,
            name: skName,
            rank,
            attr,
            action,
            strain,
            isAttack: skName.includes('武器') || skName.includes('攻击')
          });
        }
      }

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

      const rawPortrait = grabField('立绘链接') || grabField('角色图像');
      const safePortrait = /^https?:\/\//i.test(rawPortrait) ? rawPortrait : '';
      const rawCircle = grabField('环数') || grabField('环位') || grabField('环');

      const data = {
        name: grabField('角色名'),
        raceId: matchRaceId(grabField('种族')),
        disciplineId: matchDisciplineId(grabField('门类')),
        circle: Number((rawCircle.match(/\d+/) || [1])[0]),
        gender: grabField('性别'),
        age: grabField('年龄'),
        eyeColor: grabField('瞳色'),
        hairColor: grabField('发色'),
        skinColor: grabField('肤色'),
        height: grabField('身高'),
        weight: grabField('体重'),
        portraitUrl: safePortrait,
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
      let hasExplicitMatrixFlag = false;
      const ALL_SECTIONS = ['属性', '先攻', '业力', '健康等级', '天赋', '武器', '法术', '装备', '传说点数', '财富', '技能', '脉路物品和编织脉路', '脉路物品', '角色印象'];

      const extractTaggedMeta = (line) => {
        const actionM = line.match(/动作\s*[:：]\s*([^|\t]+)/);
        const strainM = line.match(/(?:负荷|劳累)\s*[:：]\s*(\d+)/);
        const effectM = line.match(/效果\s*[:：]\s*([^|\t]+)/);
        const typeM = line.match(/类型\s*[:：]\s*([^|\t]+)/);
        const rankM = line.match(/等级\s*[:：]?\s*(\d+)/);
        const dmgM = line.match(/(?:基础伤害|伤害)\s*[:：]?\s*(\d+)/);
        return {
          rawAction: actionM ? actionM[1].trim() : '',
          hasActionTag: Boolean(actionM),
          rawStrain: strainM ? Number(strainM[1]) : undefined,
          effect: effectM ? effectM[1].trim() : '',
          typeVal: typeM ? typeM[1].trim() : '',
          rankVal: rankM ? Number(rankM[1]) : undefined,
          dmgVal: dmgM ? Number(dmgM[1]) : undefined,
        };
      };

      for (const rawLine of lines) {
        const l = rawLine.trim();
        const bgMatch = l.match(/^(?:【背景故事】|\[背景故事\]|【背景】|\[背景\]|背景故事[：:]|背景[：:])(.*)$/);
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
        const cleanHeader = l.replace(/^【|】$/g, '');
        if (ALL_SECTIONS.includes(l) || ALL_SECTIONS.includes(cleanHeader)) {
          section = cleanHeader === '脉路物品' ? '脉路物品和编织脉路' : cleanHeader;
          continue;
        }
        if (/^【[^】]+】$/.test(l) || /^\[[^\]]+\]$/.test(l)) {
          section = '';
          continue;
        }
        if (['传说点数', '财富', '属性', '先攻', '业力', '健康等级', '角色印象', '背景'].includes(section)) continue;
        if (l.startsWith('名称')) continue;

        const isPipeRow = l.includes('|') || /^[-•·]\s+/.test(l);
        if (isPipeRow && l.includes('|')) {
          const parts = l.replace(/^[-•·]\s*/, '').split('|').map(s => s.trim()).filter(Boolean);
          const meta = extractTaggedMeta(l);
          if (section === '天赋' && parts.length >= 1) {
            const tName = parts[0];
            const rank = meta.rankVal ?? Number((parts[1]?.match(/\d+/) || [1])[0]);
            const attrPart = parts.find(p => /(?:DEX|STR|TOU|PER|WIL|CHA|敏捷|力量|强韧|感知|意志|魅力)/i.test(p)) || parts[2] || 'DEX';
            const attr = parseAttrKey(attrPart);
            const rule = lookupTalentSkillRule(tName);
            const action = meta.hasActionTag ? normalizeActionType(meta.rawAction) : (rule?.action || '');
            const strain = meta.rawStrain !== undefined ? meta.rawStrain : (!meta.hasActionTag && rule?.strain ? rule.strain : 0);
            data.talents.push({ id: `t_txt_${data.talents.length}`, name: tName, attr, rank, action, strain, isAttack: tName.includes('武器') || tName.includes('攻击') });
            continue;
          }
          if (section === '技能' && parts.length >= 2) {
            const hasCat = /技能$/.test(parts[0]) || ['通用', '知识', '工匠', '语言'].includes(parts[0]);
            const cat = hasCat ? (parts[0].endsWith('技能') ? parts[0] : `${parts[0]}技能`) : '通用技能';
            const skName = hasCat ? parts[1] : parts[0];
            const rank = meta.rankVal ?? Number(((hasCat ? parts[2] : parts[1])?.match(/\d+/) || [1])[0]);
            const attrPart = parts.find(p => /^(?:RANK\+)?(?:DEX|STR|TOU|PER|WIL|CHA)$/i.test(p) || ['敏捷', '力量', '强韧', '感知', '意志', '魅力'].includes(p)) || 'PER';
            const attr = parseAttrKey(attrPart);
            const rule = lookupTalentSkillRule(skName, cat);
            const action = meta.hasActionTag ? normalizeActionType(meta.rawAction) : (rule?.action || '');
            const strain = meta.rawStrain !== undefined ? meta.rawStrain : (!meta.hasActionTag && rule?.strain ? rule.strain : 0);
            data.skills.push({ id: `sk_txt_${data.skills.length}`, category: cat, name: skName, rank, attr, action, strain, isAttack: skName.includes('武器') || skName.includes('攻击') });
            continue;
          }
          if (section === '武器' && parts.length >= 1) {
            const dmgStep = meta.dmgVal ?? Number((parts[1]?.match(/\d+/) || [4])[0]);
            data.weapons.push({ id: `w_txt_${data.weapons.length}`, name: parts[0], dmgStep });
            continue;
          }
          if (section === '装备' && parts.length >= 1) {
            const rankPart = parts.find(p => /^等级/.test(p));
            const rawRank = rankPart ? rankPart.replace(/^等级\s*[:：]?\s*/, '') : (meta.effect || parts.some(p => /未穿戴/.test(p)) ? '' : (parts[1] || ''));
            const rank = rawRank === '-' ? '' : rawRank;
            const effect = meta.effect === '-' ? '' : meta.effect;
            const equipped = !parts.some(p => /未穿戴/.test(p));
            data.gear.push({ name: parts[0], rank, effect, equipped });
            continue;
          }
          if (section === '脉路物品和编织脉路' && parts.length >= 1) {
            const typePart = parts.find(p => /^类型/.test(p));
            const rawType = typePart ? typePart.replace(/^类型\s*[:：]?\s*/, '') : (meta.typeVal || '');
            const type = rawType === '-' ? '' : rawType;
            const effect = meta.effect === '-' ? '' : meta.effect;
            const equipped = !parts.some(p => /未启用/.test(p));
            data.threadItems.push({ name: parts[0], type, effect, equipped });
            continue;
          }
          if (section === '法术' && parts.length >= 1) {
            const sName = parts[0];
            const matrixPart = parts.find(p => /已装载|未装载|常备矩阵/.test(p));
            if (matrixPart) hasExplicitMatrixFlag = true;
            const inMatrix = matrixPart ? !/未装载/.test(matrixPart) : undefined;
            const threadM = l.match(/脉路\s*(\d+)(?:\/(\d+))?/);
            const wovenThreads = threadM && threadM[2] !== undefined ? Number(threadM[1]) : 0;
            const totalThreads = threadM ? Number(threadM[2] ?? threadM[1] ?? 0) : 0;
            const dbMatch = findSpellInDb(sName);
            if (dbMatch) {
              data.spells.push({ ...dbMatch, instanceId: `sp_txt_${data.spells.length}`, wovenThreads, inMatrix, matchedDb: true });
            } else {
              const cirM = l.match(/(\d+)\s*环/);
              const wM = l.match(/编织\s*[:：]?\s*(\d+)/);
              const cPart = parts.find(p => /^施法/.test(p)) || '';
              const cVal = cPart.replace(/^施法\s*[:：]?\s*/, '');
              const isFixed = /^\d+$/.test(cVal);
              const dPart = parts.find(p => /^持续/.test(p)) || '';
              const ePart = parts.find(p => /^效果/.test(p)) || '';
              data.spells.push({
                id: `custom_txt_${data.spells.length}`,
                instanceId: `sp_txt_${data.spells.length}`,
                nameCn: sName,
                nameEn: '',
                discipline: data.disciplineId || 'wizard',
                circle: cirM ? Number(cirM[1]) : 1,
                threads: totalThreads,
                weavingBase: wM ? Number(wM[1]) : 5,
                weavingHigh: 10,
                castingType: isFixed ? 'fixed' : 'TMD',
                castingDn: isFixed ? Number(cVal) : null,
                range: '见说明',
                duration: dPart ? dPart.replace(/^持续\s*[:：]?\s*/, '') : '-',
                aoe: '',
                effectFormula: ePart ? ePart.replace(/^效果\s*[:：]?\s*/, '') : 'WIL',
                effectType: 'utility',
                armorType: 'ma',
                desc: ePart ? ePart.replace(/^效果\s*[:：]?\s*/, '') : 'TXT导入法术',
                extraThreads: [],
                extraEffectStepPerThread: 0,
                wovenThreads,
                inMatrix,
                matchedDb: false
              });
            }
            continue;
          }
        }

        const cols = l.replace(/^[-•·]\s*/, '').split(/\s{2,}|\t+/);
        if (section === '天赋' && cols.length >= 3) {
          const tName = cols[0];
          const rank = Number((cols[1].match(/\d+/) || [1])[0]);
          const attr = parseAttrKey(cols[2]);
          const rule = lookupTalentSkillRule(tName);
          const colAction = cols[6] ? normalizeActionType(cols[6]) : '';
          const action = colAction || rule?.action || '';
          const strain = cols[5] ? Number((cols[5].match(/\d+/) || [0])[0]) : (rule?.strain || 0);
          data.talents.push({ id: `t_txt_${data.talents.length}`, name: tName, attr, rank, action, strain, isAttack: tName.includes('武器') || tName.includes('攻击') });
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
          const skName = cols[0];
          const rule = lookupTalentSkillRule(skName, '通用技能');
          const action = cols[3] ? (normalizeActionType(cols[3]) || rule?.action || '') : (rule?.action || '');
          const strain = cols[4] ? Number((cols[4].match(/\d+/) || [0])[0]) : (rule?.strain || 0);
          data.skills.push({ id: `sk_txt_${data.skills.length}`, category: '通用技能', name: skName, rank: Number((cols[1].match(/\d+/) || [1])[0]), attr: parseAttrKey(cols[2]), action, strain, isAttack: skName.includes('武器') || skName.includes('攻击') });
        }
      }

      data.background = bgLines.join('\n').trim();
      data.spells.forEach((sp, idx) => {
        if (sp.inMatrix === undefined) sp.inMatrix = hasExplicitMatrixFlag ? false : idx < 3;
      });
      return data;
    }

    function normalizeImportedCharacter(basePl, data) {
      const pl = JSON.parse(JSON.stringify(basePl));
      if (data.name) pl.name = data.name;
      if (data.raceId) pl.raceId = data.raceId;
      if (data.disciplineId) pl.disciplineId = data.disciplineId;
      if (data.circle && !isNaN(data.circle)) pl.circle = Math.max(1, Math.min(15, Number(data.circle)));
      for (const field of ['gender', 'age', 'eyeColor', 'hairColor', 'skinColor', 'height', 'weight', 'portraitUrl']) {
        if (data[field] !== undefined) pl[field] = String(data[field] || '');
      }
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
      ATTR_NAMES, ATTR_COST, CARRY_TABLE, STEP_BASE, STEP_CYCLE, RACES, DISCIPLINES, SPELLS_DB, SPELL_LOOKUP_MAP, WEAVING_KEYWORDS,
      ACTION_TYPES, TALENT_SKILL_RULES, normalizeActionType, lookupTalentSkillRule,
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
