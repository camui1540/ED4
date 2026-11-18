import React from 'react';
import ED4Engine from '../engine/ed4_engine.js';
import { getEffectiveActionMod, getPlDerivedView } from '../engine/combatHelpers';

export type PdfPrintMode = 'bw' | 'theme';

interface PrintSheetViewProps {
  pl: any;
  printMode?: PdfPrintMode;
}

const OPTION_LABELS: Record<string, string> = {
  aggressive: '猛烈攻击 (+3攻伤/-3防)',
  defensive: '防御姿态 (+3防/-3检定)',
  knockdown: '击倒攻击',
  stun: '震慑攻击',
  splitMove: '分散移动',
  tailAttack: '尾击 (-2检定)',
};

const STATUS_LABELS: Record<string, string> = {
  knockedDown: '倒地 (-3防/-3检定)',
  blindsided: '盲区 (-3物防/无盾)',
  surprised: '惊愕 (无法行动)',
  harried: '受扰 (-2防/-2检定)',
  reserved: '预留动作',
};

const PRINT_PALETTE = {
  bw: {
    page: 'bg-white text-neutral-900',
    headerBorder: 'border-neutral-900',
    sectionBorder: 'border-neutral-800',
    subLine: 'border-neutral-400',
    card: 'border-neutral-800 bg-white text-neutral-900',
    subCard: 'border-neutral-400 bg-white text-neutral-900',
    rowDivide: 'divide-neutral-300',
    rowBorder: 'border-neutral-200',
    title: 'text-neutral-950',
    heading: 'text-neutral-900',
    body: 'text-neutral-800',
    muted: 'text-neutral-700',
    subtle: 'text-neutral-600',
    badge: 'border-neutral-400 text-neutral-900',
  },
  theme: {
    page: 'bg-background text-foreground',
    headerBorder: 'border-primary',
    sectionBorder: 'border-primary',
    subLine: 'border-border',
    card: 'border-border bg-card text-card-foreground',
    subCard: 'border-border bg-muted/60 text-card-foreground',
    rowDivide: 'divide-border',
    rowBorder: 'border-border',
    title: 'text-foreground',
    heading: 'text-primary',
    body: 'text-card-foreground',
    muted: 'text-muted-foreground',
    subtle: 'text-muted-foreground',
    badge: 'border-primary/50 bg-secondary text-secondary-foreground',
  },
};

export function PrintSheetView({ pl, printMode = 'bw' }: PrintSheetViewProps) {
  const c = PRINT_PALETTE[printMode];
  const d = getPlDerivedView(pl);
  const actionMod = getEffectiveActionMod(pl);
  const prog = d.prog;

  const initEffStep = Math.max(1, d.initStep + actionMod);
  const initDice = ED4Engine.getStepDice(initEffStep).label;
  const recStep = Math.max(1, d.steps.TOU - (Number(pl.wounds) || 0));
  const recDice = ED4Engine.getStepDice(recStep).label;

  const activeOptions = Object.entries(OPTION_LABELS)
    .filter(([k]) => !!pl.options?.[k])
    .map(([, label]) => label);
  const activeStatuses = Object.entries(STATUS_LABELS)
    .filter(([k]) => !!pl.statuses?.[k])
    .map(([, label]) => label);

  const matrixSpells = (pl.spells || []).filter((sp: any) => sp.inMatrix !== false);
  const grimoireSpells = (pl.spells || []).filter((sp: any) => sp.inMatrix === false);
  const scInfo = ED4Engine.getSpellcastingStep(pl, d);
  const twInfo = ED4Engine.getThreadWeavingStep(pl, d);

  const bonusTags = [
    `耐久 +${d.durabilityTotal}`,
    prog.pd ? `门类物防 +${prog.pd}` : '',
    prog.md ? `门类秘防 +${prog.md}` : '',
    prog.sd ? `门类社防 +${prog.sd}` : '',
    prog.init ? `门类先攻 +${prog.init}` : '',
    prog.rec ? `门类回复 +${prog.rec}` : '',
    prog.ma ? `门类秘甲 +${prog.ma}` : '',
  ].filter(Boolean);

  return (
    <div className={`print-sheet hidden print:block ${c.page}`}>
      {/* A4 第一页：角色抬头 + 档案/立绘/外观 + 核心属性/衍生数值 + 健康/护甲 + 人物背景 */}
      <div className="print-page-one break-after-page">
        <header className={`break-inside-avoid mb-2.5 border-b-2 pb-2 ${c.headerBorder}`}>
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <h1 className={`font-display text-2xl font-bold tracking-tight ${c.title}`}>
                {pl.name || '未命名角色'}
              </h1>
              <span className={`font-display text-sm font-semibold ${c.body}`}>
                {d.race.name} · {prog.disc.name}
              </span>
              <span className={`font-serif rounded border px-1.5 py-0.5 text-[11px] font-semibold ${c.badge}`}>
                {pl.circle}环
              </span>
            </div>
            <div className={`font-mono text-xs font-semibold ${c.muted}`}>
              Earthdawn 4E 角色档案 · 业力骰 D{pl.karmaDie || 6}
            </div>
          </div>
          <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${c.muted}`}>
            <span>移速 <b className="font-mono">{d.moveDisplay ?? d.race.move}</b> 码</span>
            <span>负重 <b className="font-mono">{d.carry}</b> 磅</span>
            <span>种族特性：{d.race.traits}</span>
            {bonusTags.map((b) => (
              <span key={b} className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${c.badge}`}>
                {b}
              </span>
            ))}
          </div>
        </header>

        {/* 角色档案、立绘与外貌特征 */}
        <section className={`break-inside-avoid mb-2.5 flex gap-3 rounded border p-2 ${c.card}`}>
          <div className={`flex h-28 w-21 shrink-0 items-center justify-center overflow-hidden rounded border ${c.subCard}`}>
            {pl.portraitUrl ? (
              <img src={pl.portraitUrl} alt={pl.name || '角色立绘'} className="h-full w-full object-cover" />
            ) : (
              <span className={`text-[10px] ${c.subtle}`}>角色图像</span>
            )}
          </div>
          <div className="flex flex-1 flex-col justify-between">
            <div className={`mb-1 border-b pb-0.5 font-serif text-xs font-bold ${c.rowBorder} ${c.heading}`}>
              个人档案与外貌特征
            </div>
            <div className={`grid grid-cols-4 gap-x-3 gap-y-1.5 text-[11px] ${c.body}`}>
              <div>性别：<b className={c.title}>{pl.gender || '-'}</b></div>
              <div>年龄：<b className={`font-mono ${c.title}`}>{pl.age || '-'}</b></div>
              <div>身高：<b className={`font-mono ${c.title}`}>{pl.height || '-'}</b></div>
              <div>体重：<b className={`font-mono ${c.title}`}>{pl.weight || '-'}</b></div>
              <div>瞳色：<b className={c.title}>{pl.eyeColor || '-'}</b></div>
              <div>发色：<b className={c.title}>{pl.hairColor || '-'}</b></div>
              <div className="col-span-2">肤色：<b className={c.title}>{pl.skinColor || '-'}</b></div>
            </div>
            <div className={`mt-1 border-t pt-1 text-[10px] ${c.rowBorder} ${c.muted}`}>
              传说总计 <b className="font-mono">{pl.legend?.total || 0}</b> · 现有 <b className="font-mono">{pl.legend?.current || 0}</b> · 名望：<b>{pl.legend?.renown || '-'}</b> · 财富：金币 <b className="font-mono">{pl.wealth?.gold ?? 0}</b> / 银币 <b className="font-mono">{pl.wealth?.silver ?? 0}</b> / 铜币 <b className="font-mono">{pl.wealth?.copper ?? 0}</b>
            </div>
          </div>
        </section>

        {/* 六维属性 + 衍生防御 */}
        <section className="break-inside-avoid mb-2.5">
          <h2 className={`font-serif mb-1 border-b pb-0.5 text-xs font-bold uppercase tracking-wider ${c.subLine} ${c.heading}`}>
            核心属性与衍生战斗数值
          </h2>
          <div className="mb-1.5 grid grid-cols-6 gap-1.5">
            {Object.entries(ED4Engine.ATTR_NAMES).map(([k, label]) => {
              const stp = d.steps[k];
              const dice = ED4Engine.getStepDice(stp).label;
              return (
                <div key={k} className={`break-inside-avoid rounded border p-1 text-center ${c.card}`}>
                  <div className={`text-[11px] font-semibold ${c.body}`}>{label}</div>
                  <div className={`font-mono text-lg font-bold leading-tight ${c.title}`}>{d.attrs[k]}</div>
                  <div className={`font-mono text-[10px] font-bold ${c.heading}`}>Step {stp}</div>
                  <div className={`font-mono text-[9px] ${c.subtle}`}>{dice}</div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-6 gap-1.5">
            <div className={`break-inside-avoid rounded border p-1 text-center ${c.card}`}>
              <div className={`text-[11px] font-semibold ${c.body}`}>先攻</div>
              <div className={`font-mono text-base font-bold ${c.title}`}>Step {initEffStep}</div>
              <div className={`font-mono text-[9px] ${c.subtle}`}>{initDice}</div>
            </div>
            {[
              ['物理防御', d.pd],
              ['秘法防御', d.md],
              ['社交防御', d.sd],
              ['物理护甲', d.pa],
              ['秘法护甲', d.ma],
            ].map(([label, val]) => (
              <div key={String(label)} className={`break-inside-avoid flex flex-col justify-center rounded border p-1 text-center ${c.card}`}>
                <div className={`text-[11px] font-semibold ${c.body}`}>{label}</div>
                <div className={`font-mono text-lg font-bold leading-tight ${c.title}`}>{val}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 健康轨、资源与当前实时状态 */}
        <section className="break-inside-avoid mb-2.5 grid grid-cols-2 gap-2.5">
          <div className={`rounded border p-2 ${c.card}`}>
            <div className={`mb-1 flex items-center justify-between border-b pb-1 ${c.rowBorder}`}>
              <span className={`font-serif text-xs font-bold ${c.heading}`}>实时健康轨与资源</span>
              <span className={`font-mono text-[11px] ${c.muted}`}>
                动作修正 {actionMod >= 0 ? `+${actionMod}` : actionMod} Step
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
              <div className={`rounded border p-1 ${c.subCard}`}>
                <div className={c.muted}>当前伤害</div>
                <div className={`font-mono text-base font-bold ${c.title}`}>{pl.currentDamage}</div>
              </div>
              <div className={`rounded border p-1 ${c.subCard}`}>
                <div className={c.muted}>血魔法伤害</div>
                <div className={`font-mono text-base font-bold ${c.title}`}>{pl.bloodDamage}</div>
              </div>
              <div className={`rounded border p-1 ${c.subCard}`}>
                <div className={c.muted}>负伤</div>
                <div className={`font-mono text-base font-bold ${c.title}`}>{pl.wounds}</div>
              </div>
            </div>
            <div className={`mt-1 grid grid-cols-3 gap-1 text-[10px] ${c.body}`}>
              <div>意识丧失：<b className="font-mono">{d.effUncon}</b></div>
              <div>死亡：<b className="font-mono">{d.effDeath}</b></div>
              <div>负伤阈值：<b className="font-mono">{d.woundThreshold}</b></div>
              <div>可用业力：<b className="font-mono">{pl.karmaCurrent}/{d.karmaMax}</b> (D{pl.karmaDie})</div>
              <div className="col-span-2">
                回复：<b className="font-mono">{pl.recoveryCurrent}/{d.recoveryMax}</b> · Step <b className="font-mono">{recStep}</b> ({recDice})
              </div>
            </div>
          </div>

          <div className={`rounded border p-2 ${c.card}`}>
            <div className={`mb-1 border-b pb-1 font-serif text-xs font-bold ${c.rowBorder} ${c.heading}`}>
              防具盾牌与当前激活状态
            </div>
            <div className={`space-y-1 text-[10px] ${c.body}`}>
              <div>
                <b>护甲面板</b>：{pl.armor?.name || '基础护甲'}（物甲 <b className="font-mono">{pl.armor?.pa || 0}</b> · 秘甲 <b className="font-mono">{pl.armor?.ma || 0}</b> · 先攻减值 <b className="font-mono">{pl.armor?.initPen || 0}</b>）
              </div>
              <div>
                <b>盾牌面板</b>：{pl.shield?.name || '盾牌'}（物防 <b className="font-mono">+{pl.shield?.pd || 0}</b> · 秘防 <b className="font-mono">+{pl.shield?.md || 0}</b> · 额外先攻修正 <b className="font-mono">{pl.initBonus || 0}</b>）
              </div>
              <div>
                <b>当前战斗选项</b>：
                {activeOptions.length > 0 ? activeOptions.join('、') : '常规姿态'}
              </div>
              <div>
                <b>当前异常状态</b>：
                {activeStatuses.length > 0 ? activeStatuses.join('、') : '正常'}
              </div>
            </div>
          </div>
        </section>

        {/* 人物背景（固定排在 A4 第一页末尾） */}
        <section className={`rounded border p-2 ${c.card}`}>
          <h2 className={`font-serif break-inside-avoid mb-1 border-b pb-0.5 text-xs font-bold ${c.subLine} ${c.heading}`}>
            人物背景
          </h2>
          <div className={`font-pixel whitespace-pre-wrap break-words text-[10px] leading-relaxed ${pl.background?.trim() ? c.title : c.subtle}`}>
            {pl.background?.trim() ? pl.background : '暂无人物背景记录'}
          </div>
        </section>
      </div>

      {/* 天赋与技能（表行防分页腰斩） */}
      <section className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <h2 className={`font-serif mb-1 border-b pb-0.5 text-xs font-bold ${c.sectionBorder} ${c.heading}`}>
            门类天赋 ({(pl.talents || []).length})
          </h2>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className={`border-b text-left ${c.subLine} ${c.muted}`}>
                <th className="py-1 font-semibold">名称</th>
                <th className="py-1 font-semibold">属性</th>
                <th className="py-1 font-semibold">等级</th>
                <th className="py-1 font-semibold">Step</th>
                <th className="py-1 text-right font-semibold">骰池/负荷</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${c.rowDivide}`}>
              {(pl.talents || []).map((t: any) => {
                const effStep = Math.max(1, d.steps[t.attr] + t.rank + actionMod + (t.isAttack && pl.options?.aggressive ? 3 : 0));
                const dice = ED4Engine.getStepDice(effStep).label;
                return (
                  <tr key={t.id} className="break-inside-avoid">
                    <td className={`py-1 pr-1 font-medium ${c.title}`}>{t.name}</td>
                    <td className={`py-1 pr-1 ${c.muted}`}>{ED4Engine.ATTR_NAMES[t.attr]}</td>
                    <td className="py-1 pr-1 font-mono">{t.rank}</td>
                    <td className={`py-1 pr-1 font-mono font-bold ${c.title}`}>Step {effStep}</td>
                    <td className={`py-1 text-right font-mono ${c.muted}`}>
                      {dice}{t.strain ? ` · 负荷${t.strain}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className={`font-serif mb-1 border-b pb-0.5 text-xs font-bold ${c.sectionBorder} ${c.heading}`}>
            角色技能 ({(pl.skills || []).length}) & 武器 ({(pl.weapons || []).length})
          </h2>
          <table className="mb-2 w-full border-collapse text-[11px]">
            <thead>
              <tr className={`border-b text-left ${c.subLine} ${c.muted}`}>
                <th className="py-1 font-semibold">技能</th>
                <th className="py-1 font-semibold">属性</th>
                <th className="py-1 font-semibold">等级</th>
                <th className="py-1 font-semibold">Step</th>
                <th className="py-1 text-right font-semibold">骰池</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${c.rowDivide}`}>
              {(pl.skills || []).map((sk: any) => {
                const effStep = Math.max(1, d.steps[sk.attr] + sk.rank + actionMod + (sk.isAttack && pl.options?.aggressive ? 3 : 0));
                const dice = ED4Engine.getStepDice(effStep).label;
                return (
                  <tr key={sk.id} className="break-inside-avoid">
                    <td className={`py-1 pr-1 font-medium ${c.title}`}>
                      {sk.category ? `[${sk.category.replace('技能', '')}] ` : ''}{sk.name}
                    </td>
                    <td className={`py-1 pr-1 ${c.muted}`}>{ED4Engine.ATTR_NAMES[sk.attr]}</td>
                    <td className="py-1 pr-1 font-mono">{sk.rank}</td>
                    <td className={`py-1 pr-1 font-mono font-bold ${c.title}`}>Step {effStep}</td>
                    <td className={`py-1 text-right font-mono ${c.muted}`}>{dice}</td>
                  </tr>
                );
              })}
              {(pl.skills || []).length === 0 && (
                <tr>
                  <td colSpan={5} className={`py-1.5 text-center ${c.subtle}`}>暂无技能</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className={`break-inside-avoid border-t pt-1.5 ${c.subLine}`}>
            <div className={`font-serif mb-1 text-[11px] font-bold ${c.heading}`}>武器伤害</div>
            <div className="space-y-1 text-[11px]">
              {(pl.weapons || []).map((w: any) => {
                const dmgStep = Math.max(1, d.steps.STR + (Number(w.dmgStep) || 0) + (pl.options?.aggressive ? 3 : 0));
                const dmgDice = ED4Engine.getStepDice(dmgStep).label;
                return (
                  <div key={w.id} className={`break-inside-avoid flex items-center justify-between rounded border px-2 py-0.5 ${c.subCard}`}>
                    <span className={`font-semibold ${c.title}`}>{w.name}</span>
                    <span className={`font-mono ${c.body}`}>
                      基础 +{w.dmgStep} · 伤害 <b>Step {dmgStep}</b> ({dmgDice})
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 法术矩阵与法术书 */}
      {(pl.spells || []).length > 0 && (
        <section className="mb-3">
          <div className={`mb-1.5 flex items-center justify-between border-b pb-0.5 ${c.sectionBorder}`}>
            <h2 className={`font-serif text-xs font-bold ${c.heading}`}>
              法术矩阵与法术书（常备 {matrixSpells.length} / 法术书 {grimoireSpells.length}）
            </h2>
            <span className={`font-mono text-[11px] ${c.muted}`}>
              脉路编织 Step {twInfo.step} · 施法 Step {scInfo.step}
            </span>
          </div>

          {matrixSpells.length > 0 && (
            <div className="mb-2">
              <div className={`mb-1 text-[11px] font-bold ${c.heading}`}>★ 当前常备法术矩阵</div>
              <div className="grid grid-cols-2 gap-1.5">
                {matrixSpells.map((sp: any) => (
                  <div key={sp.instanceId} className={`break-inside-avoid rounded border p-1.5 text-[11px] ${c.card}`}>
                    <div className="flex items-center justify-between gap-1">
                      <b className={`font-serif ${c.title}`}>{sp.nameCn}</b>
                      <span className={`font-mono font-bold ${c.heading}`}>
                        <span className="font-serif">{sp.circle}环</span> · 已编织脉路 {sp.wovenThreads || 0}/{sp.threads || 0}
                      </span>
                    </div>
                    <div className={`mt-0.5 font-mono text-[10px] ${c.muted}`}>
                      编织 {sp.weavingBase}/{sp.weavingHigh} · 施法 {sp.castingType === 'fixed' ? sp.castingDn : sp.aoe ? '群体TMD' : 'TMD'} · 效果 {sp.effectFormula}
                    </div>
                    <div className={`mt-0.5 font-pixel text-[10px] ${c.subtle}`}>
                      {sp.range} · {sp.duration}{sp.aoe ? ` · ${sp.aoe}` : ''} — {sp.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {grimoireSpells.length > 0 && (
            <div>
              <div className={`mb-1 text-[11px] font-semibold ${c.muted}`}>法术书储备</div>
              <div className="grid grid-cols-2 gap-1.5">
                {grimoireSpells.map((sp: any) => (
                  <div key={sp.instanceId} className={`break-inside-avoid rounded border p-1.5 text-[10px] ${c.subCard}`}>
                    <div className="flex items-center justify-between">
                      <b className={`font-serif ${c.title}`}>{sp.nameCn}</b>
                      <span className="font-mono">
                        <span className="font-serif">{sp.circle}环</span> · {sp.threads || 0}脉路 · 编织{sp.weavingBase}
                      </span>
                    </div>
                    <div className={`font-pixel ${c.subtle}`}>{sp.effectFormula} · {sp.range} · {sp.duration}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 装备、脉路物品与传说财富 */}
      <section className="grid grid-cols-2 gap-3">
        <div className="break-inside-avoid">
          <h2 className={`font-serif mb-1 border-b pb-0.5 text-xs font-bold ${c.sectionBorder} ${c.heading}`}>
            普通装备与防具 ({(pl.gear || []).length})
          </h2>
          {(pl.gear || []).length === 0 ? (
            <div className={`text-[11px] ${c.subtle}`}>暂无额外记录装备</div>
          ) : (
            <ul className="space-y-0.5 text-[11px]">
              {pl.gear.map((g: any, i: number) => (
                <li key={i} className={`break-inside-avoid flex items-baseline justify-between gap-2 border-b py-0.5 ${c.rowBorder}`}>
                  <span>
                    <span className={`font-serif text-[10px] ${c.subtle}`}>[{g.equipped !== false ? '激活' : '未穿'}]</span>{' '}
                    <b className={c.title}>{g.name}</b>
                    {g.rank && g.rank !== '-' ? ` (${g.rank})` : ''}
                  </span>
                  <span className={c.muted}>{g.effect || '-'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="break-inside-avoid">
          <h2 className={`font-serif mb-1 border-b pb-0.5 text-xs font-bold ${c.sectionBorder} ${c.heading}`}>
            脉路物品 ({(pl.threadItems || []).length}) 与传说财富
          </h2>
          {(pl.threadItems || []).length > 0 && (
            <ul className="mb-1.5 space-y-0.5 text-[11px]">
              {pl.threadItems.map((ti: any, i: number) => (
                <li key={i} className={`break-inside-avoid flex items-baseline justify-between gap-2 border-b py-0.5 ${c.rowBorder}`}>
                  <span>
                    <span className={`font-serif text-[10px] ${c.subtle}`}>[{ti.equipped !== false ? '激活' : '未启'}]</span>{' '}
                    <b className={c.title}>{ti.name}</b>
                    {ti.type && ti.type !== '-' ? ` (${ti.type})` : ''}
                  </span>
                  <span className={c.muted}>{ti.effect || '-'}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={`rounded border p-1.5 text-[11px] ${c.subCard}`}>
            <div>
              传说总计 <b className="font-mono">{pl.legend?.total || 0}</b> · 现有 <b className="font-mono">{pl.legend?.current || 0}</b> · 名望/声誉：<b>{pl.legend?.renown || '-'}</b>
            </div>
            <div className="mt-0.5 font-mono">
              金币 {pl.wealth?.gold ?? 0} · 银币 {pl.wealth?.silver ?? 0} · 铜币 {pl.wealth?.copper ?? 0}
              {pl.wealth?.other ? ` · ${pl.wealth.other}` : ''}
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
