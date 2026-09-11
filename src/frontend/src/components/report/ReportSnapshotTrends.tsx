import { useState, type ReactNode } from 'react';
import { Empty } from 'antd';
import type { ReportAnalyticsResult } from '@/types/report';
import { presentSensitivityDistribution } from '@/views/reportPresentation';
import type { ReportScaleMode } from '@/views/reportTrendScale';
import styles from '@/views/ReportsView.module.css';
import local from './ReportCohortSections.module.css';

export interface SnapshotSeries { key: string; label: string; color: string; values: number[] }
export type SnapshotChartRenderer = (labels: string[], series: SnapshotSeries[], mode?: ReportScaleMode) => ReactNode;
const colors: Record<string, string> = { 极高价敏: '#A63437', 高价敏: '#D75A50', 中高价敏: '#DB843C', 中价敏: '#D79A2B', 中低价敏: '#259F9A', 低价敏: '#4B78D1', 极低价敏: '#7B9ECA', 未赋分: '#8B8E95' };

export function ReportSnapshotTrends({ analytics, renderChart }: { analytics: ReportAnalyticsResult | null; renderChart: SnapshotChartRenderer }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [modes, setModes] = useState<Record<string, ReportScaleMode>>({});
  const labels: string[] = [];
  if (analytics) {
    for (let time = Date.parse(`${analytics.start_date}T00:00:00Z`); time <= Date.parse(`${analytics.end_date}T00:00:00Z`); time += 86400000) labels.push(new Date(time).toISOString().slice(0, 10));
  }
  const points = new Map(analytics?.trend.map((point) => [point.dt, point]));
  const people: SnapshotSeries[] = [
    { key: 'all', label: '全量用户', color: '#2F6FDB', values: labels.map((date) => points.get(date)?.total_user_count ?? NaN) },
    { key: 'orders', label: '有订单用户（ps_conf > 0）', color: '#15857A', values: labels.map((date) => points.get(date)?.order_user_count ?? NaN) },
  ];
  const distribution = (order: boolean): SnapshotSeries[] => {
    const field = order ? 'order_distribution' : 'distribution';
    const levels = presentSensitivityDistribution([...new Set(analytics?.trend.flatMap((point) => point[field]?.map((item) => item.level) ?? []))].map((level) => ({ level, user_count: 0 })));
    return levels.map((level) => ({ key: `${order ? 'order' : 'all'}-${level.label}`, label: level.label, color: colors[level.label] ?? '#8B8E95', values: labels.map((date) => {
      const point = points.get(date);
      if (!point) return NaN;
      return presentSensitivityDistribution(point[field] ?? []).find((item) => item.label === level.label)?.value ?? 0;
    }) }));
  };
  const chart = (title: string, series: SnapshotSeries[]) => {
    const mode = modes[title] ?? 'trend';
    return <div className={`${styles.card} ${local.compactTrendCard}`}>
    <div className={local.chartHeader}>
      <div className={styles.cardTitle}><div><i />{title}</div></div>
      <div className={local.chartModeSwitch} role="group" aria-label={`${title}展示模式`}>
        <button type="button" aria-pressed={mode === 'trend'} onClick={() => setModes((current) => ({ ...current, [title]: 'trend' }))}>趋势对比</button>
        <button type="button" aria-pressed={mode === 'actual'} onClick={() => setModes((current) => ({ ...current, [title]: 'actual' }))}>真实数值</button>
      </div>
    </div>
    <div className={local.legend}>{series.map((item) => <button key={item.key} type="button" aria-pressed={!hidden.has(item.key)} onClick={() => setHidden((current) => {
      const next = new Set(current); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next;
    })}><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill={hidden.has(item.key) ? '#bbb' : item.color} /></svg>{item.label}</button>)}</div>
    {analytics?.trend.length ? renderChart(labels, series.filter((item) => !hidden.has(item.key)), mode) : <Empty description="正在读取每日 dt 快照统计" />}
  </div>;
  };
  return <section className={`${styles.summaryBlock} ${styles.fullWidthBlock}`} id="report-trend">
    <div className={styles.blockHead}><div><span>04</span><strong>每日标签快照趋势</strong></div><small>{analytics?.start_date} → {analytics?.end_date}</small></div>
    <div className={local.snapshotGrid}>
      {chart('每日人群规模', people)}
      {chart('全量人群 · 每日价敏分布', distribution(false))}
      {chart('有订单人群 · 每日价敏分布', distribution(true))}
    </div>
  </section>;
}
