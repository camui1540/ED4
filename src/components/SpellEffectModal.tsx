import React, { useEffect, useState } from 'react';
import ED4Engine from '../engine/ed4_engine.js';
import { getPlDerivedView } from '../engine/combatHelpers';
import {
  computeSpellEffectPlan,
  enrichSpellWithDb,
  getBuffTargetKind,
  getExtraThreadBadgeLabel,
  getExtraThreadRuleInfo,
  type PendingSpellCast,
} from '../engine/spellRules';

export interface SpellBuffTargetChoice {
  attachMode: 'self' | 'external';
  targetItemId?: string;
  targetItemName?: string;
}

interface SpellEffectModalProps {
  open: boolean;
  spell: any | null;
  pl: any;
  pendingCast: PendingSpellCast | null;
  initialKarma: boolean;
  targetLabel: string;
  onClose: () => void;
  onConfirm: (
    instanceId: string,
    selectedExtraOptions: string[],
    useKarma: boolean,
    buffTarget?: SpellBuffTargetChoice
  ) => void;
}

export function SpellEffectModal({
  open,
  spell,
  pl,
  pendingCast,
  initialKarma,
  targetLabel,
  onClose,
  onConfirm,
}: SpellEffectModalProps) {
  const sp = spell ? enrichSpellWithDb(spell) : null;
  const rule = sp ? getExtraThreadRuleInfo(pl, sp) : null;
  const buffTargetKind = sp && sp.effectType === 'buff' ? getBuffTargetKind(sp) : 'character';
  const isBuffSpell = Boolean(sp && sp.effectType === 'buff');

  const extraThreadsCount = sp
    ? pendingCast
      ? pendingCast.extraThreadsCount
      : Math.max(0, (Number(sp.wovenThreads) || 0) - (Number(sp.threads) || 0))
    : 0;
  const castingExtraSuccesses = pendingCast ? pendingCast.castingExtraSuccesses : 0;

  const [selectedOpts, setSelectedOpts] = useState<string[]>([]);
  const [useKarma, setUseKarma] = useState(initialKarma);
  const [attachMode, setAttachMode] = useState<'self' | 'external'>('self');
  const [selectedTargetItemId, setSelectedTargetItemId] = useState<string>('');

  const weaponsList: any[] = Array.isArray(pl?.weapons) ? pl.weapons : [];
  const shieldName = pl?.shield?.name || '当前盾牌';

  useEffect(() => {
    if (!open || !sp) return;
    const opts = Array.isArray(sp.extraThreads) ? sp.extraThreads : [];
    const defaultOpt = opts[0] || '';
    setSelectedOpts(Array.from({ length: extraThreadsCount }, () => defaultOpt));
    setUseKarma(initialKarma && pl.karmaCurrent > 0);
    setAttachMode('self');
    if (getBuffTargetKind(sp) === 'weapon') {
      setSelectedTargetItemId(weaponsList[0]?.id || '__unarmed__');
    } else if (getBuffTargetKind(sp) === 'shield') {
      setSelectedTargetItemId('shield');
    } else {
      setSelectedTargetItemId('');
    }
  }, [open, sp?.instanceId, extraThreadsCount, initialKarma, pl.karmaCurrent]);

  if (!open || !sp || !rule) return null;

  const derived = getPlDerivedView(pl);
  const plan = computeSpellEffectPlan({
    spell: sp,
    pl,
    derived,
    extraThreadsCount,
    selectedExtraOptions: selectedOpts,
    castingExtraSuccesses,
  });

  const diceLabel = plan.finalStep !== null ? ED4Engine.getStepDice(plan.finalStep).label : '';

  const resolveBuffTargetChoice = (): SpellBuffTargetChoice | undefined => {
    if (!isBuffSpell) return undefined;
    if (attachMode === 'external') {
      return { attachMode: 'external' };
    }
    if (buffTargetKind === 'weapon') {
      const chosenWeapon = weaponsList.find((w) => w.id === selectedTargetItemId) || weaponsList[0];
      return {
        attachMode: 'self',
        targetItemId: chosenWeapon ? chosenWeapon.id : '__unarmed__',
        targetItemName: chosenWeapon ? chosenWeapon.name : '徒手/未列武器',
      };
    }
    if (buffTargetKind === 'shield') {
      return {
        attachMode: 'self',
        targetItemId: 'shield',
        targetItemName: shieldName,
      };
    }
    return { attachMode: 'self' };
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs print:hidden"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="spell-effect-modal-title"
        className="tactile-card flex max-h-[88vh] w-full max-w-lg flex-col gap-3 p-4 shadow-lg"
      >
        <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
          <div>
            <h2 id="spell-effect-modal-title" className="font-serif text-sm font-bold text-card-foreground">
              施法效果结算 · {sp.nameCn}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
              <span>{sp.circle}环</span>
              <span>· 基础效果：{sp.effectFormula}</span>
              {pendingCast?.tmdUsed !== null && pendingCast?.tmdUsed !== undefined ? (
                <span>
                  · TMD {pendingCast.tmdUsed}（施法额外成功 +{castingExtraSuccesses}）
                </span>
              ) : targetLabel ? (
                <span>· 目标：{targetLabel}</span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            关闭
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto pr-1 text-xs">
          {/* 额外脉路选项区 */}
          {extraThreadsCount > 0 ? (
            <div className="rounded border border-border bg-background/60 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <b className="font-serif text-xs text-foreground">
                  额外脉路分配（共 {extraThreadsCount} 条）
                </b>
                <span className="text-[11px] text-muted-foreground">
                  {plan.supportsStepBoost ? '已解锁 +2 效果阶数/STEP 强化' : '请选择每条额外脉路的法术强化'}
                </span>
              </div>
              <div className="space-y-2">
                {Array.from({ length: extraThreadsCount }, (_, idx) => {
                  const val = selectedOpts[idx] || rule.extraThreadsOptions[0] || '';
                  const badge = getExtraThreadBadgeLabel(val, plan.supportsStepBoost);
                  return (
                    <label key={idx} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 font-mono text-[11px] font-semibold text-foreground">
                        额外脉路 #{idx + 1}
                      </span>
                      <select
                        aria-label={`额外脉路 #${idx + 1}`}
                        value={val}
                        onChange={(e) => {
                          const nextVal = e.target.value;
                          setSelectedOpts((prev) => {
                            const next = [...prev];
                            next[idx] = nextVal;
                            return next;
                          });
                        }}
                        className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground focus:border-ring outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                      >
                        {rule.extraThreadsOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      <span className="w-16 shrink-0 text-right font-mono text-[11px] font-semibold text-primary">
                        {badge}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded border border-border bg-background/50 px-2.5 py-2 text-[11px] text-muted-foreground">
              本次施法未编入额外脉路（基础脉路 {sp.threads} 条）。
            </div>
          )}

          {/* 效果与持续时间结算明细（面向 PL 清晰展示） */}
          <div className="rounded border border-primary/40 bg-primary/10 p-2.5 space-y-2">
            <div className="font-serif text-xs font-semibold text-foreground">
              {plan.hasBaseRoll ? '效果阶数 / STEP 拆解明细' : '固定增益 / 状态效果'}
            </div>

            {plan.hasBaseRoll && plan.baseStep !== null ? (
              <div className="space-y-1 font-mono text-[11px] text-foreground tabular-nums">
                <div className="flex items-center justify-between">
                  <span>
                    基础效果：{plan.baseFormula}
                    {plan.willforceRank > 0 ? `（含意志力 +${plan.willforceRank}，1 负荷）` : ''}
                  </span>
                  <b>Step {plan.baseStep}</b>
                </div>

                {plan.extraThreadStepBonus > 0 && (
                  <div className="flex items-center justify-between text-primary">
                    <span>+ 额外脉路强化（{plan.stepEnhanceCount} 条）</span>
                    <b>+{plan.extraThreadStepBonus} STEP</b>
                  </div>
                )}

                {plan.castingExtraStepBonus > 0 && (
                  <div className="flex items-center justify-between text-primary">
                    <span>+ 施法额外成功（{plan.castingExtraSuccesses} 成功）</span>
                    <b>+{plan.castingExtraStepBonus} STEP</b>
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-border/80 pt-1 text-xs font-bold">
                  <span>最终效果阶数</span>
                  <span>
                    Step {plan.finalStep} ({diceLabel})
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-xs leading-relaxed text-foreground">{plan.playerSummaryText}</div>
            )}

            {/* 持续时间结算（含施法额外成功与额外脉路延时） */}
            {plan.durationPlan.rawDuration !== '-' && (
              <div className="border-t border-border/60 pt-1.5 text-[11px] text-foreground tabular-nums">
                <span className="font-semibold">{plan.durationPlan.summaryText}</span>
              </div>
            )}

            {/* 有独立效果骰时若还有非STEP额外脉路选择（如范围/目标扩展），干净展示 */}
            {plan.hasBaseRoll && plan.effectEnhancements.length > 0 && (
              <div className="border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">附加脉路效果：</span>
                {plan.effectEnhancements
                  .map((t) => (t.count > 1 ? `${t.label} ×${t.count}` : t.label))
                  .join('、')}
              </div>
            )}
          </div>

          {/* 轻量 Buff 挂载目标选择（仅 effectType === 'buff'） */}
          {isBuffSpell && (
            <div className="rounded border border-border bg-background/60 p-2.5 space-y-2">
              <div className="font-serif text-xs font-semibold text-foreground">增益挂载目标</div>
              <div className="space-y-1.5 text-xs">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="buff-attach-mode"
                    checked={attachMode === 'self'}
                    onChange={() => setAttachMode('self')}
                    className="accent-primary"
                  />
                  <span className="text-foreground">挂载到当前角色（自动计入临时面板/指定装备）</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="buff-attach-mode"
                    checked={attachMode === 'external'}
                    onChange={() => setAttachMode('external')}
                    className="accent-primary"
                  />
                  <span className="text-muted-foreground">作用于队友/外部目标（仅记录战报）</span>
                </label>
              </div>

              {attachMode === 'self' && buffTargetKind === 'weapon' && (
                <label className="flex items-center gap-2 border-t border-border/60 pt-2">
                  <span className="shrink-0 text-[11px] font-semibold text-foreground">作用武器</span>
                  <select
                    aria-label="选择增益作用的武器"
                    value={selectedTargetItemId}
                    onChange={(e) => setSelectedTargetItemId(e.target.value)}
                    className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground focus:border-ring outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                  >
                    {weaponsList.length > 0 ? (
                      weaponsList.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}（基础伤害 +{w.dmgStep}）
                        </option>
                      ))
                    ) : (
                      <option value="__unarmed__">徒手 / 当前武器</option>
                    )}
                  </select>
                </label>
              )}

              {attachMode === 'self' && buffTargetKind === 'shield' && (
                <label className="flex items-center gap-2 border-t border-border/60 pt-2">
                  <span className="shrink-0 text-[11px] font-semibold text-foreground">作用盾牌</span>
                  <select
                    aria-label="选择增益作用的盾牌"
                    value={selectedTargetItemId || 'shield'}
                    onChange={(e) => setSelectedTargetItemId(e.target.value)}
                    className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground focus:border-ring outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                  >
                    <option value="shield">
                      {shieldName}（物防 +{pl?.shield?.pd || 0} / 秘防 +{pl?.shield?.md || 0}）
                    </option>
                  </select>
                </label>
              )}
            </div>
          )}
        </div>

        {/* 业力与确认 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
          {plan.hasBaseRoll ? (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                disabled={pl.karmaCurrent <= 0}
                checked={useKarma && pl.karmaCurrent > 0}
                onChange={(e) => setUseKarma(e.target.checked)}
                className="accent-primary"
              />
              <span>
                使用业力骰 (D{pl.karmaDie}，余 {pl.karmaCurrent})
              </span>
            </label>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {isBuffSpell && attachMode === 'self'
                ? '确认后将自动挂载至角色临时增益并记录战报'
                : '确认后将生效细节记录至战报'}
            </span>
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 items-center rounded border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() =>
                onConfirm(sp.instanceId, selectedOpts, useKarma && pl.karmaCurrent > 0, resolveBuffTargetChoice())
              }
              className="inline-flex h-7 items-center rounded border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
            >
              {plan.finalStep !== null ? `确认掷效果骰 (Step ${plan.finalStep})` : '确认结算效果'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
