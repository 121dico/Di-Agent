import React, { useEffect, useRef } from 'react';
import { traceDuration, type TraceTimelineEvent } from './executionTraceTimeline';
import styles from './ExecutionTraceButton.module.css';

interface ExecutionTraceEventRowProps { event: TraceTimelineEvent; selected: boolean; selectionVersion: number; onSelect: (id: string) => void }
const STATES = { recorded: '已记录', running: '进行中', success: '成功', error: '失败', unconfirmed: '未收到结果' };
export const ExecutionTraceEventRow: React.FC<ExecutionTraceEventRowProps> = ({ event, selected, selectionVersion, onSelect }) => {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (selected && details.current) {
      details.current.open = true;
      details.current.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    }
  }, [selected, selectionVersion]);
  const call = event.call;
  const observedAt = event.startedAt ? new Date(event.startedAt) : undefined;
  const clockTime = observedAt && Number.isFinite(observedAt.getTime()) && observedAt.getUTCFullYear() > 1
    ? `${observedAt.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}.${String(observedAt.getMilliseconds()).padStart(3, '0')}`
    : undefined;
  const durationLabel = event.durationMs !== undefined ? `耗时 ${traceDuration(event.durationMs)}`
    : event.phase === 'input' ? '输入事件' : event.phase === 'result' ? '结果返回' : event.phase === 'error' ? '错误事件' : '耗时未采集';
  const kind = event.lane === 'input' ? '输入' : event.lane === 'model' ? '输出' : call?.tool_kind === 'skill' ? 'Skill' : call?.tool_kind === 'mcp' ? 'MCP' : '工具';
  return <details ref={details} className={`${styles.eventRow} ${selected ? styles.eventSelected : ''}`} data-lane={event.lane}>
    <summary onClick={() => { if (!selected) onSelect(event.id); }}>
      <span className={styles.eventOrder}>{String(event.order + 1).padStart(2, '0')}</span>
      <span className={styles.eventKind}>{kind}</span>
      <span className={styles.eventLabel}>{event.label}<small>{call?.server_name || event.text.replace(/\s+/g, ' ').slice(0, 100)}</small></span>
      <span className={styles.eventState} data-state={event.state}>{STATES[event.state]}</span>
      <span className={styles.eventDuration}><time dateTime={clockTime ? event.startedAt : undefined} title={event.startedAt}>{clockTime || '时间未采集'}</time><small>{durationLabel}</small></span>
    </summary>
    <div className={styles.eventDetail}>
      {event.startedAt && <p className={styles.note}>观测时间：{event.startedAt}{event.durationMs !== undefined ? ` · 观测耗时 ${traceDuration(event.durationMs)}` : ''}</p>}
      {call?.server_name && <p>服务：{call.server_name}</p>}
      {call?.source_path && <p>来源：<code>{call.source_path}</code></p>}
      {call?.tool_use_id && <p className={styles.note}>调用 ID：{call.tool_use_id}</p>}
      {event.phase === 'call' ? <>
        <h4>调用参数</h4><pre>{event.text || '未记录输入'}</pre>
        <h4>返回结果</h4><pre>{event.result ? event.result.text || '已返回结果（无文本输出）' : '尚未收到工具结果'}</pre>
      </> : <><h4>{event.phase === 'result' ? '返回结果' : event.label}</h4><pre>{event.text || '无文本输出'}</pre></>}
    </div>
  </details>;
};
