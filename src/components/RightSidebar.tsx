import React, { useState } from 'react';
import { getPlDerivedView } from '../engine/combatHelpers';

interface RightSidebarProps {
  round: number;
  turnIndex: number;
  initiativeList: any[];
  pl: any;
  monsters: any[];
  gmBlind: boolean;
  pendingReaction: any;
  logs: any[];
  onRollAllInitiative: () => void;
  onNextTurn: () => void;
  onNextRound: () => void;
  onPartyFullRest: () => void;
  onRemoveMonster: (instanceId: string) => void;
  onResolveReaction: (action: 'accept' | 'avoid' | 'riposte') => void;
  onRollFreeTest: (step: number, dn: string, karma: boolean) => void;
  onClearLogs: () => void;
}

const inputCls =
  'h-7 rounded border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none';
const btnCls =
  'inline-flex h-7 items-center justify-center rounded border border-border bg-secondary px-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer whitespace-nowrap';
const btnPrimaryCls =
  'inline-flex h-7 items-center justify-center rounded border border-primary bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer whitespace-nowrap';

function renderExplodingTrace(detail: string) {
  const parts = detail.split(/((?:业力)?D\d+\[[^\]]*!→[^\]]*\])/g);
  return parts.map((part, idx) => {
    if (!part.includes('!→')) return <React.Fragment key={idx}>{part}</React.Fragment>;
    const boomCount = (part.match(/!→/g) || []).length;
    return (
      <span
        key={idx}
        title={`触发爆炸骰 (${boomCount}次)`}
        className={
          boomCount >= 2
            ? 'font-bold text-accent underline decoration-accent underline-offset-2'
            : 'font-semibold text-accent'
        }
      >
        {part}
      </span>
    );
  });
}

export function RightSidebar(props: RightSidebarProps) {
  const {
    round,
    turnIndex,
    initiativeList,
    pl,
    monsters,
    gmBlind,
    pendingReaction,
    logs,
    onRollAllInitiative,
    onNextTurn,
    onNextRound,
    onPartyFullRest,
    onRemoveMonster,
    onResolveReaction,
    onRollFreeTest,
    onClearLogs,
  } = props;

  const [freeStep, setFreeStep] = useState(7);
  const [freeDn, setFreeDn] = useState('');
  const [freeKarma, setFreeKarma] = useState(false);

  const d = getPlDerivedView(pl);
  const canReact =
    pendingReaction &&
    pendingReaction.targetType === 'pl' &&
    !pl.statuses.blindsided &&
    !pl.statuses.knockedDown &&
    !pl.statuses.surprised;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 先攻追踪 */}
      <section className="tactile-card p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-serif text-sm font-semibold text-card-foreground">先攻追踪</span>
          <span className="text-muted-foreground tabular-nums">第 {round} 轮</span>
        </div>
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          <button type="button" onClick={onRollAllInitiative} className={`${btnPrimaryCls} tactile-btn`}>
            全员投先攻
          </button>
          <button type="button" onClick={onNextTurn} className={btnCls}>
            下一顺位
          </button>
          <button type="button" onClick={onNextRound} className={btnCls}>
            下一轮
          </button>
          <button type="button" onClick={onPartyFullRest} className={btnCls}>
            全队休整
          </button>
        </div>

        {initiativeList.length === 0 ? (
          <div className="py-1 text-[11px] text-muted-foreground">点击「全员投先攻」或角色卡「投先攻」生成序列</div>
        ) : (
          <div className="space-y-1.5">
            {initiativeList.map((item, idx) => {
              const isCurrent = idx === turnIndex;
              let hpInfo = '';
              const tags: string[] = [];
              if (item.type === 'pl') {
                hpInfo = `伤 ${pl.currentDamage}/${d.effUncon} · 负伤 ${pl.wounds}`;
                if (pl.statuses.knockedDown) tags.push('倒地');
                if (pl.statuses.blindsided) tags.push('盲区');
                if (pl.options.aggressive) tags.push('猛攻');
                if (pl.options.defensive) tags.push('防御');
              } else {
                const m = monsters.find((x) => x.instanceId === item.id);
                if (m) {
                  hpInfo = gmBlind
                    ? m.wounds > 0
                      ? `负伤 ${m.wounds}`
                      : '正常'
                    : `伤 ${m.currentDamage}/${m.death} · 负伤 ${m.wounds}`;
                  if (m.knockedDown) tags.push('倒地');
                  if (m.blindsided) tags.push('盲区');
                }
              }

              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs ${
                    isCurrent
                      ? 'border-primary bg-primary/15 text-foreground shadow-2xs'
                      : 'border-border bg-background/70 text-card-foreground'
                  }`}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className={`min-w-6 font-mono text-base font-bold tabular-nums ${isCurrent ? 'text-primary' : 'text-foreground'}`}>
                      {item.initVal}
                    </span>
                    <span className="rounded border border-border px-1 font-mono text-[10px] font-semibold text-muted-foreground">
                      {item.type === 'pl' ? 'PL' : 'GM'}
                    </span>
                    <b className="truncate">{item.name}</b>
                    {tags.map((t) => (
                      <span key={t} className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground tabular-nums">{hpInfo}</span>
                    {item.type === 'gm' && (
                      <button
                        type="button"
                        onClick={() => onRemoveMonster(item.id)}
                        className="h-5 w-5 rounded border border-border bg-secondary text-[11px] text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 待确认反应 */}
      {pendingReaction && (
        <section className="tactile-card border-primary p-3 text-xs">
          <div className="mb-1 font-serif text-sm font-semibold text-foreground">
            待确认反应：{pendingReaction.attackerName} → {pendingReaction.targetName}
          </div>
          <div className="mb-2 text-[11px] text-muted-foreground tabular-nums">
            {pendingReaction.attackName} 检定 <b className="font-mono font-bold text-foreground">{pendingReaction.atkTotal}</b>（额外成功 +{pendingReaction.extraSuccesses}）
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onResolveReaction('accept')} className={btnPrimaryCls}>
              直接承受
            </button>
            {canReact && (
              <button type="button" onClick={() => onResolveReaction('avoid')} className={btnCls}>
                回避打击 (1劳累)
              </button>
            )}
            {canReact && pendingReaction.isMelee && (
              <button type="button" onClick={() => onResolveReaction('riposte')} className={btnCls}>
                反击 (2劳累)
              </button>
            )}
          </div>
        </section>
      )}

      {/* 自由检定与战报 */}
      <section className="tactile-card flex min-h-0 flex-1 flex-col p-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-serif text-sm font-semibold text-card-foreground">自由检定与战报</span>
          <button type="button" onClick={onClearLogs} className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer">
            清空
          </button>
        </div>

        <div className="mb-2.5 flex flex-wrap items-center gap-1.5 border-b border-border pb-2.5">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span>Step</span>
            <input
              type="number"
              min={1}
              max={60}
              value={freeStep}
              onChange={(e) => setFreeStep(Number(e.target.value) || 1)}
              className={`${inputCls} w-14 tabular-nums`}
            />
          </label>
          <input
            type="number"
            placeholder="难度"
            value={freeDn}
            onChange={(e) => setFreeDn(e.target.value)}
            className={`${inputCls} w-16 tabular-nums`}
          />
          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={freeKarma}
              onChange={(e) => setFreeKarma(e.target.checked)}
              className="accent-primary"
            />
            业力
          </label>
          <button type="button" onClick={() => onRollFreeTest(freeStep, freeDn, freeKarma)} className={btnPrimaryCls}>
            掷骰
          </button>
        </div>

        <div className="min-h-48 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {logs.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">暂无战报记录</div>
          ) : (
            logs.map((l) => (
              <div
                key={l.id}
                className={`rounded border px-2.5 py-1.5 text-xs ${
                  l.type === 'fail'
                    ? 'border-destructive/40 bg-destructive/10'
                    : l.type === 'warn'
                    ? 'border-primary/40 bg-background/70'
                    : 'border-border bg-background/70'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={
                      l.type === 'hit'
                        ? 'font-medium text-foreground'
                        : l.type === 'fail'
                        ? 'text-destructive'
                        : 'text-foreground/90'
                    }
                  >
                    {l.text}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{l.time}</span>
                </div>
                {l.detail && (
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {renderExplodingTrace(l.detail)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
