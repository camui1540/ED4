import React from 'react';
import ED4Engine from '../engine/ed4_engine.js';

interface StepTableViewProps {
  onQuickRollStep: (step: number) => void;
}

export function StepTableView({ onQuickRollStep }: StepTableViewProps) {
  const rows = Array.from({ length: 20 }, (_, i) => {
    const stepA = i + 1;
    const stepB = i + 21;
    return {
      stepA,
      labelA: ED4Engine.getStepDice(stepA).label,
      stepB,
      labelB: ED4Engine.getStepDice(stepB).label,
    };
  });

  return (
    <section className="tactile-card p-3">
      <div className="mb-2.5 font-serif text-sm font-semibold text-card-foreground">
        ED4E 官方 STEP 对照表（点击行直接掷骰）
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Step</th>
              <th className="px-2 py-1.5 font-medium">行动骰</th>
              <th className="border-l border-border px-2 py-1.5 font-medium">Step</th>
              <th className="px-2 py-1.5 font-medium">行动骰</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.stepA}>
                <td
                  onClick={() => onQuickRollStep(r.stepA)}
                  className="cursor-pointer px-2 py-1.5 font-mono font-bold text-foreground transition-colors hover:bg-muted"
                >
                  Step {r.stepA}
                </td>
                <td
                  onClick={() => onQuickRollStep(r.stepA)}
                  className="cursor-pointer px-2 py-1.5 font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {r.labelA}
                </td>
                <td
                  onClick={() => onQuickRollStep(r.stepB)}
                  className="cursor-pointer border-l border-border px-2 py-1.5 font-mono font-bold text-foreground transition-colors hover:bg-muted"
                >
                  Step {r.stepB}
                </td>
                <td
                  onClick={() => onQuickRollStep(r.stepB)}
                  className="cursor-pointer px-2 py-1.5 font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {r.labelB}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
