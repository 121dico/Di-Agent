import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bot } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { clampPanelPosition, parsePanelPosition, type PanelPosition } from '@/components/chat/taskPanelPosition';
import { ReportAgentChat, type ReportAgentContext } from './ReportAgentChat';
import styles from './ReportAgentWidget.module.css';

const launcherSize = { width: 64, height: 52 };
const viewport = () => {
  const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-display-scale')) || 1;
  return { width: window.innerWidth / scale, height: window.innerHeight / scale, scale };
};

export function ReportAgentWidget({ context }: { context: ReportAgentContext }) {
  const userId = useAuthStore((state) => state.user?.id);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [position, setPosition] = useState<PanelPosition>({ x: 0, y: 0 });
  const [dialogPosition, setDialogPosition] = useState<PanelPosition>({ x: 0, y: 0 });
  const dockRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const positionRef = useRef(position);
  const moved = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; origin: PanelPosition } | null>(null);
  const storageKey = `di_agent:report-agent-position:${userId ?? 'anonymous'}`;
  const place = useCallback((next: PanelPosition) => {
    const bounds = viewport();
    const clamped = clampPanelPosition(next, bounds, launcherSize, 12);
    positionRef.current = clamped;
    setPosition(clamped);
    const panel = { width: Math.min(420, bounds.width - 24), height: Math.min(580, bounds.height - 96) };
    setDialogPosition(clampPanelPosition({ x: clamped.x + launcherSize.width - panel.width, y: clamped.y - panel.height - 12 }, bounds, panel, 12));
  }, []);

  useLayoutEffect(() => {
    const bounds = viewport();
    let restored: PanelPosition | null = null;
    try { restored = parsePanelPosition(localStorage.getItem(storageKey)); } catch { /* 存储不可用仍允许使用浮窗。 */ }
    place(restored ?? { x: bounds.width - 88, y: bounds.height - 108 });
    setOpen(false);
    setHasOpened(false);
    const resize = () => { drag.current = null; place(positionRef.current); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [place, storageKey]);

  useLayoutEffect(() => {
    dockRef.current?.style.setProperty('--report-agent-x', `${position.x}px`);
    dockRef.current?.style.setProperty('--report-agent-y', `${position.y}px`);
    dialogRef.current?.style.setProperty('--report-agent-x', `${dialogPosition.x}px`);
    dialogRef.current?.style.setProperty('--report-agent-y', `${dialogPosition.y}px`);
  }, [position, dialogPosition, open]);

  const close = useCallback(() => { setOpen(false); launcherRef.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, close]);

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    moved.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: positionRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.hypot(dx, dy) < 6 && !moved.current) return;
    moved.current = true;
    const { scale } = viewport();
    place({ x: current.origin.x + dx / scale, y: current.origin.y + dy / scale });
  };
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (moved.current) { try { localStorage.setItem(storageKey, JSON.stringify(positionRef.current)); } catch { /* 位置记忆不阻断对话。 */ } }
  };

  if (!userId) return null;
  return createPortal(<>
    <div ref={dockRef} className={styles.dock}>
      <button ref={launcherRef} type="button" className={styles.launcher} aria-label={open ? '收起报表agent' : '打开报表agent'} aria-expanded={open} aria-controls={open ? 'report-agent-dialog' : undefined}
        title="报表agent · 拖动调整位置" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        onClick={() => { if (moved.current) { moved.current = false; return; } setHasOpened(true); setOpen((value) => !value); }}>
        <span className={styles.icon}><Bot size={25} strokeWidth={1.7} /></span>
      </button>
    </div>
    {hasOpened && <div hidden={!open} ref={dialogRef} className={styles.dialog} id="report-agent-dialog" role="dialog" aria-label="报表agent对话" aria-modal="false">
      <ReportAgentChat context={context} onClose={close} active={open} />
    </div>}
  </>, document.body);
}
