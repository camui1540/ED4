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
    <section className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-2.5 text-xs font-semibold text-zinc-200">ED4E 官方 STEP 对照表（点击行直接掷骰）</div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-[11px] text-zinc-400">
              <th className="px-2 py-1.5 font-medium">Step</th>
              <th className="px-2 py-1.5 font-medium">行动骰</th>
              <th className="border-l border-zinc-800 px-2 py-1.5 font-medium">Step</th>
              <th className="px-2 py-1.5 font-medium">行动骰</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.map((r) => (
              <tr key={r.stepA}>
                <td
                  onClick={() => onQuickRollStep(r.stepA)}
                  className="cursor-pointer px-2 py-1.5 font-semibold text-zinc-200 hover:bg-zinc-800/70"
                >
                  Step {r.stepA}
                </td>
                <td
                  onClick={() => onQuickRollStep(r.stepA)}
                  className="cursor-pointer px-2 py-1.5 text-zinc-300 hover:bg-zinc-800/70"
                >
                  {r.labelA}
                </td>
                <td
                  onClick={() => onQuickRollStep(r.stepB)}
                  className="cursor-pointer border-l border-zinc-800 px-2 py-1.5 font-semibold text-zinc-200 hover:bg-zinc-800/70"
                >
                  Step {r.stepB}
                </td>
                <td
                  onClick={() => onQuickRollStep(r.stepB)}
                  className="cursor-pointer px-2 py-1.5 text-zinc-300 hover:bg-zinc-800/70"
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
