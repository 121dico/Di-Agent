import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock3,
  LoaderCircle,
  Minus,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useMessageStore } from '@/store/messageStore';
import { useConversationStore } from '@/store/conversationStore';
import { isTaskConversation } from '@/views/taskBoardSelection';
import {
  projectTaskTimeline,
  type TaskStepStatus,
  type TaskTimeline,
  type TaskTimelineItem,
} from './taskTimeline';
import { EMPTY_TASK_MESSAGES, selectTaskMessageLists } from './taskMessageSelector';
import { TaskInspector } from './TaskInspector';
import {
  avoidPanelCollision,
  clampPanelGeometry,
  clampPanelPosition,
  DEFAULT_PANEL_SIZE,
  detectPanelSnapEdges,
  parsePanelPosition,
  parsePanelSize,
  snapPanelPosition,
  type PanelPosition,
  type PanelSize,
  type PanelSnapEdges,
} from './taskPanelPosition';
import styles from './TaskProgressWidget.module.css';

const COLLAPSE_KEY = 'di_agent:process-panel-collapsed';
const POSITION_KEY = 'di_agent:process-panel-position';
const SIZE_KEY = 'di_agent:process-panel-size';

function getComposerExclusionRect() {
  const bounds = document.querySelector<HTMLElement>('[data-chat-composer]')?.getBoundingClientRect();
  if (!bounds) return null;
  return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
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

export function selectTaskPanelItems(timeline: TaskTimeline): TaskTimeline {
  return {
    active: timeline.active,
    completed: timeline.completed.slice(0, 3),
  };
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) return '时间未知';
  const date = new Date(timestamp);
  const today = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

const StepStateIcon: React.FC<{ status: TaskStepStatus }> = ({ status }) => {
  if (status === 'running') return <LoaderCircle className={styles.spin} />;
  if (status === 'failed') return <XCircle />;
  if (status === 'canceled') return <CircleStop />;
  if (status === 'pending') return <span className={styles.pendingDot} />;
  return <CheckCircle2 />;
};

export function isTaskPanelDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-task-progress-launcher="true"]')) return true;
  return target.closest('button') === null;
}

export const TaskStepDisclosure: React.FC<{ step: TaskTimelineItem['steps'][number] }> = ({ step }) => (
  <details className={styles.stepDisclosure}>
    <summary className={styles.stepSummary}>
      <span className={styles.detailStepHeading}>
        <span>{step.label}</span>
        <span className={styles.detailStepState}>{stepStatusCopy[step.status]}</span>
      </span>
      <span className={styles.stepSummaryLine}>
        <span>{step.summary || '该步骤没有附加摘要。'}</span>
        <ChevronRight className={styles.stepChevron} aria-hidden="true" />
      </span>
    </summary>
    <div className={styles.detailText}>{step.detail || step.summary || '该步骤没有附加输出。'}</div>
  </details>
);

const TaskCard: React.FC<{
  task: TaskTimelineItem;
  now: number;
  onOpen: () => void;
}> = ({ task, now, onOpen }) => {
  const isActive = task.status === 'streaming';
  const stateClass = task.status === 'error'
    ? styles.cardFailed
    : task.status === 'canceled'
      ? styles.cardCanceled
      : isActive
        ? styles.cardActive
        : styles.cardComplete;
  const visibleSteps = task.steps.slice(-3);

  return (
    <button className={`${styles.taskCard} ${stateClass}`} type="button" onClick={onOpen}>
      <span className={styles.cardGlow} aria-hidden="true" />
      <span className={styles.cardTopline}>
        <span className={styles.agentMark}><Bot /></span>
        <span className={styles.agentName}>{task.agentName}</span>
        <span className={styles.conversationName}>{task.conversationTitle}</span>
        <span className={styles.statusPill}>{statusCopy[task.status]}</span>
      </span>

      <span className={styles.taskTitle}>{task.title}</span>
      <span className={styles.currentLine}>
        {isActive ? <LoaderCircle className={styles.spin} /> : <StepStateIcon status={task.steps[task.steps.length - 1]?.status ?? 'completed'} />}
        <span>{task.currentStep}</span>
        <span className={styles.cardTime}>
          {isActive ? `已用时 ${formatElapsed(now - task.recordedAt)}` : `记录于 ${formatTimestamp(task.recordedAt)}`}
        </span>
      </span>

      <span className={styles.stepPreview}>
        {visibleSteps.map((step) => (
          <span className={`${styles.previewStep} ${styles[`step${step.status}`]}`} key={step.id}>
            <span className={styles.previewIcon}><StepStateIcon status={step.status} /></span>
            <span className={styles.previewLabel}>{step.label}</span>
          </span>
        ))}
      </span>

      <span className={styles.openHint}>{task.completedStepCount}/{task.steps.length} 步 · 点击查看明细 <ChevronRight /></span>
    </button>
  );
};

/** 从消息权威数据投影任务进程；卡片负责摘要，玻璃抽屉承载完整步骤明细。 */
export const TaskProgressWidget: React.FC<{ onInspectorOpenChange?: (open: boolean) => void }> = ({
  onInspectorOpenChange,
}) => {
  const conversations = useConversationStore((state) => state.conversations);
  const taskConversationIds = useMemo(
    () => conversations.filter(isTaskConversation).map((conversation) => conversation.id),
    [conversations],
  );
  const taskMessageLists = useMessageStore(useShallow((state) => (
    selectTaskMessageLists(state.messages, taskConversationIds)
  )));
  const messagesByConversation = useMemo(
    () => Object.fromEntries(taskConversationIds.map((conversationId, index) => [
      conversationId,
      taskMessageLists[index] ?? EMPTY_TASK_MESSAGES,
    ])),
    [taskConversationIds, taskMessageLists],
  );
  const [now, setNow] = useState(() => Date.now());
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) !== '0');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [snapEdges, setSnapEdges] = useState<PanelSnapEdges | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const resizeHandleRef = useRef<HTMLButtonElement>(null);
  const positionRef = useRef<PanelPosition | null>(null);
  const sizeRef = useRef<PanelSize | null>(null);
  const dragMovedRef = useRef(false);
  const suppressLauncherClickRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    origin: PanelPosition;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    pointerX: number;
    pointerY: number;
    origin: PanelSize;
  } | null>(null);
  const closeDetail = useCallback(() => setSelectedId(null), []);

  const applyPanelPosition = useCallback((position: PanelPosition) => {
    positionRef.current = position;
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.setProperty('--task-panel-x', `${position.x}px`);
    panel.style.setProperty('--task-panel-y', `${position.y}px`);
  }, []);

  const applyPanelSize = useCallback((size: PanelSize) => {
    sizeRef.current = size;
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.setProperty('--task-panel-width', `${size.width}px`);
    panel.style.setProperty('--task-panel-height', `${size.height}px`);
  }, []);

  const persistPosition = useCallback((position: PanelPosition) => {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  }, []);

  const persistSize = useCallback((size: PanelSize) => {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  }, []);

  const endActiveGestures = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    const dragHandle = launcherRef.current ?? dragHandleRef.current;
    if (drag && dragHandle?.hasPointerCapture(drag.pointerId)) {
      dragHandle.releasePointerCapture(drag.pointerId);
    }
    const resize = resizeRef.current;
    resizeRef.current = null;
    if (resize && resizeHandleRef.current?.hasPointerCapture(resize.pointerId)) {
      resizeHandleRef.current.releasePointerCapture(resize.pointerId);
    }
    setDragging(false);
    setResizing(false);
    setSnapEdges(null);
  }, []);

  const timeline = useMemo(
    () => projectTaskTimeline(messagesByConversation, conversations),
    [conversations, messagesByConversation],
  );
  const visibleTimeline = useMemo(() => selectTaskPanelItems(timeline), [timeline]);
  const selectedTask = useMemo(
    () => [...timeline.active, ...timeline.completed].find((task) => task.id === selectedId),
    [selectedId, timeline.active, timeline.completed],
  );

  useEffect(() => {
    onInspectorOpenChange?.(Boolean(selectedTask));
    return () => onInspectorOpenChange?.(false);
  }, [onInspectorOpenChange, selectedTask]);

  useEffect(() => {
    if (timeline.active.length === 0) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [timeline.active.length]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const bounds = panel.getBoundingClientRect();
    const restoredPosition = parsePanelPosition(localStorage.getItem(POSITION_KEY));
    const measuredSize = { width: bounds.width, height: bounds.height };
    const restoredSize = collapsed ? null : parsePanelSize(localStorage.getItem(SIZE_KEY));
    const initial = collapsed
      ? {
          position: clampPanelPosition(
            restoredPosition ?? { x: bounds.left, y: bounds.top },
            { width: window.innerWidth, height: window.innerHeight },
            measuredSize,
          ),
          size: measuredSize,
        }
      : clampPanelGeometry(
          restoredPosition ?? { x: bounds.left, y: bounds.top },
          restoredSize ?? DEFAULT_PANEL_SIZE,
          { width: window.innerWidth, height: window.innerHeight },
        );
    const initialPosition = avoidPanelCollision(
      initial.position,
      { width: window.innerWidth, height: window.innerHeight },
      initial.size,
      getComposerExclusionRect(),
    );
    applyPanelPosition(initialPosition);
    if (!collapsed) applyPanelSize(initial.size);
    if (restoredPosition) persistPosition(initialPosition);
    if (restoredSize) persistSize(initial.size);

    const handleResize = () => {
      endActiveGestures();
      const currentPosition = positionRef.current;
      const currentBounds = panelRef.current?.getBoundingClientRect();
      if (!currentPosition || !currentBounds) return;
      const next = collapsed
        ? {
            position: clampPanelPosition(
              currentPosition,
              { width: window.innerWidth, height: window.innerHeight },
              { width: currentBounds.width, height: currentBounds.height },
            ),
            size: { width: currentBounds.width, height: currentBounds.height },
          }
        : clampPanelGeometry(
            currentPosition,
            sizeRef.current ?? DEFAULT_PANEL_SIZE,
            { width: window.innerWidth, height: window.innerHeight },
          );
      const nextPosition = avoidPanelCollision(
        next.position,
        { width: window.innerWidth, height: window.innerHeight },
        next.size,
        getComposerExclusionRect(),
      );
      applyPanelPosition(nextPosition);
      if (!collapsed) applyPanelSize(next.size);
      persistPosition(nextPosition);
      if (!collapsed) persistSize(next.size);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [applyPanelPosition, applyPanelSize, collapsed, endActiveGestures, persistPosition, persistSize]);

  const handleDragStart = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (!isTaskPanelDragTarget(event.target)) return;
    const panel = panelRef.current;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    const origin = positionRef.current ?? { x: bounds.left, y: bounds.top };
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      origin,
    };
    dragMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!event.currentTarget.matches('[data-task-progress-launcher="true"]')) event.preventDefault();
    setDragging(true);
  };

  const handleDragMove = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.pointerX;
    const deltaY = event.clientY - drag.pointerY;
    if (!dragMovedRef.current && Math.hypot(deltaX, deltaY) < 4) return;
    dragMovedRef.current = true;
    const bounds = panelRef.current?.getBoundingClientRect();
    const size = collapsed
      ? { width: bounds?.width ?? 0, height: bounds?.height ?? 0 }
      : sizeRef.current ?? { width: bounds?.width ?? 0, height: bounds?.height ?? 0 };
    const next = clampPanelPosition(
      {
        x: drag.origin.x + deltaX,
        y: drag.origin.y + deltaY,
      },
      { width: window.innerWidth, height: window.innerHeight },
      size,
    );
    applyPanelPosition(next);
    setSnapEdges(detectPanelSnapEdges(
      next,
      { width: window.innerWidth, height: window.innerHeight },
      size,
    ));
  };

  const handleDragEnd = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = dragMovedRef.current;
    dragMovedRef.current = false;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setSnapEdges(null);
    if (event.currentTarget.matches('[data-task-progress-launcher="true"]') && moved) {
      suppressLauncherClickRef.current = true;
      window.setTimeout(() => { suppressLauncherClickRef.current = false; }, 0);
    }
    if (!moved) return;
    const current = positionRef.current;
    const panelBounds = panelRef.current?.getBoundingClientRect();
    if (!current || !panelBounds) return;
    const currentSize = collapsed
      ? { width: panelBounds.width, height: panelBounds.height }
      : sizeRef.current ?? { width: panelBounds.width, height: panelBounds.height };
    const snapped = snapPanelPosition(
      current,
      { width: window.innerWidth, height: window.innerHeight },
      currentSize,
    );
    const safePosition = avoidPanelCollision(
      snapped,
      { width: window.innerWidth, height: window.innerHeight },
      currentSize,
      getComposerExclusionRect(),
    );
    window.requestAnimationFrame(() => {
      applyPanelPosition(safePosition);
      persistPosition(safePosition);
    });
  };

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    resizeRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      origin: sizeRef.current ?? { width: bounds.width, height: bounds.height },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    setResizing(true);
  };

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    const position = positionRef.current;
    if (!resize || resize.pointerId !== event.pointerId || !position) return;
    const next = clampPanelGeometry(
      position,
      {
        width: resize.origin.width + event.clientX - resize.pointerX,
        height: resize.origin.height + event.clientY - resize.pointerY,
      },
      { width: window.innerWidth, height: window.innerHeight },
    );
    applyPanelPosition(next.position);
    applyPanelSize(next.size);
  };

  const handleResizeEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const currentPosition = positionRef.current;
    const currentSize = sizeRef.current;
    if (currentPosition && currentSize) {
      const safePosition = avoidPanelCollision(
        currentPosition,
        { width: window.innerWidth, height: window.innerHeight },
        currentSize,
        getComposerExclusionRect(),
      );
      applyPanelPosition(safePosition);
      persistPosition(safePosition);
    } else if (currentPosition) persistPosition(currentPosition);
    if (currentSize) persistSize(currentSize);
    setResizing(false);
  };

  const toggleCollapsed = () => {
    endActiveGestures();
    if (positionRef.current) persistPosition(positionRef.current);
    if (sizeRef.current) persistSize(sizeRef.current);
    setSelectedId(null);
    setCollapsed((previous) => {
      const next = !previous;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  };

  const handleLauncherClick = () => {
    if (suppressLauncherClickRef.current) {
      suppressLauncherClickRef.current = false;
      return;
    }
    toggleCollapsed();
  };

  const openTask = (taskId: string) => {
    endActiveGestures();
    if (positionRef.current) persistPosition(positionRef.current);
    if (sizeRef.current) persistSize(sizeRef.current);
    localStorage.setItem(COLLAPSE_KEY, '1');
    setCollapsed(true);
    setSelectedId(taskId);
  };

  if (collapsed) {
    return (
      <>
        <span className={styles.liveRegion} aria-live="polite" aria-atomic="true">
          {visibleTimeline.active.length > 0 ? `${visibleTimeline.active.length} 个任务正在执行` : '当前没有进行中的任务'}
        </span>
        {!selectedTask && (
          <aside
            ref={panelRef}
            className={`${styles.dock} ${dragging ? styles.dockDragging : ''}`}
            aria-label="任务进程"
          >
            <button
              ref={launcherRef}
              className={styles.fab}
              data-task-progress-launcher="true"
              onClick={handleLauncherClick}
              type="button"
              title="拖拽移动，点击展开任务进程"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              onLostPointerCapture={handleDragEnd}
            >
              <span className={styles.fabIcon}><Sparkles /></span>
              <span className={styles.fabText}>任务进程</span>
              <span className={styles.fabCount}>{visibleTimeline.active.length}</span>
            </button>
          </aside>
        )}
        {selectedTask && <TaskInspector task={selectedTask} now={now} onClose={closeDetail} />}
      </>
    );
  }

  return (
    <aside
      ref={panelRef}
      className={`${styles.panel} ${dragging ? styles.panelDragging : ''} ${resizing ? styles.panelResizing : ''}`}
      aria-label="任务进程"
    >
      <span className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {visibleTimeline.active.length > 0 ? `${visibleTimeline.active.length} 个任务正在执行` : '当前没有进行中的任务'}
      </span>
      <div className={styles.ambientOrb} aria-hidden="true" />
      {snapEdges && Object.values(snapEdges).some(Boolean) && (
        <span
          className={`${styles.snapPreview} ${snapEdges.left ? styles.snapLeft : ''} ${snapEdges.right ? styles.snapRight : ''} ${snapEdges.top ? styles.snapTop : ''} ${snapEdges.bottom ? styles.snapBottom : ''}`}
          aria-hidden="true"
        />
      )}
      <div
        ref={dragHandleRef}
        className={`${styles.panelHeader} ${dragging ? styles.panelHeaderDragging : ''}`}
        title="拖拽移动任务进程"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        onLostPointerCapture={handleDragEnd}
      >
        <div className={styles.panelHeading}>
          <span className={styles.panelTitleIcon}><Sparkles /></span>
          <span>
            <span className={styles.panelTitle}>任务进程</span>
            <span className={styles.panelSubtitle}>Agent execution timeline</span>
          </span>
        </div>
        <button className={styles.panelCollapse} onClick={toggleCollapsed} type="button" aria-label="收起任务进程">
          <Minus />
        </button>
      </div>

      <div className={styles.panelContent}>
        <section className={styles.taskSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}><Clock3 /> 进行中</span>
            <span className={styles.sectionCount}>{visibleTimeline.active.length}</span>
          </div>
          <div className={styles.cardListActive}>
            {visibleTimeline.active.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}><CheckCircle2 /></span>
                <strong>当前任务已清空</strong>
                <span>新的 Agent 执行会实时出现在这里</span>
              </div>
            ) : visibleTimeline.active.map((task) => (
              <TaskCard key={task.id} task={task} now={now} onOpen={() => openTask(task.id)} />
            ))}
          </div>
        </section>

        <section className={`${styles.taskSection} ${styles.historySection}`}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}><CheckCircle2 /> 最近完成</span>
            <span className={styles.sectionCount}>{visibleTimeline.completed.length}</span>
          </div>
          <div className={styles.cardListHistory}>
            {visibleTimeline.completed.length === 0 ? (
              <div className={styles.emptyStateCompact}>完成后的任务及步骤明细会保留在这里</div>
            ) : visibleTimeline.completed.map((task) => (
              <TaskCard key={task.id} task={task} now={now} onOpen={() => openTask(task.id)} />
            ))}
          </div>
        </section>
      </div>

      {selectedTask && <TaskInspector task={selectedTask} now={now} onClose={closeDetail} />}
      <button
        ref={resizeHandleRef}
        className={`${styles.resizeHandle} ${resizing ? styles.resizeHandleActive : ''}`}
        type="button"
        aria-label="调整任务进程面板大小"
        title="拖拽调整面板大小"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onLostPointerCapture={handleResizeEnd}
      />
    </aside>
  );
};
