import React, { useMemo, useState } from 'react';
import { Button, Drawer, Empty } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import type { MessageBlock, MessageStatus } from '@/types/message';
import { ExecutionTraceChart } from './ExecutionTraceChart';
import { ExecutionTraceEventRow } from './ExecutionTraceEventRow';
import { filterTraceEvents, traceTimeline, traceGeometry, TRACE_LANES, type TraceInput, type TraceLane, type TraceView } from './executionTraceTimeline';
import { TokenUsageSummary } from './TokenUsageSummary';
import styles from './ExecutionTraceButton.module.css';

interface ExecutionTraceButtonProps { blocks: MessageBlock[]; status?: MessageStatus; input?: TraceInput }
export const ExecutionTraceButton: React.FC<ExecutionTraceButtonProps> = ({ blocks, status, input }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [lane, setLane] = useState<TraceLane | 'all'>('all');
  const [view, setView] = useState<TraceView>('time');
  const [selectedId, setSelectedId] = useState<string>();
  const [selectionVersion, setSelectionVersion] = useState(0);
  const events = useMemo(() => traceTimeline(blocks, status, input), [blocks, status, input]);
  const visible = filterTraceEvents(events, lane, query);
  const chart = traceGeometry(events, view);
  const selectEvent = (id: string) => { setSelectedId(id); setSelectionVersion((version) => version + 1); };
  return <>
    <Button type="text" size="small" icon={<BranchesOutlined />} onClick={() => setOpen(true)}>查看执行链路</Button>
    <Drawer title="执行链路" open={open} onClose={() => setOpen(false)} size="min(1180px, 94vw)" rootClassName={styles.drawer}>
      <div className={styles.panel}>
        <div className={styles.overview}>
          <div><h2>执行轨迹</h2><p>模型公开输出与实际 Skill / MCP 调用</p></div>
          <span className={styles.total}>{events.length} 个事件{status === 'streaming' ? ' · 接收中' : ''}</span>
        </div>
        <TokenUsageSummary title="本次回复 Token 用量" usage={blocks.find((block) => block.kind === 'usage')?.usage} />
        <div className={styles.toolbar}>
          <input aria-label="搜索执行事件" placeholder="搜索名称、参数或结果…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="筛选事件类型" value={lane} onChange={(event) => setLane(event.target.value as TraceLane | 'all')}>
            <option value="all">全部类型</option>{TRACE_LANES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <div className={styles.viewSwitch} role="group" aria-label="轨迹视图">
            <button type="button" aria-pressed={chart.mode === 'sequence'} onClick={() => setView('sequence')}>顺序</button>
            <button type="button" aria-pressed={chart.mode === 'time'} disabled={!chart.canTime} title={chart.canTime ? '按观测时间显示' : '无时间戳，无法计算耗时'} onClick={() => setView('time')}>时间</button>
          </div>
        </div>
        {!chart.canTime && <p className={styles.note}>无时间戳或完整时间跨度，当前按顺序展示，无耗时推算。</p>}
        {events.length > 0 && <ExecutionTraceChart events={events} visibleIds={visible.map((event) => event.id)} view={view} selectedId={selectedId} onSelect={selectEvent} />}
        <p className={styles.note}>耗时来自事件观测时间，不代表模型内部推理耗时。Skill 成功表示加载成功，未收到结果不视为成功。</p>
        <div className={styles.listHeading}><strong>事件明细</strong><span>{visible.length} / {events.length}</span></div>
        {!visible.length && <Empty description={events.length ? '没有匹配的事件' : '此回复没有记录到可展示的执行事件。'} />}
        <div className={styles.events} aria-label="事件列表">
          {visible.map((event) => <ExecutionTraceEventRow key={event.id} event={event} selected={selectedId === event.id} selectionVersion={selectionVersion} onSelect={selectEvent} />)}
        </div>
      </div>
    </Drawer>
  </>;
};
