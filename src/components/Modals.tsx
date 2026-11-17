import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileSpreadsheet, FileText, Link2, LogOut, RefreshCw, Printer, Users, Wifi, WifiOff } from 'lucide-react';
import ED4Engine from '../engine/ed4_engine.js';
import {
  buildRoomInviteUrl,
  generateRoomCode,
  isSupabaseConfigured,
  SUPABASE_SETUP_SQL,
  type RoomCharacterRow,
  type RoomRole,
  type RoomSession,
} from '../engine/supabaseSync';

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
          <div>
            <h3 className="mb-1 font-semibold text-foreground">5. Supabase 多人联机说明</h3>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>配置环境变量 <code>VITE_SUPABASE_URL</code> 与 <code>VITE_SUPABASE_ANON_KEY</code> 后，点击顶栏「联机」即可创建或加入房间（支持 6 位房间码或中文等任意字符，及 <code>?room=房间码</code> 邀请链接直达）。</li>
              <li>选择「GM」可直接进入 GM 视角同步回合数、先攻序列、怪物与清场；选择「PL」将锁定玩家视角并隐藏 GM 怪物面板，当前伤害、负伤、法术脉路与装备穿戴变更会自动防抖同步给队友。</li>
            </ul>
            <pre className="mt-2 max-h-44 overflow-auto rounded border border-border bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-foreground">
              {SUPABASE_SETUP_SQL}
            </pre>
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
  pdfMode: 'bw' | 'theme';
  onChangePdfMode: (mode: 'bw' | 'theme') => void;
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
  pdfMode,
  onChangePdfMode,
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

          <div className="rounded border border-primary bg-primary/15 p-2.5 text-xs">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">PDF 配色</span>
              <div className="inline-flex overflow-hidden rounded border border-border bg-background">
                <button
                  type="button"
                  onClick={() => onChangePdfMode('bw')}
                  className={`h-6 px-2.5 text-[11px] cursor-pointer transition-colors ${
                    pdfMode === 'bw'
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  黑白打印版
                </button>
                <button
                  type="button"
                  onClick={() => onChangePdfMode('theme')}
                  className={`h-6 border-l border-border px-2.5 text-[11px] cursor-pointer transition-colors ${
                    pdfMode === 'theme'
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  主题彩色版
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={onExportPdf}
              className="flex w-full items-center justify-between rounded border border-primary bg-primary px-3 py-2 text-left text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Printer className="h-4 w-4 shrink-0" />
                <span>导出 / 打印 PDF</span>
              </span>
              <span className="text-[11px] opacity-90">
                {pdfMode === 'bw' ? '黑白打印版' : '主题彩色版'}
              </span>
            </button>
          </div>
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

interface RoomModalProps {
  open: boolean;
  session: RoomSession;
  initialRoomCode: string;
  charDefaultName: string;
  members: RoomCharacterRow[];
  onClose: () => void;
  onSelectRole: (role: RoomRole) => void;
  onUpdateNickname: (nickname: string) => void;
  onCreateRoom: (roomCode: string, nickname: string, role: RoomRole) => Promise<string | null>;
  onJoinRoom: (roomCode: string, nickname: string, role: RoomRole) => Promise<string | null>;
  onLeaveRoom: () => Promise<void>;
  onCopyInviteLink: (roomCode: string) => Promise<boolean>;
}

export function RoomModal({
  open,
  session,
  initialRoomCode,
  charDefaultName,
  members,
  onClose,
  onSelectRole,
  onUpdateNickname,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onCopyInviteLink,
}: RoomModalProps) {
  const [createCode, setCreateCode] = useState(() => generateRoomCode());
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [nickname, setNickname] = useState(session.nickname);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [createdBanner, setCreatedBanner] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const backdropMouseDownRef = useRef(false);

  useEffect(() => {
    if (initialRoomCode) setJoinCode(initialRoomCode);
  }, [initialRoomCode]);

  useEffect(() => {
    setNickname(session.nickname);
  }, [session.nickname]);

  useEffect(() => {
    if (!open) {
      setErrorMsg('');
      setCopiedLink(false);
    }
  }, [open]);

  if (!open) return null;

  const activeRole: RoomRole = session.role || 'pl';
  const isRoleLockedInRoom = session.connected && session.role === 'pl';

  const handlePickRole = (role: RoomRole) => {
    if (isRoleLockedInRoom && role === 'gm') return;
    onSelectRole(role);
    setErrorMsg('');
  };

  const handleCreate = async () => {
    setErrorMsg('');
    setCreatedBanner('');
    setBusy(true);
    const chosenRole: RoomRole = session.role || 'gm';
    if (!session.role) onSelectRole('gm');
    const resolvedNick = chosenRole === 'gm' ? nickname.trim() || 'GM' : nickname.trim() || charDefaultName || '玩家';
    const err = await onCreateRoom(createCode, resolvedNick, chosenRole);
    setBusy(false);
    if (err) {
      setErrorMsg(err);
    } else {
      setCreatedBanner(createCode.trim());
    }
  };

  const handleJoin = async () => {
    setErrorMsg('');
    setCreatedBanner('');
    setBusy(true);
    const chosenRole: RoomRole = session.role || 'pl';
    if (!session.role) onSelectRole('pl');
    const resolvedNick = chosenRole === 'gm' ? nickname.trim() || 'GM' : nickname.trim() || charDefaultName || '玩家';
    const err = await onJoinRoom(joinCode, resolvedNick, chosenRole);
    setBusy(false);
    if (err) setErrorMsg(err);
  };

  const handleCopyLink = async (code: string) => {
    const ok = await onCopyInviteLink(code);
    if (ok) {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2600);
    }
  };

  const displayRoomCode = session.connected ? session.roomCode : createdBanner;

  return (
    <div
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (backdropMouseDownRef.current && e.target === e.currentTarget) onClose();
        backdropMouseDownRef.current = false;
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-xs print:hidden"
    >
      <div className="tactile-card flex w-full max-w-lg flex-col gap-3 p-4 shadow-lg">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center gap-2">
            {session.connected ? (
              <Wifi className="h-4 w-4 text-primary" />
            ) : (
              <WifiOff className="h-4 w-4 text-muted-foreground" />
            )}
            <b className="font-serif text-sm text-card-foreground">联机大厅</b>
            <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-serif text-[10px] text-secondary-foreground">
              {isSupabaseConfigured ? (session.connected ? `房间 ${session.roomCode}` : '未进房') : '纯单机模式'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded border border-border bg-secondary px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          >
            关闭
          </button>
        </div>

        {!isSupabaseConfigured && (
          <div className="rounded border border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            未检测到 Supabase 环境变量，当前已自动降级为纯单机模式。
          </div>
        )}

        {/* 身份选择：GM / PL */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">身份与视角</span>
            <span className="text-[11px] text-muted-foreground">
              {session.role === 'gm' ? '当前：GM 视角' : session.role === 'pl' ? '当前：PL 视角（已隐藏 GM 面板）' : '请选择身份'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isRoleLockedInRoom}
              onClick={() => handlePickRole('gm')}
              className={`h-9 rounded border px-3 text-xs font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                session.role === 'gm'
                  ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                  : 'border-border bg-secondary text-secondary-foreground hover:bg-muted'
              }`}
            >
              GM
            </button>
            <button
              type="button"
              onClick={() => handlePickRole('pl')}
              className={`h-9 rounded border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                session.role === 'pl'
                  ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                  : 'border-border bg-secondary text-secondary-foreground hover:bg-muted'
              }`}
            >
              PL
            </button>
          </div>
          <input
            type="text"
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              onUpdateNickname(e.target.value);
            }}
            placeholder={activeRole === 'gm' ? '玩家昵称（选填，留空默认为 GM）' : `玩家昵称（留空默认为 ${charDefaultName || '玩家'}）`}
            className="h-8 w-full rounded border border-input bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
        </div>

        {/* 已进房状态与一键邀请链接 */}
        {displayRoomCode && (
          <div className="rounded border border-primary bg-primary/10 p-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                房间码：<b className="font-mono text-sm text-foreground">{displayRoomCode}</b>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleCopyLink(displayRoomCode)}
                  className="inline-flex h-7 items-center gap-1 rounded border border-primary bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer"
                >
                  {copiedLink ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                  <span>{copiedLink ? '已复制链接' : '复制邀请链接'}</span>
                </button>
                {session.connected && (
                  <button
                    type="button"
                    onClick={onLeaveRoom}
                    className="inline-flex h-7 items-center gap-1 rounded border border-border bg-secondary px-2 text-xs text-secondary-foreground hover:bg-muted cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>退出</span>
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground">
              {buildRoomInviteUrl(displayRoomCode)}
            </div>
          </div>
        )}

        {/* 创建与加入房间 */}
        {!session.connected && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded border border-border bg-background/60 p-2.5">
              <b className="text-xs text-foreground">创建房间</b>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={createCode}
                  onChange={(e) => setCreateCode(e.target.value)}
                  placeholder="房间码（支持中文/数字）"
                  className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
                />
                <button
                  type="button"
                  title="随机生成6位房间码"
                  onClick={() => setCreateCode(generateRoomCode())}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-secondary text-secondary-foreground hover:bg-muted cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                type="button"
                disabled={busy || !isSupabaseConfigured || !createCode.trim()}
                onClick={handleCreate}
                className="inline-flex h-8 items-center justify-center rounded border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '处理中...' : '创建房间'}
              </button>
            </div>

            <div className="flex flex-col gap-2 rounded border border-border bg-background/60 p-2.5">
              <b className="text-xs text-foreground">加入房间</b>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="输入房间码（如 114514）"
                className="h-7 w-full rounded border border-input bg-background px-2 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !isSupabaseConfigured || !joinCode.trim()}
                onClick={handleJoin}
                className="inline-flex h-8 items-center justify-center rounded border border-border bg-secondary px-3 text-xs font-semibold text-secondary-foreground hover:bg-muted cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '验证中...' : '加入房间'}
              </button>
            </div>
          </div>
        )}

        {/* 房间内在线成员列表 */}
        {session.connected && (
          <div className="rounded border border-border bg-background/60 p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Users className="h-3.5 w-3.5 text-primary" />
              <span>当前成员 ({members.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground"
                >
                  <b className="font-serif text-[10px] text-primary">{m.role.toUpperCase()}</b>
                  <span>{m.nickname}</span>
                  {m.role === 'pl' && <span className="text-muted-foreground">({m.char_name})</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {errorMsg && (
          <div role="alert" className="rounded border border-destructive/60 bg-destructive/15 px-2.5 py-1.5 text-xs text-destructive">
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}
