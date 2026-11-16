# Earthdawn 4E 战术辅助面板 — Google AI Studio (Build Mode) 交接与开发规范

> **给 AI Studio 助手的直接指令（Prompt Header）**：
> 你现在接手的是《地球黎明》第四版（Earthdawn 4E）战术辅助面板与虚拟桌面（VTT）项目。本项目的**全部核心游戏规则、骰池算力、15 门类进阶、81 条结构化法术库及动态 Excel/TXT 角色卡解析器**已完整封装在零 DOM 依赖的 `ed4_engine.js`（以及单文件完整可运行版 `index.html`）中。
> 在进行 UI 视觉重构（如切换为 Vite + React + TypeScript + Tailwind CSS + Lucide 图标）或接入 Supabase 联机时，**严禁删减、简化或重写 `ed4_engine.js` 中的规则计算逻辑**，所有 UI 组件必须直接调用引擎导出的函数。

---

## 一、 核心文件清单与用途

| 文件名 | 角色定位 | 在 AI Studio 中的用法 |
| :--- | :--- | :--- |
| `ed4_engine.js` | **纯业务规则与导入引擎（零 DOM 耦合）** | 若在 AI Studio 使用 React/TS 模板，直接放入 `src/engine/ed4_engine.js` 并 `import ED4Engine from './engine/ed4_engine.js'` |
| `index.html` | **单文件完整可运行基线版（含全部 UI 与交互）** | 若在 AI Studio 直接基于现有单页改 UI 皮肤，上传此文件作为基准即可 |
| `AI_STUDIO_HANDOVER.md` | **AI 上下文与规则约束契约（本文档）** | 粘贴到 AI Studio 的 System Instructions 或首轮 Prompt 中 |

---

## 二、 业务引擎层（`ed4_engine.js`）已覆盖的完整游戏规则清单

### 1. 阶数表（Step 1–40+）与无限爆炸骰引擎
- **属性转阶数**：`attrToStep(val)` → `Math.floor((val + 2) / 3)`。
- **阶数查骰池**：`getStepDice(step)` 严格映射官方 Step 1–40 骰池表（含 `D4-2`、`D4-1` 修正显示），Step 41+ 自动按每 `+11 Step` 叠加 `1D20` 循环扩展。
- **无限爆炸骰与全一规则**：`rollStepTest(step, { karma, karmaDie, dn, isAction })`
  - 任意骰子投出最高面值时自动无限重投累加，并在明细中以 `!→` 记录轨迹（UI 层将单次爆炸标为**亮橙色**，连续两次及以上爆炸标为**亮红色**）。
  - **Step 1–2 保底**：扣除减值后单骰最低为 `1`。
  - **全一规则（Rule of One）**：当 `isAction: true` 且所有基础骰首轮均投出 `1` 时，直接判定为**自动大失败**（即使勾选业力骰也不生效）。
  - **额外成功度**：当检定总值 `total >= dn` 时，每超出难度 `5` 点获得 `+1` 额外成功（`Math.floor((total - dn) / 5)`）。攻击检定的额外成功自动转化为后续伤害检定的 `+2/级` 加值。

### 2. 八大种族、25 点购点与十五门类（1–15 环）进阶
- **种族库（`RACES`）**：矮人、精灵、人类、黑曜石人（天然护甲 +3、死亡上限额外 +10、负伤阈值 +3）、兽人、蜥蜴人（T'skrang）、巨魔、风灵（物理防御 +2、星界视域、飞行）。
- **门类库（`DISCIPLINES`）**：天空劫掠者、弓箭手、兽王、骑手、元素师、幻术师、下界术士、斥候、剑客、盗贼、吟游诗人、战士、武器匠、巫师、净化者。
- **环数永久加值（`getDisciplineBonuses(disciplineId, circle)`）**：
  - 耐久值（Durability）：每环自动累加对应门类的耐久系数（如战士 `7/环`、施法者 `3/环`）。
  - 第 2、6、8 环：物理防御（PD）各 `+1`。
  - 第 4 环：依门类解锁物理防御、秘法防御（MD）或社交防御（SD）`+1`。
  - 第 7 环：依门类解锁先攻（Initiative）`+1`、每日回复检定次数 `+1` 或秘法护甲（MA）`+1`。

### 3. 动作检定 vs. 效果检定严格隔离（Action vs. Effect Isolation）
- **动作检定修正（`getPlActionMod(pl)`）**：
  - 当前负伤（`-wounds`）、防御姿态（`-3`）、击倒/震慑攻击（`-2`）、分散移动（`-2`）、倒地（`-3`）、受扰（`-2`）**仅作用于动作检定**（攻击、施法、编织、天赋、技能）。
  - **猛烈攻击（Aggressive Attack）**：近战攻击与近战伤害各 `+3`（承受 1 点劳累值，物理与秘法防御各 `-3`）。
- **效果/伤害检定**：武器伤害与法术伤害**绝不扣除负伤或防御姿态减值**。
- **负伤平衡检定减值**：角色已有负伤会作为击倒检定（Knockdown Test）的平衡减值（`-wounds`）。

### 4. 装备与脉路物品穿脱动态重算（防双重叠加）
- `parseItemBonuses(text)` 与 `calcEquippedBonuses(gear, threadItems)` 自动从物品描述提取：`物理护甲`、`秘法护甲`、`物理防御`、`秘法防御`、`社交防御`、`先攻` 及六维属性加值。
- **防重复叠加归一化（`normalizeImportedCharacter`）**：首次导入 Excel/TXT 角色卡时，所有导入装备默认标记为 `equipped: true`，同时自动从面板基础防具/属性调整槽中扣除这部分装备加值，确保**刚导入时的面板总值与原卡面 100% 一致**；后续玩家取消勾选（脱下装备）、重新勾选或新增自定义装备时，面板实时安全加减。

### 5. 四大施法门类 1–8 环结构化法术库与法术矩阵
- **结构化法术库（`SPELLS_DB`）**：内置元素师、幻术师、下界术士、巫师 1–8 环共 79 条核心法术（含脉路数、编织难度、施法难度、射程、持续时间、范围 AOE、效果公式与护甲结算类型）。
- **双语与别名匹配（`findSpellInDb(name)`）**：支持中文译名、英文原名、括号混写及常见社区别名（如“星界之矛/星界长矛/星质长矛”“精神飞刺/精神飞镖”“夜之矢/夜之箭矢”）。
- **三阶段施法与矩阵管理**：
  - 法术区分 `inMatrix: true`（常备法术矩阵）与 `inMatrix: false`（法术书），支持直接拖拽卡片互换。
  - **脉路编织前置锁**：需要 `1+` 脉路的法术在 `wovenThreads < threads` 时锁定「施法检定」按钮；脉路编织天赋通过 `WEAVING_KEYWORDS` 精确匹配 15 门类编织天赋。
  - **动态效果骰识别（`hasSpellEffectRoll(sp)`）**：仅含 `WIL` 或 `Circle` 公式的法术渲染「结算效果」按钮（自动检测「意志力 Willforce」天赋并叠加等级与 1 点劳累）；固定 Buff/机制法术直接显示「成功即生效」。
  - **群体法术最高秘防**：当场上有多只存活怪物时，目标选择支持 `aoe:all`，自动取全场存活怪物中的最高秘法防御（`Math.max(...)`）并批量结算伤害。

### 6. 攻防反应、护甲减免、负伤与击倒闭环
- `resolveAvoidBlow`（回避打击，消耗 1 劳累对抗攻击检定结果）与 `resolveRiposte`（反击，消耗 2 劳累对抗攻击检定结果，成功则反击）。
- `resolveDamage`：自动扣除物理护甲（PA）或秘法护甲（MA），当净伤害 `net >= woundThreshold` 时自动记 `1` 处负伤，并计算击倒检定难度 `DN = net - woundThreshold + 5`。

### 7. 动态锚点 Excel (.xlsx) 与 TXT 角色卡双格式解析器
- `parseExcelWorkbook(workbook)`（配合 SheetJS `XLSX`）与 `parseTxtSheet(text)` 采用**表头关键词动态搜索锚点**，即使玩家在装备栏或天赋栏插入了多行也不会错位，并在遇到 `传说点数`、`财富`、`角色图像` 等停止词时精准截断。

---

## 三、 在 AI Studio 中重构 UI 的推荐工作流

1. **直接把 UI 改造留到 AI Studio 最省力**：
   - AI Studio 的 Build 模式内置了完整的 **Vite + React + TypeScript + Tailwind CSS + Lucide Icons** 实时编译环境，并且支持**一键连接并推送到你的 GitHub 仓库**。
2. **操作步骤**：
   - 第一步：在 AI Studio 新建项目，将 `ed4_engine.js` 放入项目（或直接上传 `index.html`），并附上本文档。
   - 第二步：把你喜欢的视觉方向（例如前面生成的“威尼斯大理石金箔”“暗房红灯印相”“中世纪彩釉砖”或“复古复印博物档案”预览 HTML）发给 AI Studio，要求它：**“保持 `ed4_engine.js` 的所有规则计算与导入函数不变，仅用 React + Tailwind 重构视觉界面与可拖拽分栏布局。”**
   - 第三步：在 AI Studio 预览确认无误后，点击右上角 GitHub 图标一键同步到你的 GitHub 仓库，随后在 **Cloudflare Pages** 中绑定该 GitHub 仓库即可实现全自动部署。
