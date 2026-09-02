import React, { type CSSProperties, type KeyboardEvent, type PointerEvent, useMemo, useState } from 'react';
import { Button, Spin } from 'antd';
import { AlertCircle, BarChart3, Check, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import { usePersonalReportStore } from '@/store/personalReportStore';
import { PersonalReportPreview } from './PersonalReportPreview';
import styles from './PersonalReportComposer.module.css';

interface Props {
  conversationId: string;
}

const stylePresets = [
  { id: 'business', label: '商务简约', detail: '清晰 · 克制' },
  { id: 'journal', label: '数据新闻', detail: '结论 · 叙事' },
  { id: 'soft', label: '柔和现代', detail: '温和 · 易读' },
  { id: 'glass', label: '亮色玻璃', detail: '轻盈 · 精致' },
];

const DEFAULT_WIDTH = 560;
const WIDTH_STORAGE_KEY = 'di-agent-personal-report-width';

function initialWidth(): number {
  const stored = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) && stored >= 420 ? stored : Math.round(window.innerWidth * .45);
}

export const PersonalReportComposer: React.FC<Props> = ({ conversationId }) => {
  const reports = usePersonalReportStore((state) => state.reports);
  const activeReport = usePersonalReportStore((state) => state.activeReport);
  const loading = usePersonalReportStore((state) => state.loading);
  const saving = usePersonalReportStore((state) => state.saving);
  const error = usePersonalReportStore((state) => state.error);
  const selectReport = usePersonalReportStore((state) => state.selectReport);
  const updateStyle = usePersonalReportStore((state) => state.updateStyle);
  const loadReports = usePersonalReportStore((state) => state.loadReports);
  const closeWorkspace = usePersonalReportStore((state) => state.closeWorkspace);
  const [fullscreen, setFullscreen] = useState(false);
  const [width, setWidth] = useState(initialWidth);
  const [dragging, setDragging] = useState(false);

  const conversationReports = reports.filter((report) =>
    !report.conversation_id || report.conversation_id === conversationId,
  );

  const composerStyle = useMemo(() => ({ '--personal-report-width': `${width}px` }) as CSSProperties, [width]);

  const applyWidth = (nextWidth: number) => {
    const maximum = Math.max(420, Math.min(820, window.innerWidth - 420));
    const clamped = Math.max(420, Math.min(maximum, nextWidth));
    setWidth(clamped);
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
  };

  const handleResizeMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    applyWidth(window.innerWidth - event.clientX);
  };

  const handleResizeKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applyWidth(width + 24);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      applyWidth(width - 24);
    } else if (event.key === 'Home') {
      event.preventDefault();
      applyWidth(Math.round(window.innerWidth * .45) || DEFAULT_WIDTH);
    }
  };

  return (
    <aside
      className={`${styles.composer} ${fullscreen ? styles.fullscreen : ''} ${dragging ? styles.dragging : ''}`}
      style={composerStyle}
      aria-label="个人报表工作区"
    >
      {!fullscreen && (
        <button
          className={styles.resizeHandle}
          type="button"
          role="separator"
          aria-label="调整个人报表宽度"
          aria-orientation="vertical"
          aria-valuemin={420}
          aria-valuemax={820}
          aria-valuenow={width}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={handleResizeMove}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
            setDragging(false);
          }}
          onPointerCancel={() => setDragging(false)}
          onDoubleClick={() => applyWidth(DEFAULT_WIDTH)}
          onKeyDown={handleResizeKey}
        />
      )}
      <header className={styles.toolbar}>
        <div className={styles.titleGroup}>
          <span className={styles.titleIcon}><BarChart3 size={17} /></span>
          <div>
            <strong>{activeReport?.title || '个人报表'}</strong>
            <span>{activeReport ? `第 ${activeReport.revision} 版 · 与当前 Agent 对话关联` : '与当前 Agent 对话关联'}</span>
          </div>
        </div>
        <div className={styles.toolbarActions}>
          {activeReport && <span className={`${styles.saveState} ${saving ? styles.saving : ''}`} aria-live="polite"><i />{saving ? '正在保存' : '已保存'}</span>}
          {activeReport && (
            <Button
              className={styles.fullscreenButton}
              type="text"
              icon={fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              aria-label={fullscreen ? '退出个人报表全屏' : '全屏查看个人报表'}
              aria-pressed={fullscreen}
              onClick={() => setFullscreen((value) => !value)}
            />
          )}
          <Button type="text" icon={<X size={16} />} aria-label="关闭个人报表工作区" onClick={closeWorkspace} />
        </div>
      </header>

      {conversationReports.length > 1 && (
        <nav className={styles.reportTabs} aria-label="当前对话的个人报表">
          {conversationReports.map((report) => (
            <button
              key={report.id}
              type="button"
              aria-current={activeReport?.id === report.id ? 'page' : undefined}
              onClick={() => selectReport(report)}
            >
              {report.title}
            </button>
          ))}
        </nav>
      )}

      {activeReport && (
        <section className={styles.styleStrip} aria-label="报表风格">
          <header><div><strong>报表风格</strong><span>只改变表达，不改变真实数据</span></div></header>
          <div className={styles.styleOptions}>
            {stylePresets.map((preset) => {
              const selected = activeReport.style_preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-style={preset.id}
                  aria-pressed={selected}
                  disabled={saving}
                  onClick={() => void updateStyle(preset.id)}
                >
                  <span className={styles.stylePreview}><i /><i /><i /></span>
                  <span><strong>{preset.label}</strong><small>{preset.detail}</small></span>
                  {selected && <Check size={13} />}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className={styles.content}>
        {error && activeReport && (
          <div className={styles.inlineError} role="status">
            <AlertCircle size={14} /><span>{error}</span><button type="button" onClick={() => void loadReports()}>重新同步</button>
          </div>
        )}
        {loading && !activeReport ? (
          <div className={styles.status}><Spin size="small" /><span>正在读取个人报表</span></div>
        ) : error && !activeReport ? (
          <div className={styles.status} role="alert">
            <span className={styles.statusIcon}><AlertCircle size={21} /></span>
            <strong>个人报表加载失败</strong>
            <span>{error}</span>
            <Button icon={<RefreshCw size={14} />} onClick={() => void loadReports()}>重新加载</Button>
          </div>
        ) : (
          <PersonalReportPreview report={activeReport} />
        )}
      </div>
    </aside>
  );
};
