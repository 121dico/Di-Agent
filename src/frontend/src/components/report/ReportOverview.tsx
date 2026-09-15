import type { FC } from 'react';
import type { ReportAnalyticsResult } from '@/types/report';
import { SnapshotGrowthMetrics } from './ReportSnapshotGrowth';
import local from './ReportOverview.module.css';

const number = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
const share = (value: number | undefined, total: number) => value !== undefined && Number.isFinite(value) && total > 0 ? `${number(value / total * 100)}%` : '—';

interface ReportOverviewProps { analytics: ReportAnalyticsResult }

/** 仅使用已加载快照，不额外查询，不把缺失分数当作零。 */
export const ReportOverview: FC<ReportOverviewProps> = ({ analytics }) => {
  const { summary, order_cohort: orders } = analytics;
  const snapshot = analytics.trend.find(point => point.dt === analytics.data_date);
  const mean = summary.calculated_user_count === 0 ? null : snapshot?.nullable_scores ? snapshot.nullable_scores.price : summary.average_price_sensitivity_score;
  const grade = (level: string) => analytics.distribution.length
    ? analytics.distribution.find(item => item.level === level)?.user_count ?? 0
    : summary.calculated_user_count === 0 ? 0 : undefined;
  const prior = analytics.assigned_by_type ? analytics.assigned_by_type.PRIOR ?? 0 : undefined;
  const high = grade('HIGH');
  const veryHigh = grade('VERY_HIGH');
  const metrics = [
    { label: '全量用户', value: summary.total_user_count, unit: '人', note: '当前标签快照人群' },
    { label: '已赋分用户', value: summary.calculated_user_count, unit: '人', note: `覆盖全量 ${share(summary.calculated_user_count, summary.total_user_count)}` },
    { label: '有订单人群', value: orders?.user_count, unit: '人', note: `ps_conf > 0 · 占全量 ${share(orders?.user_count, summary.total_user_count)}` },
    { label: '价敏均分', value: mean, unit: '分', note: '已赋分人群平均分' },
    { label: '极高价敏', value: veryHigh, unit: '人', note: `VERY_HIGH · 占已赋分 ${share(veryHigh, summary.calculated_user_count)}` },
    { label: '高价敏', value: high, unit: '人', note: `HIGH · 占已赋分 ${share(high, summary.calculated_user_count)}` },
    { label: '画像订单量', value: summary.total_order_count, unit: '笔', note: '标签更新时 180 天订单计数汇总' },
    { label: '先验赋分人群', value: prior, unit: '人', note: `PRIOR · 占已赋分 ${share(prior, summary.calculated_user_count)}` },
  ];
  return <div className={local.overview}>
    <div className={local.grid} aria-label="当前快照指标">
      {metrics.map(metric => <article key={metric.label} className={local.metric} data-overview-metric={metric.label}>
        <span>{metric.label}</span>
        <strong>{number(metric.value)}{number(metric.value) !== '—' && <small>{metric.unit}</small>}</strong>
      </article>)}
    </div>
    <div className={local.growth} aria-label="快照增长概览"><SnapshotGrowthMetrics analytics={analytics} compact /></div>
  </div>;
};
