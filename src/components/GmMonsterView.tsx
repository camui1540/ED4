import React, { useState } from 'react';
import { btnCls, btnPrimaryCls, inputCls } from './uiShared';

interface GmMonsterViewProps {
  plName: string;
  plTargets?: Array<{ clientId: string; label: string }>;
  templates: any[];
  monsters: any[];
  showAddForm: boolean;
  gmSecretRoll: boolean;
  onToggleGmSecretRoll: (checked: boolean) => void;
  onToggleAddForm: () => void;
  onSaveTemplate: (tpl: any) => void;
  onDeleteTemplate: (templateId: string) => void;
  onSpawnMonster: (templateId: string, count: number) => void;
  onAttackPl: (instanceId: string, targetClientId?: string) => void;
  onRemoveMonster: (instanceId: string) => void;
  onClearMonsters: () => void;
  onToggleMonsterFlag: (instanceId: string, flag: 'knockedDown' | 'blindsided' | 'harried') => void;
  onManualApplyDamage: (target: string, rawDmg: number, armorType: 'pa' | 'ma') => void;
}

const DEFAULT_FORM = {
  name: '',
  initStep: 7,
  pd: 10,
  md: 9,
  sd: 7,
  pa: 3,
  ma: 2,
  atkStep: 10,
  dmgStep: 11,
  kdStep: 7,
  recStep: 6,
  woundThreshold: 8,
  uncon: 30,
  death: 38,
};

export function GmMonsterView(props: GmMonsterViewProps) {
  const {
    plName,
    plTargets = [],
    templates,
    monsters,
    showAddForm,
    gmSecretRoll,
    onToggleGmSecretRoll,
    onToggleAddForm,
    onSaveTemplate,
    onDeleteTemplate,
    onSpawnMonster,
    onAttackPl,
    onRemoveMonster,
    onClearMonsters,
    onToggleMonsterFlag,
    onManualApplyDamage,
  } = props;

  const [form, setForm] = useState(DEFAULT_FORM);
  const [attackTargetId, setAttackTargetId] = useState('');
  const [calcTarget, setCalcTarget] = useState('pl');
  const [calcRawDmg, setCalcRawDmg] = useState('');
  const [calcArmorType, setCalcArmorType] = useState<'pa' | 'ma'>('pa');

  const resolvedAttackTargetId =
    plTargets.find((t) => t.clientId === attackTargetId)?.clientId || plTargets[0]?.clientId || '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveTemplate({
      ...form,
      id: `tpl_${Date.now()}`,
      name: form.name.trim() || '未命名生物',
    });
    setForm(DEFAULT_FORM);
  };

  return (
    <div className="space-y-3">
      {/* 怪物模板 */}
      <section className="tactile-card p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="font-serif text-sm font-semibold text-card-foreground">怪物与惧魔模板</span>
          <button type="button" onClick={onToggleAddForm} className={btnCls}>
            + 自定义怪物
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={handleSubmit} className="mb-3 rounded border border-border bg-background/70 p-3">
            <div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="col-span-2 flex flex-col gap-1 text-[11px] text-muted-foreground">
                <span>怪物名称</span>
                <input
                  required
                  placeholder="例如：血木劫掠者"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputCls}
                />
              </label>
              {[
                ['initStep', '先攻 Step'],
                ['pd', '物理防御'],
                ['md', '秘法防御'],
                ['sd', '社交防御'],
                ['pa', '物理护甲'],
                ['ma', '秘法护甲'],
                ['atkStep', '攻击 Step'],
                ['dmgStep', '伤害 Step'],
                ['kdStep', '击倒 Step'],
                ['recStep', '回复 Step'],
                ['woundThreshold', '负伤阈值'],
                ['uncon', '意识丧失'],
                ['death', '死亡'],
              ].map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                  <span>{label}</span>
                  <input
                    type="number"
                    value={(form as any)[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) || 0 }))}
                    className={`${inputCls} tabular-nums`}
                  />
                </label>
              ))}
            </div>
            <div className="text-right">
              <button type="submit" className={btnPrimaryCls}>
                保存模板
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded border border-border bg-background/70 p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <b className="font-serif text-sm text-foreground">{t.name}</b>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-foreground/90 tabular-nums">先攻 Step {t.initStep}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteTemplate(t.id)}
                    className="h-6 rounded border border-border bg-secondary px-2 text-[11px] text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mb-2.5 grid grid-cols-4 gap-1 text-[11px] text-muted-foreground tabular-nums">
                <div>物防 <b className="font-mono font-bold text-foreground">{t.pd}</b></div>
                <div>秘防 <b className="font-mono font-bold text-foreground">{t.md}</b></div>
                <div>物甲 <b className="font-mono font-bold text-foreground">{t.pa}</b></div>
                <div>秘甲 <b className="font-mono font-bold text-foreground">{t.ma}</b></div>
                <div>攻击 <b className="font-mono font-bold text-foreground">Step {t.atkStep}</b></div>
                <div>伤害 <b className="font-mono font-bold text-foreground">Step {t.dmgStep}</b></div>
                <div>击倒 <b className="font-mono font-bold text-foreground">Step {t.kdStep}</b></div>
                <div>回复 <b className="font-mono font-bold text-foreground">Step {t.recStep}</b></div>
                <div>负伤阈值 <b className="font-mono font-bold text-foreground">{t.woundThreshold}</b></div>
                <div>意识丧失 <b className="font-mono font-bold text-foreground">{t.uncon}</b></div>
                <div>死亡 <b className="font-mono font-bold text-foreground">{t.death}</b></div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => onSpawnMonster(t.id, 1)} className={btnPrimaryCls}>
                  加入战斗
                </button>
                <button type="button" onClick={() => onSpawnMonster(t.id, 3)} className={btnCls}>
                  批量生成 ×3
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 已加入战斗的怪物 */}
      <section className="tactile-card p-3">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="font-serif text-sm font-semibold text-card-foreground">已加入战斗的怪物 ({monsters.length})</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={gmSecretRoll}
                onChange={(e) => onToggleGmSecretRoll(e.target.checked)}
                className="accent-primary"
              />
              暗骰
            </label>
            {plTargets.length > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>攻击目标</span>
                <select
                  value={resolvedAttackTargetId}
                  onChange={(e) => setAttackTargetId(e.target.value)}
                  className={inputCls}
                >
                  {plTargets.map((t) => (
                    <option key={t.clientId} value={t.clientId}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {monsters.length > 0 && (
              <button type="button" onClick={onClearMonsters} className={btnCls}>
                清空战场
              </button>
            )}
          </div>
        </div>
        {monsters.length === 0 ? (
          <div className="text-xs text-muted-foreground">暂无已加入战斗的怪物，可从上方模板生成。</div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            {monsters.map((m) => {
              const isDead = m.currentDamage >= m.death;
              return (
                <div
                  key={m.instanceId}
                  className={`rounded border border-border bg-background/70 p-2.5 ${isDead ? 'opacity-50' : ''}`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <b className="text-foreground">{m.name}</b>
                      {isDead && <span className="rounded border border-border px-1 font-serif text-[10px] text-muted-foreground">死亡</span>}
                      {m.knockedDown && <span className="rounded border border-border px-1 font-serif text-[10px] text-muted-foreground">倒地</span>}
                      {m.blindsided && <span className="rounded border border-border px-1 font-serif text-[10px] text-muted-foreground">盲区</span>}
                      {m.harried && <span className="rounded border border-border px-1 font-serif text-[10px] text-muted-foreground">受扰</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isDead}
                        onClick={() => onAttackPl(m.instanceId, resolvedAttackTargetId || undefined)}
                        className={btnPrimaryCls}
                      >
                        攻击
                      </button>
                      <button type="button" onClick={() => onRemoveMonster(m.instanceId)} className={btnCls}>
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                    <span>
                      伤害 <b className="font-mono text-sm font-bold text-foreground">{m.currentDamage}</b> / 意识丧失{' '}
                      <span className="font-mono font-semibold text-foreground/90">{m.uncon}</span> / 死亡{' '}
                      <span className="font-mono font-semibold text-foreground/90">{m.death}</span> · 负伤{' '}
                      <b className="font-mono text-sm font-bold text-foreground">{m.wounds}</b>
                    </span>
                    <div className="flex items-center gap-1">
                      {([
                        ['knockedDown', '倒地'],
                        ['blindsided', '盲区'],
                        ['harried', '受扰'],
                      ] as const).map(([flag, label]) => (
                        <button
                          key={flag}
                          type="button"
                          onClick={() => onToggleMonsterFlag(m.instanceId, flag)}
                          className={`tactile-btn h-5 rounded border px-1.5 text-[10px] cursor-pointer ${
                            m[flag]
                              ? 'border-primary bg-primary font-semibold text-primary-foreground'
                              : 'border-border bg-secondary text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 快捷受创与击倒结算器 */}
      <section className="tactile-card p-3">
        <div className="mb-2 font-serif text-sm font-semibold text-card-foreground">快捷受创结算器</div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={calcTarget} onChange={(e) => setCalcTarget(e.target.value)} className={`${inputCls} w-40`}>
            <option value="pl">{plName}（PL）</option>
            {monsters.map((m) => (
              <option key={m.instanceId} value={m.instanceId}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder="原始伤害点数"
            value={calcRawDmg}
            onChange={(e) => setCalcRawDmg(e.target.value)}
            className={`${inputCls} w-28 tabular-nums`}
          />
          <select
            value={calcArmorType}
            onChange={(e) => setCalcArmorType(e.target.value as 'pa' | 'ma')}
            className={`${inputCls} w-24`}
          >
            <option value="pa">物理护甲</option>
            <option value="ma">秘法护甲</option>
          </select>
          <button
            type="button"
            onClick={() => {
              const val = Number(calcRawDmg) || 0;
              if (val <= 0) return;
              onManualApplyDamage(calcTarget, val, calcArmorType);
              setCalcRawDmg('');
            }}
            className={btnPrimaryCls}
          >
            结算受创
          </button>
        </div>
      </section>
    </div>
  );
}
