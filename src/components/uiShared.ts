export const inputCls =
  'h-7 rounded border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1';

export const noSpinInputCls = `${inputCls} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

export const btnCls =
  'inline-flex h-7 items-center justify-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer whitespace-nowrap';

export const btnPrimaryCls =
  'inline-flex h-7 items-center justify-center rounded border border-primary bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40 cursor-pointer whitespace-nowrap';

export const btnSmCls =
  'inline-flex h-6 items-center justify-center rounded border border-border bg-secondary px-2 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer whitespace-nowrap';

export const sectionCls = 'tactile-card p-3';

// 统一生成门类进阶与耐久加值标签
export function getDisciplineBonusTags(d: any): string[] {
  const prog = d.prog;
  return [
    `耐久 +${d.durabilityTotal}`,
    prog.pd ? `门类物防 +${prog.pd}` : '',
    prog.md ? `门类秘防 +${prog.md}` : '',
    prog.sd ? `门类社防 +${prog.sd}` : '',
    prog.init ? `门类先攻 +${prog.init}` : '',
    prog.rec ? `门类回复 +${prog.rec}` : '',
    prog.ma ? `门类秘甲 +${prog.ma}` : '',
  ].filter(Boolean);
}
