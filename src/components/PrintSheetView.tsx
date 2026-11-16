import React from 'react';
import ED4Engine from '../engine/ed4_engine.js';
import { getEffectiveActionMod, getPlDerivedView } from '../engine/combatHelpers';

interface PrintSheetViewProps {
  pl: any;
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

export function PrintSheetView({ pl }: PrintSheetViewProps) {
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
    <div className="print-sheet hidden print:block bg-white px-1 text-neutral-900">
      {/* 顶部角色档案抬头 */}
      <header className="break-inside-avoid mb-3 border-b-2 border-neutral-900 pb-2">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="font-noto-serif text-2xl font-bold tracking-tight text-neutral-950">
              {pl.name || '未命名角色'}
            </h1>
            <span className="font-noto-serif text-sm font-semibold text-neutral-800">
              {d.race.name} · {prog.disc.name} · 第 <span className="font-mono font-bold">{pl.circle}</span> 环
            </span>
          </div>
          <div className="font-mono text-xs font-semibold text-neutral-700">
            Earthdawn 4E 角色档案 · 业力骰 D{pl.karmaDie || 6}
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-700">
          <span>移速 <b className="font-mono">{d.race.move}</b> 码</span>
          <span>负重 <b className="font-mono">{d.carry}</b> 磅</span>
          <span>种族特性：{d.race.traits}</span>
          {bonusTags.map((b) => (
            <span key={b} className="rounded border border-neutral-400 px-1.5 py-0.5 text-[10px] font-medium text-neutral-900">
              {b}
            </span>
          ))}
        </div>
      </header>

      {/* 六维属性 + 衍生防御 */}
      <section className="break-inside-avoid mb-3">
        <h2 className="font-noto-serif mb-1.5 border-b border-neutral-400 pb-0.5 text-xs font-bold uppercase tracking-wider text-neutral-900">
          核心属性与衍生战斗数值
        </h2>
        <div className="mb-2 grid grid-cols-6 gap-1.5">
          {Object.entries(ED4Engine.ATTR_NAMES).map(([k, label]) => {
            const stp = d.steps[k];
            const dice = ED4Engine.getStepDice(stp).label;
            return (
              <div key={k} className="break-inside-avoid rounded border border-neutral-800 p-1.5 text-center">
                <div className="font-noto-serif text-[11px] font-semibold text-neutral-800">{label}</div>
                <div className="font-mono text-xl font-bold leading-tight text-neutral-950">{d.attrs[k]}</div>
                <div className="font-mono text-[11px] font-bold text-neutral-900">Step {stp}</div>
                <div className="font-mono text-[10px] text-neutral-600">{dice}</div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-6 gap-1.5">
          <div className="break-inside-avoid rounded border border-neutral-800 p-1.5 text-center">
            <div className="font-noto-serif text-[11px] font-semibold text-neutral-800">先攻</div>
            <div className="font-mono text-base font-bold text-neutral-950">Step {initEffStep}</div>
            <div className="font-mono text-[10px] text-neutral-600">{initDice}</div>
          </div>
          {[
            ['物理防御', d.pd],
            ['秘法防御', d.md],
            ['社交防御', d.sd],
            ['物理护甲', d.pa],
            ['秘法护甲', d.ma],
          ].map(([label, val]) => (
            <div key={String(label)} className="break-inside-avoid flex flex-col justify-center rounded border border-neutral-800 p-1.5 text-center">
              <div className="font-noto-serif text-[11px] font-semibold text-neutral-800">{label}</div>
              <div className="font-mono text-xl font-bold leading-tight text-neutral-950">{val}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 健康轨、资源与当前实时状态 */}
      <section className="break-inside-avoid mb-3 grid grid-cols-2 gap-3">
        <div className="rounded border border-neutral-800 p-2">
          <div className="mb-1.5 flex items-center justify-between border-b border-neutral-300 pb-1">
            <span className="font-noto-serif text-xs font-bold text-neutral-900">实时健康轨与资源</span>
            <span className="font-mono text-[11px] text-neutral-700">
              动作修正 {actionMod >= 0 ? `+${actionMod}` : actionMod} Step
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
            <div className="rounded border border-neutral-400 p-1">
              <div className="font-noto-serif text-neutral-700">当前伤害</div>
              <div className="font-mono text-base font-bold text-neutral-950">{pl.currentDamage}</div>
            </div>
            <div className="rounded border border-neutral-400 p-1">
              <div className="font-noto-serif text-neutral-700">血魔法伤害</div>
              <div className="font-mono text-base font-bold text-neutral-950">{pl.bloodDamage}</div>
            </div>
            <div className="rounded border border-neutral-400 p-1">
              <div className="font-noto-serif text-neutral-700">负伤</div>
              <div className="font-mono text-base font-bold text-neutral-950">{pl.wounds}</div>
            </div>
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px] text-neutral-800">
            <div>意识丧失：<b className="font-mono">{d.effUncon}</b></div>
            <div>死亡：<b className="font-mono">{d.effDeath}</b></div>
            <div>负伤阈值：<b className="font-mono">{d.woundThreshold}</b></div>
            <div>可用业力：<b className="font-mono">{pl.karmaCurrent}/{d.karmaMax}</b> (D{pl.karmaDie})</div>
            <div className="col-span-2">
              回复次数：<b className="font-mono">{pl.recoveryCurrent}/{d.recoveryMax}</b> · 回复 Step <b className="font-mono">{recStep}</b> ({recDice})
            </div>
          </div>
        </div>

        <div className="rounded border border-neutral-800 p-2">
          <div className="mb-1.5 border-b border-neutral-300 pb-1 font-noto-serif text-xs font-bold text-neutral-900">
            防具盾牌与当前激活状态
          </div>
          <div className="space-y-1 text-[11px] text-neutral-800">
            <div>
              <b>护甲面板</b>：{pl.armor?.name || '基础护甲'}（物甲 <b className="font-mono">{pl.armor?.pa || 0}</b> · 秘甲 <b className="font-mono">{pl.armor?.ma || 0}</b> · 先攻减值 <b className="font-mono">{pl.armor?.initPen || 0}</b>）
            </div>
            <div>
              <b>盾牌面板</b>：{pl.shield?.name || '盾牌'}（物防 <b className="font-mono">+{pl.shield?.pd || 0}</b> · 秘防 <b className="font-mono">+{pl.shield?.md || 0}</b> · 额外先攻修正 <b className="font-mono">{pl.initBonus || 0}</b>）
            </div>
            <div>
              <b>当前战斗选项</b>：
              {activeOptions.length > 0 ? activeOptions.join('、') : '常规姿态（无特殊战斗选项）'}
            </div>
            <div>
              <b>当前异常状态</b>：
              {activeStatuses.length > 0 ? activeStatuses.join('、') : '正常（无异常状态）'}
            </div>
          </div>
        </div>
      </section>

      {/* 天赋与技能（表行防分页腰斩） */}
      <section className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <h2 className="font-noto-serif mb-1 border-b border-neutral-800 pb-0.5 text-xs font-bold text-neutral-900">
            门类天赋 ({(pl.talents || []).length})
          </h2>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-neutral-400 text-left text-neutral-700">
                <th className="py-1 font-semibold">名称</th>
                <th className="py-1 font-semibold">属性</th>
                <th className="py-1 font-semibold">等级</th>
                <th className="py-1 font-semibold">Step</th>
                <th className="py-1 text-right font-semibold">骰池/劳累</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-300">
              {(pl.talents || []).map((t: any) => {
                const effStep = Math.max(1, d.steps[t.attr] + t.rank + actionMod + (t.isAttack && pl.options?.aggressive ? 3 : 0));
                const dice = ED4Engine.getStepDice(effStep).label;
                return (
                  <tr key={t.id} className="break-inside-avoid">
                    <td className="py-1 pr-1 font-medium text-neutral-950">{t.name}</td>
                    <td className="py-1 pr-1 text-neutral-700">{ED4Engine.ATTR_NAMES[t.attr]}</td>
                    <td className="py-1 pr-1 font-mono">{t.rank}</td>
                    <td className="py-1 pr-1 font-mono font-bold text-neutral-950">Step {effStep}</td>
                    <td className="py-1 text-right font-mono text-neutral-700">
                      {dice}{t.strain ? ` · 劳累${t.strain}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className="font-noto-serif mb-1 border-b border-neutral-800 pb-0.5 text-xs font-bold text-neutral-900">
            角色技能 ({(pl.skills || []).length}) & 武器 ({(pl.weapons || []).length})
          </h2>
          <table className="mb-2 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-neutral-400 text-left text-neutral-700">
                <th className="py-1 font-semibold">技能</th>
                <th className="py-1 font-semibold">属性</th>
                <th className="py-1 font-semibold">等级</th>
                <th className="py-1 font-semibold">Step</th>
                <th className="py-1 text-right font-semibold">骰池</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-300">
              {(pl.skills || []).map((sk: any) => {
                const effStep = Math.max(1, d.steps[sk.attr] + sk.rank + actionMod + (sk.isAttack && pl.options?.aggressive ? 3 : 0));
                const dice = ED4Engine.getStepDice(effStep).label;
                return (
                  <tr key={sk.id} className="break-inside-avoid">
                    <td className="py-1 pr-1 font-medium text-neutral-950">
                      {sk.category ? `[${sk.category.replace('技能', '')}] ` : ''}{sk.name}
                    </td>
                    <td className="py-1 pr-1 text-neutral-700">{ED4Engine.ATTR_NAMES[sk.attr]}</td>
                    <td className="py-1 pr-1 font-mono">{sk.rank}</td>
                    <td className="py-1 pr-1 font-mono font-bold text-neutral-950">Step {effStep}</td>
                    <td className="py-1 text-right font-mono text-neutral-700">{dice}</td>
                  </tr>
                );
              })}
              {(pl.skills || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-1.5 text-center text-neutral-500">暂无技能</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="break-inside-avoid border-t border-neutral-400 pt-1.5">
            <div className="font-noto-serif mb-1 text-[11px] font-bold text-neutral-900">武器伤害</div>
            <div className="space-y-1 text-[11px]">
              {(pl.weapons || []).map((w: any) => {
                const dmgStep = Math.max(1, d.steps.STR + (Number(w.dmgStep) || 0) + (pl.options?.aggressive ? 3 : 0));
                const dmgDice = ED4Engine.getStepDice(dmgStep).label;
                return (
                  <div key={w.id} className="break-inside-avoid flex items-center justify-between rounded border border-neutral-400 px-2 py-0.5">
                    <span className="font-semibold text-neutral-950">{w.name}</span>
                    <span className="font-mono text-neutral-800">
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
          <div className="mb-1.5 flex items-center justify-between border-b border-neutral-800 pb-0.5">
            <h2 className="font-noto-serif text-xs font-bold text-neutral-900">
              法术矩阵与法术书（常备 {matrixSpells.length} / 法术书 {grimoireSpells.length}）
            </h2>
            <span className="font-mono text-[11px] text-neutral-700">
              脉路编织 Step {twInfo.step} · 施法 Step {scInfo.step}
            </span>
          </div>

          {matrixSpells.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[11px] font-bold text-neutral-900">★ 当前常备法术矩阵</div>
              <div className="grid grid-cols-2 gap-1.5">
                {matrixSpells.map((sp: any) => (
                  <div key={sp.instanceId} className="break-inside-avoid rounded border border-neutral-800 p-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-1">
                      <b className="text-neutral-950">{sp.nameCn}</b>
                      <span className="font-mono font-bold text-neutral-900">
                        {sp.circle}环 · 已编织脉路 {sp.wovenThreads || 0}/{sp.threads || 0}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-neutral-700">
                      编织 {sp.weavingBase}/{sp.weavingHigh} · 施法 {sp.castingType === 'fixed' ? sp.castingDn : sp.aoe ? '群体TMD' : 'TMD'} · 效果 {sp.effectFormula}
                    </div>
                    <div className="mt-0.5 text-[10px] text-neutral-600">
                      {sp.range} · {sp.duration}{sp.aoe ? ` · ${sp.aoe}` : ''} — {sp.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {grimoireSpells.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-neutral-700">法术书储备</div>
              <div className="grid grid-cols-2 gap-1.5">
                {grimoireSpells.map((sp: any) => (
                  <div key={sp.instanceId} className="break-inside-avoid rounded border border-neutral-400 p-1.5 text-[10px] text-neutral-800">
                    <div className="flex items-center justify-between">
                      <b className="text-neutral-950">{sp.nameCn}</b>
                      <span className="font-mono">{sp.circle}环 · {sp.threads || 0}脉路 · 编织{sp.weavingBase}</span>
                    </div>
                    <div className="text-neutral-600">{sp.effectFormula} · {sp.range} · {sp.duration}</div>
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
          <h2 className="font-noto-serif mb-1 border-b border-neutral-800 pb-0.5 text-xs font-bold text-neutral-900">
            普通装备与防具 ({(pl.gear || []).length})
          </h2>
          {(pl.gear || []).length === 0 ? (
            <div className="text-[11px] text-neutral-600">暂无额外记录装备</div>
          ) : (
            <ul className="space-y-0.5 text-[11px]">
              {pl.gear.map((g: any, i: number) => (
                <li key={i} className="break-inside-avoid flex items-baseline justify-between gap-2 border-b border-neutral-200 py-0.5">
                  <span>
                    <span className="font-mono text-[10px] text-neutral-600">[{g.equipped !== false ? '激活' : '未穿'}]</span>{' '}
                    <b className="text-neutral-950">{g.name}</b>
                    {g.rank && g.rank !== '-' ? ` (${g.rank})` : ''}
                  </span>
                  <span className="text-neutral-700">{g.effect || '-'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="break-inside-avoid">
          <h2 className="font-noto-serif mb-1 border-b border-neutral-800 pb-0.5 text-xs font-bold text-neutral-900">
            脉路物品 ({(pl.threadItems || []).length}) 与传说财富
          </h2>
          {(pl.threadItems || []).length > 0 && (
            <ul className="mb-1.5 space-y-0.5 text-[11px]">
              {pl.threadItems.map((ti: any, i: number) => (
                <li key={i} className="break-inside-avoid flex items-baseline justify-between gap-2 border-b border-neutral-200 py-0.5">
                  <span>
                    <span className="font-mono text-[10px] text-neutral-600">[{ti.equipped !== false ? '激活' : '未启'}]</span>{' '}
                    <b className="text-neutral-950">{ti.name}</b>
                    {ti.type && ti.type !== '-' ? ` (${ti.type})` : ''}
                  </span>
                  <span className="text-neutral-700">{ti.effect || '-'}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="rounded border border-neutral-400 p-1.5 text-[11px] text-neutral-800">
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
