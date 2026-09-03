import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleStop, LoaderCircle, X, XCircle } from 'lucide-react';
import type { TaskStepStatus, TaskTimelineItem } from './taskTimeline';
import styles from './TaskInspector.module.css';

interface TaskInspectorProps {
  task: TaskTimelineItem;
  now: number;
  onClose: () => void;
}

type InspectorTab = 'overview' | 'progress' | 'artifacts' | 'activity';

const INSPECTOR_WIDTH_KEY = 'di_agent:task-inspector-width';
const INSPECTOR_DEFAULT_WIDTH = 400;
const INSPECTOR_MIN_WIDTH = 360;
const INSPECTOR_MAX_WIDTH = 560;
const INSPECTOR_DOCK_BREAKPOINT = 1360;
const MIN_WORKSPACE_WITH_RAIL_AND_LIST = 836;

export function clampInspectorWidth(width: number, viewportWidth: number): number {
  const workspaceMaximum = Math.max(
    INSPECTOR_MIN_WIDTH,
    viewportWidth - MIN_WORKSPACE_WITH_RAIL_AND_LIST,
  );
  return Math.min(
    Math.max(width, INSPECTOR_MIN_WIDTH),
    Math.min(INSPECTOR_MAX_WIDTH, workspaceMaximum),
  );
}

export function defaultInspectorTab(status: TaskTimelineItem['status']): InspectorTab {
  return status === 'streaming' || status === 'error' ? 'progress' : 'overview';
}

export function nextInspectorTabIndex(current: number, key: string, total: number): number {
  if (key === 'ArrowRight') return (current + 1) % total;
  if (key === 'ArrowLeft') return (current - 1 + total) % total;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  return current;
}

const statusCopy: Record<TaskTimelineItem['status'], string> = {
  streaming: '执行中',
  complete: '已完成',
  error: '失败',
  canceled: '已取消',
};

const stepStatusCopy: Record<TaskStepStatus, string> = {
  pending: '等待执行',
  running: '正在进行',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
};

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '时间未知';
  const date = new Date(timestamp);
  const today = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

const RESULT_PREVIEW_LIMIT = 280;

export function taskResultPreview(result: string, limit = RESULT_PREVIEW_LIMIT): { preview: string; collapsed: boolean } {
  const normalized = result.trim();
  const withoutLargeArtifacts = normalized
    .replace(/```[\s\S]*?```/g, '\n[代码或产物内容已折叠]\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const collapsed = normalized.length > limit || withoutLargeArtifacts !== normalized;
  if (withoutLargeArtifacts.length <= limit) return { preview: withoutLargeArtifacts, collapsed };
  return { preview: `${withoutLargeArtifacts.slice(0, limit).trimEnd()}…`, collapsed: true };
}

const StepIcon: React.FC<{ status: TaskStepStatus }> = ({ status }) => {
  if (status === 'running') return <LoaderCircle className={styles.spin} />;
  if (status === 'failed') return <XCircle />;
  if (status === 'canceled') return <CircleStop />;
  if (status === 'pending') return <span className={styles.pendingDot} />;
  return <CheckCircle2 />;
};

const StepDisclosure: React.FC<{ step: TaskTimelineItem['steps'][number] }> = ({ step }) => (
  <details className={styles.disclosure}>
    <summary>
      <span className={`${styles.stepIcon} ${styles[`step${step.status}`]}`}><StepIcon status={step.status} /></span>
      <span className={styles.stepCopy}>
        <strong>{step.label}</strong>
        <small>{step.summary || '该步骤没有附加摘要。'}</small>
      </span>
      <span className={styles.stepState}>{stepStatusCopy[step.status]}</span>
    </summary>
    <div className={styles.stepDetail}>{step.detail || step.summary || '该步骤没有附加输出。'}</div>
  </details>
);

export const TaskInspector: React.FC<TaskInspectorProps> = ({ task, now, onClose }) => {
  const [tab, setTab] = useState<InspectorTab>(() => defaultInspectorTab(task.status));
  const inspectorRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const widthRef = useRef(INSPECTOR_DEFAULT_WIDTH);
  const preferredWidthRef = useRef(INSPECTOR_DEFAULT_WIDTH);
  const resizeRef = useRef<{ pointerId: number; pointerX: number; originWidth: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const artifacts = useMemo(
    () => task.steps.filter((step) => step.kind === 'card' || step.kind === 'tool_result'),
    [task.steps],
  );
  const resultView = useMemo(
    () => taskResultPreview(task.result || '当前任务还没有可展示的结果。'),
    [task.result],
  );

  useEffect(() => {
    setTab(defaultInspectorTab(task.status));
  }, [task.id, task.status]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || window.innerWidth >= INSPECTOR_DOCK_BREAKPOINT) return;
      const focusable = Array.from(inspectorRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), details > summary, [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  const applyInspectorWidth = useCallback((width: number) => {
    const next = clampInspectorWidth(width, window.innerWidth);
    widthRef.current = next;
    document.documentElement.style.setProperty('--task-inspector-width', `${next}px`);
    return next;
  }, []);

  useLayoutEffect(() => {
    const persisted = Number.parseFloat(localStorage.getItem(INSPECTOR_WIDTH_KEY) ?? '');
    preferredWidthRef.current = Number.isFinite(persisted) ? persisted : INSPECTOR_DEFAULT_WIDTH;
    applyInspectorWidth(preferredWidthRef.current);
    const handleResize = () => applyInspectorWidth(preferredWidthRef.current);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [applyInspectorWidth]);

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || window.innerWidth < INSPECTOR_DOCK_BREAKPOINT) return;
    resizeRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      originWidth: widthRef.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setResizing(true);
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const next = applyInspectorWidth(resize.originWidth + resize.pointerX - event.clientX);
    preferredWidthRef.current = next;
  };

  const handleResizeEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    localStorage.setItem(INSPECTOR_WIDTH_KEY, String(preferredWidthRef.current));
    setResizing(false);
  };

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (window.innerWidth < INSPECTOR_DOCK_BREAKPOINT) return;
    const delta = event.shiftKey ? 1 : 16;
    let requested = preferredWidthRef.current;
    if (event.key === 'ArrowLeft') requested += delta;
    else if (event.key === 'ArrowRight') requested -= delta;
    else if (event.key === 'Home') requested = INSPECTOR_DEFAULT_WIDTH;
    else return;
    event.preventDefault();
    preferredWidthRef.current = applyInspectorWidth(requested);
    localStorage.setItem(INSPECTOR_WIDTH_KEY, String(preferredWidthRef.current));
  };

  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: 'overview', label: '概览' },
    { id: 'progress', label: '进程' },
    { id: 'artifacts', label: '产物' },
    { id: 'activity', label: '活动' },
  ];

  return (
    <>
      <button className={styles.compactScrim} type="button" onClick={onClose} aria-label="关闭任务明细抽屉" />
      <aside ref={inspectorRef} className={`${styles.inspector} ${resizing ? styles.inspectorResizing : ''}`} aria-label="任务明细">
        <button
          className={styles.resizeHandle}
          type="button"
          aria-label="调整任务检查器宽度"
          title="拖拽或使用左右方向键调整宽度，Home 恢复默认"
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onLostPointerCapture={handleResizeEnd}
          onKeyDown={handleResizeKeyDown}
        />
        <header className={styles.header}>
          <div className={styles.eyebrow}>{task.conversationTitle} · {task.agentName}</div>
          <div className={styles.titleRow}>
            <h2>{task.title}</h2>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭任务检查器"><X /></button>
          </div>
          <div className={styles.metaRow}>
            <span className={`${styles.status} ${styles[`status${task.status}`]}`}>{statusCopy[task.status]}</span>
            <span>{task.completedStepCount}/{task.steps.length} 步</span>
            <span>{task.status === 'streaming' ? `已用时 ${formatElapsed(now - task.recordedAt)}` : formatTimestamp(task.recordedAt)}</span>
          </div>
        </header>

        <nav className={styles.tabs} role="tablist" aria-label="任务明细栏目">
          {tabs.map((item, index) => (
            <button
              type="button"
              key={item.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              className={tab === item.id ? styles.tabActive : ''}
              role="tab"
              id={`task-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`task-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = nextInspectorTabIndex(index, event.key, tabs.length);
                setTab(tabs[next]!.id);
                tabRefs.current[next]?.focus();
              }}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div
          id={`task-panel-${tab}`}
          className={styles.body}
          role="tabpanel"
          aria-labelledby={`task-tab-${tab}`}
        >
          {tab === 'overview' && (
            <div className={styles.overviewGrid}>
              <section>
                <span>当前步骤</span>
                <strong>{task.currentStep}</strong>
              </section>
              <section>
                <span>执行状态</span>
                <strong>{statusCopy[task.status]}</strong>
              </section>
              <section className={styles.resultSection}>
                <span>{task.status === 'error' ? '错误记录' : '结果摘要'}</span>
                <p>{resultView.preview}</p>
                {resultView.collapsed && (
                  <details className={styles.resultDisclosure}>
                    <summary>展开完整结果</summary>
                    <pre>{task.result}</pre>
                  </details>
                )}
              </section>
            </div>
          )}

          {tab === 'progress' && (
            <section className={styles.stepList} aria-label="执行步骤">
              {task.steps.length > 0
                ? task.steps.map((step) => <StepDisclosure key={step.id} step={step} />)
                : <div className={styles.empty}>当前任务还没有结构化步骤。</div>}
            </section>
          )}

          {tab === 'artifacts' && (
            <section className={styles.stepList} aria-label="任务产物">
              {artifacts.length > 0
                ? artifacts.map((step) => <StepDisclosure key={step.id} step={step} />)
                : <div className={styles.empty}>当前任务还没有卡片或工具产物。</div>}
            </section>
          )}

          {tab === 'activity' && (
            <ol className={styles.activityList}>
              {task.steps.map((step) => (
                <li key={step.id}>
                  <span className={`${styles.stepIcon} ${styles[`step${step.status}`]}`}><StepIcon status={step.status} /></span>
                  <span><strong>{step.label}</strong><small>{step.summary || stepStatusCopy[step.status]}</small></span>
                </li>
              ))}
              {task.steps.length === 0 && <li className={styles.empty}>当前任务还没有活动记录。</li>}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
};
