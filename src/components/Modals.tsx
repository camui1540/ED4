import React, { useEffect, useState } from 'react';
import { Check, Copy, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import ED4Engine from '../engine/ed4_engine.js';

interface SpellJsonModalProps {
  open: boolean;
  onClose: () => void;
  onCopied: () => void;
}

export function SpellJsonModal({ open, onClose, onCopied }: SpellJsonModalProps) {
  if (!open) return null;
  const jsonStr = JSON.stringify(ED4Engine.SPELLS_DB, null, 2);

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(jsonStr);
    }
    onCopied();
  };

  const handleDownload = () => {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ed4_spells.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs print:hidden"
    >
      <div className="tactile-card flex w-full max-w-3xl flex-col gap-3 p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="font-serif text-sm text-card-foreground">
            结构化法术库 JSON（共 {ED4Engine.SPELLS_DB.length} 条）
          </b>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-7 items-center rounded border border-primary bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
            >
              复制 JSON
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex h-7 items-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              下载 .json
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 items-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              关闭
            </button>
          </div>
        </div>
        <textarea
          readOnly
          value={jsonStr}
          className="h-[58vh] w-full resize-none rounded border border-input bg-muted/60 p-2.5 font-mono text-[11px] text-foreground focus:border-ring focus:outline-none"
        />
      </div>
    </div>
  );
}

interface ManualModalProps {
  open: boolean;
  onClose: () => void;
}

export function ManualModal({ open, onClose }: ManualModalProps) {
  if (!open) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs print:hidden"
    >
      <div className="tactile-card flex max-h-[82vh] w-full max-w-2xl flex-col gap-3 p-4 shadow-lg">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <b className="font-serif text-sm text-card-foreground">使用说明书</b>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            关闭
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto pr-1 text-xs leading-relaxed text-card-foreground">
          <div>
            <h3 className="mb-1 font-semibold text-foreground">1. 建卡与角色卡导入</h3>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>在角色卡顶部切换种族、门类、环数与业力骰（D6/D8），衍生血量、业力上限与各环加值自动重算。</li>
              <li>点击「导入角色卡 (.xlsx / .txt)」可上传填好的 Excel 自动表或 TXT 角色记录表，自动识别属性、天赋、技能、武器、装备、脉路物品与法术。</li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-foreground">2. 检定与战斗规则隔离</h3>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>所有动作检定受负伤、防御姿态、倒地、受扰等修正；伤害与效果检定仅受武器/法术公式及猛烈攻击加值影响。</li>
              <li>装备与脉路物品每行左侧复选框控制是否穿戴并计入面板数值，首次导入自动归一化防止双重叠加。</li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-foreground">3. 法术矩阵与施放流程</h3>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>拖拽法术卡片（或使用按钮）在常备矩阵与法术书之间调换；含脉路要求的法术需先「编织」满脉路后才可「施法」。</li>
              <li>若场上存在多只怪物，目标下拉框可选「群体目标：全场存活怪物」，自动取最高秘法防御并批量结算伤害。</li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-semibold text-foreground">4. GM 面板、先攻与反应</h3>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>在怪物面板可维护模板并生成怪物；右侧先攻栏支持全员投先攻、顺位与轮次推进、全队休整及待确认反应（回避打击/反击）。</li>
              <li>顶部「GM脱敏」可在战报与目标选项中隐藏敌方精确防御与血量阈值。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ExportModalProps {
  open: boolean;
  characterName: string;
  circle: number;
  onClose: () => void;
  onExportTxt: () => void;
  onCopyTxt: () => Promise<boolean> | boolean;
  onExportExcel: () => void;
  onExportPdf: () => void;
}

export function ExportModal({
  open,
  characterName,
  circle,
  onClose,
  onExportTxt,
  onCopyTxt,
  onExportExcel,
  onExportPdf,
}: ExportModalProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);

  useEffect(() => {
    if (!open) setCopiedMsg(false);
  }, [open]);

  if (!open) return null;

  const handleCopyClick = async () => {
    const ok = await onCopyTxt();
    if (ok) {
      setCopiedMsg(true);
      window.setTimeout(() => setCopiedMsg(false), 2600);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs print:hidden"
    >
      <div className="tactile-card flex w-full max-w-md flex-col gap-3 p-4 shadow-lg">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div>
            <b className="font-serif text-sm text-card-foreground">导出角色卡</b>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              当前角色：<span className="font-semibold text-foreground">{characterName || '未命名角色'}</span>（
              <span className="font-mono">{circle}</span> 环）
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            关闭
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={onExportTxt}
            className="flex items-center justify-between rounded border border-border bg-background/70 px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="font-semibold text-foreground">导出为 TXT (.txt)</div>
                <div className="text-[11px] text-muted-foreground">完整序列化当前属性、天赋、技能、装备与法术矩阵，可无损回导</div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={handleCopyClick}
            className="flex items-center justify-between rounded border border-border bg-background/70 px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              {copiedMsg ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Copy className="h-4 w-4 shrink-0 text-primary" />
              )}
              <div>
                <div className="font-semibold text-foreground">复制角色卡文本 (TXT 到剪贴板)</div>
                <div className="text-[11px] text-muted-foreground">快速粘贴分享或备份纯文本角色记录表</div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onExportExcel}
            className="flex items-center justify-between rounded border border-border bg-background/70 px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="font-semibold text-foreground">导出为 Excel (.xlsx)</div>
                <div className="text-[11px] text-muted-foreground">纯数值镜像结构，严格对齐导入器工作表锚点与列名</div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onExportPdf}
            className="flex items-center justify-between rounded border border-primary bg-primary/15 px-3 py-2.5 text-left text-xs transition-colors hover:bg-primary/25 cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Printer className="h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="font-semibold text-foreground">导出 / 打印 PDF</div>
                <div className="text-[11px] text-muted-foreground">生成高对比度 A4 纸白底打印档案，自动命名并同步实时战况</div>
              </div>
            </div>
          </button>
        </div>

        {copiedMsg && (
          <div
            role="status"
            className="rounded border border-primary bg-primary/15 px-2.5 py-1.5 text-center text-xs font-medium text-foreground"
          >
            已成功复制角色卡 TXT 文本到剪贴板！
          </div>
        )}
      </div>
    </div>
  );
}
