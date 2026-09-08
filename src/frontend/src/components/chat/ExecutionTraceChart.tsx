import React from 'react';
import { TRACE_LANES, traceDuration, traceGeometry, type TraceTimelineEvent, type TraceView } from './executionTraceTimeline';
import styles from './ExecutionTraceButton.module.css';

interface ExecutionTraceChartProps {
  events: TraceTimelineEvent[];
  visibleIds: string[];
  view: TraceView;
  selectedId?: string;
  onSelect: (id: string) => void;
}
export const ExecutionTraceChart: React.FC<ExecutionTraceChartProps> = ({ events, visibleIds, view, selectedId, onSelect }) => {
  const chart = traceGeometry(events, view);
  return <section className={styles.chart} aria-label="执行轨迹泳道">
    <div className={styles.ruler}><span>{chart.mode === 'time' ? '观测时间' : '事件顺序'}</span><span>{chart.mode === 'time' ? '0 s' : '#1'}</span><span>{chart.mode === 'time' ? traceDuration(chart.spanMs!) : `#${events.length}`}</span></div>
    {TRACE_LANES.map((lane) => {
      const segments = chart.segments.filter(({ event }) => event.lane === lane.id && visibleIds.includes(event.id));
      const timed = segments.filter((segment) => chart.mode !== 'time' || !segment.untimed);
      const trackEnds: number[] = [];
      const stacked = timed.map((segment) => {
        let track = trackEnds.findIndex((end) => end <= segment.x);
        if (track === -1) track = trackEnds.length;
        trackEnds[track] = segment.x + segment.width + 2;
        return { ...segment, track };
      });
      const trackHeight = Math.max(1, trackEnds.length) * 28;
      const untimed = chart.mode === 'time' ? segments.filter((segment) => segment.untimed) : [];
      return <div className={styles.laneRow} key={lane.id} data-lane={lane.id}>
        <span className={styles.laneLabel}><i />{lane.label}</span>
        <div className={styles.laneTrack}>
          <svg viewBox={`0 0 1000 ${trackHeight}`} height={trackHeight} preserveAspectRatio="none" aria-label={`${lane.label}泳道`}>
            {[250, 500, 750].map((x) => <line key={x} x1={x} x2={x} y1="0" y2={trackHeight} className={styles.gridLine} />)}
            {stacked.map(({ event, x, width, track }) => <rect
              key={event.id} x={x} y={track * 28 + 5} width={width} height="18" rx="3"
              className={`${styles.segment} ${selectedId === event.id ? styles.segmentSelected : ''}`}
              role="button" tabIndex={0} aria-label={`定位事件：${event.label}`} aria-pressed={selectedId === event.id}
              onClick={() => onSelect(event.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(event.id); } }}
            ><title>{`#${event.order + 1} ${event.label}${event.durationMs !== undefined ? ` · 观测耗时 ${traceDuration(event.durationMs)}` : ' · 未记录耗时'}`}</title></rect>)}
          </svg>
          {untimed.length > 0 && <div className={styles.untimed}>{untimed.map(({ event }) => <button key={event.id} type="button" onClick={() => onSelect(event.id)} aria-label={`定位事件：${event.label}`}>#{event.order + 1} {event.label} · 无时间戳</button>)}</div>}
        </div>
      </div>;
    })}
    <p className={styles.chartHint}>{chart.mode === 'time' ? '条宽表示记录到的时间跨度；无时间戳事件单列显示，不推算耗时。' : '按真实事件顺序等宽排列；条宽不表示耗时。'}</p>
  </section>;
};
