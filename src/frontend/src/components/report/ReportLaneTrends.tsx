import { useState } from 'react';
import { Empty } from 'antd';
import { buildObservedCurvePath } from '@/views/reportCurvePath';
import { buildDateTickIndexes, formatChartDateTick } from '@/views/reportPresentation';
import type { SnapshotSeries } from './ReportSnapshotTrends';
import styles from './ReportLaneTrends.module.css';

const compact = (value: number) => value >= 1e8 ? `${Number((value / 1e8).toFixed(2))}亿` : value >= 1e4 ? `${Number((value / 1e4).toFixed(2))}万` : value.toLocaleString('zh-CN');

export function ReportLaneTrends({ labels, series }: { labels: string[]; series: SnapshotSeries[] }) {
  const [active, setActive] = useState<number | null>(null);
  // 排序只依据最近有效人数；各自缩放后映射进同一个绘图区的等高区间。
  const lanes = series.map(item => {
    const values = labels.map((_, index) => item.values[index] ?? NaN);
    const finite = values.filter(Number.isFinite);
    return { ...item, values, latest: finite[finite.length - 1], min: finite.length ? Math.min(...finite) : NaN, max: finite.length ? Math.max(...finite) : NaN };
  }).sort((a, b) => (b.latest ?? -Infinity) - (a.latest ?? -Infinity));
  if (!lanes.length || !lanes.some(lane => lane.latest !== undefined)) return <Empty description="暂无可见趋势数据" />;
  const width = 640, height = 480, left = 100, right = 622, top = 14, bottom = 448;
  const band = (bottom - top) / lanes.length;
  const x = (index: number) => labels.length === 1 ? (left + right) / 2 : left + index * (right - left) / Math.max(1, labels.length - 1);
  const ticks = buildDateTickIndexes(labels.length, right - left);
  return <div className={styles.lanes} onMouseLeave={() => setActive(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chart} role="group" aria-label="价敏人群整合趋势图">
      {ticks.map(index => <g key={index}>
        <line x1={x(index)} x2={x(index)} y1={top} y2={bottom} className={styles.grid} />
        <text x={x(index)} y={height - 8} textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'} className={styles.axis}>{formatChartDateTick(labels[index] ?? '')}</text>
      </g>)}
      {lanes.map((lane, laneIndex) => {
        const bandTop = top + laneIndex * band;
        const y = (value: number) => bandTop + band * (lane.max === lane.min ? .5 : .8 - (value - lane.min) / (lane.max - lane.min) * .6);
        const path = buildObservedCurvePath(labels, lane.values, (value, index) => ({ x: x(index), y: y(value) }));
        return <g key={lane.key} data-series={lane.key} aria-label={`${lane.label}独立趋势`}>
          <text x="4" y={bandTop + band * .5} fill={lane.color} className={styles.name}>{lane.label}</text>
          <text x={left - 10} y={bandTop + band * .2} textAnchor="end" className={styles.axis}>{Number.isFinite(lane.max) ? compact(lane.max) : '—'}</text>
          <text x={left - 10} y={bandTop + band * .8} textAnchor="end" className={styles.axis}>{Number.isFinite(lane.min) ? compact(lane.min) : '—'}</text>
          {path && <path d={path} fill="none" stroke={lane.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
          {lane.values.map((value, index) => Number.isFinite(value) && <circle key={index} cx={x(index)} cy={y(value)} r="2" fill={lane.color}><title>{labels[index]} · {lane.label} {value.toLocaleString('zh-CN')} 人</title></circle>)}
        </g>;
      })}
      {active !== null && active < labels.length && <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} className={styles.guide} />}
      {labels.map((date, index) => {
        const start = index === 0 ? left : (x(index - 1) + x(index)) / 2;
        const end = index === labels.length - 1 ? right : (x(index) + x(index + 1)) / 2;
        return <rect key={date} x={start} y={top} width={end - start} height={bottom - top} className={styles.hit} tabIndex={0} aria-label={`${date} 查看全部价敏人数`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)} />;
      })}
    </svg>
    {active !== null && active < labels.length && <div className={styles.readout} role="status"><strong>{labels[active]}</strong>{lanes.map(lane => <span key={lane.key}>{lane.label}：{Number.isFinite(lane.values[active]) ? `${lane.values[active]!.toLocaleString('zh-CN')} 人` : '无数据'}</span>)}</div>}
  </div>;
}
