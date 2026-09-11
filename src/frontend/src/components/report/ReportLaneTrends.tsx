import { useState } from 'react';
import { Empty } from 'antd';
import { buildObservedCurvePath } from '@/views/reportCurvePath';
import type { SnapshotSeries } from './ReportSnapshotTrends';
import styles from './ReportLaneTrends.module.css';

const compact = (value: number) => value >= 1e8 ? `${Number((value / 1e8).toFixed(2))}亿` : value >= 1e4 ? `${Number((value / 1e4).toFixed(2))}万` : value.toLocaleString('zh-CN');

export function ReportLaneTrends({ labels, series }: { labels: string[]; series: SnapshotSeries[] }) {
  const [active, setActive] = useState<number | null>(null);
  // 仅排序可见曲线，不修改原始序列；末日缺失时使用最近一次真实观测人数。
  const lanes = series.map(item => {
    const values = labels.map((_, index) => item.values[index] ?? NaN);
    const finite = values.filter(Number.isFinite);
    return { ...item, values, latest: finite.at(-1), min: finite.length ? Math.min(...finite) : NaN, max: finite.length ? Math.max(...finite) : NaN };
  }).sort((a, b) => (b.latest ?? -Infinity) - (a.latest ?? -Infinity));
  if (!lanes.length || !lanes.some(lane => lane.latest !== undefined)) return <Empty description="暂无可见趋势数据" />;
  const x = (index: number) => labels.length === 1 ? 300 : 8 + index * 584 / Math.max(1, labels.length - 1);
  return <div className={styles.lanes} onMouseLeave={() => setActive(null)}>
    {lanes.map(lane => {
      const y = (value: number) => lane.max === lane.min ? 40 : 70 - (value - lane.min) / (lane.max - lane.min) * 60;
      const path = buildObservedCurvePath(labels, lane.values, (value, index) => ({ x: x(index), y: y(value) }));
      const value = active === null ? lane.latest : lane.values[active];
      return <section className={styles.lane} key={lane.key} aria-label={`${lane.label}独立趋势`}>
        <header><span><i style={{ background: lane.color }} />{lane.label}</span><strong>{value !== undefined && Number.isFinite(value) ? `${compact(value)} 人` : '—'}</strong></header>
        <div className={styles.plot}>
          <div className={styles.bounds}><span>{Number.isFinite(lane.max) ? compact(lane.max) : '—'}</span><span>{Number.isFinite(lane.min) ? compact(lane.min) : '—'}</span></div>
          <svg viewBox="0 0 600 80" preserveAspectRatio="none" role="group" aria-label={`${lane.label}人数趋势`}>
            {[10, 70].map(row => <line key={row} x1="8" x2="592" y1={row} y2={row} className={styles.grid} />)}
            {path && <path d={path} fill="none" stroke={lane.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
            {lane.values.map((value, index) => Number.isFinite(value) && <circle key={index} cx={x(index)} cy={y(value)} r="2" fill={lane.color}><title>{labels[index]} · {lane.label} {value.toLocaleString('zh-CN')} 人</title></circle>)}
            {active !== null && active < labels.length && <line x1={x(active)} x2={x(active)} y1="5" y2="75" className={styles.guide} />}
            {labels.map((date, index) => {
              const left = index === 0 ? 0 : (x(index - 1) + x(index)) / 2;
              const right = index === labels.length - 1 ? 600 : (x(index) + x(index + 1)) / 2;
              return <rect key={date} x={left} y="0" width={right - left} height="80" className={styles.hit} tabIndex={0} aria-label={`${date} ${lane.label} ${Number.isFinite(lane.values[index]) ? lane.values[index]!.toLocaleString('zh-CN') + ' 人' : '无数据'}`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)} />;
            })}
          </svg>
        </div>
      </section>;
    })}
    <div className={styles.dates}><span>{labels[0]}</span><span>{labels.at(-1)}</span></div>
    {active !== null && active < labels.length && <div className={styles.readout} role="status"><strong>{labels[active]}</strong>{lanes.map(lane => <span key={lane.key}>{lane.label}：{Number.isFinite(lane.values[active]) ? `${lane.values[active]!.toLocaleString('zh-CN')} 人` : '无数据'}</span>)}</div>}
  </div>;
}
