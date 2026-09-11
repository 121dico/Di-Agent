import type { ReactNode } from 'react';
import { Alert, Empty, Spin } from 'antd';
import type { ReportAnalyticsResult } from '@/types/report';
import { presentSensitivityDistribution } from '@/views/reportPresentation';
import styles from '@/views/ReportsView.module.css';
import local from './ReportCohortSections.module.css';
import { ReportSnapshotTrends, type SnapshotChartRenderer } from './ReportSnapshotTrends';
import { ReportSnapshotGrowth, SnapshotGrowthMetrics } from './ReportSnapshotGrowth';
import { ReportCohortComparison } from './ReportCohortComparison';

interface Props {
  analytics: ReportAnalyticsResult | null;
  loading: boolean;
  error: string;
  progress?: string;
  renderChart?: SnapshotChartRenderer;
  renderGrowthChart?: SnapshotChartRenderer;
  renderBar?: (labels: string[], values: number[]) => ReactNode;
  renderDistribution: (items: Array<{ label: string; value: number }>, hidden: Set<string>, onToggle: (label: string) => void, label: string) => ReactNode;
}

export function ReportCohortSections({ analytics, loading, error, renderChart, renderGrowthChart, renderBar }: Props) {
  const available = analytics && analytics.data_date;
  const allDistribution = presentSensitivityDistribution(analytics?.distribution ?? []);
  const unassigned = analytics ? analytics.summary.total_user_count - analytics.summary.calculated_user_count : 0;
  if (unassigned > 0) allDistribution.push({ label: '未赋分', value: unassigned });
  const cohort = analytics?.order_cohort;
  const metric = (label: string, value: string, suffix: string) => <article className={styles.metricCard}><span>{label}</span><strong>{value}<small>{suffix}</small></strong></article>;

  return <>
    <section className={`${styles.summaryBlock} ${styles.overviewBlock}`} id="report-overview">
      {error && <Alert type="warning" showIcon message={available ? '部分 dt 统计失败，已保留成功数据' : '统计数据暂未生成'} description={error} />}
      <div className={styles.blockHead}><div><span>01</span><strong>指标概览 · 全量人群</strong></div><small>标签快照 {analytics?.data_date || '—'}</small></div>
      <Spin spinning={loading && !available}>
        {available ? <>
          <div className={styles.metrics}>
            {metric('已赋价敏分用户', analytics.summary.calculated_user_count.toLocaleString('zh-CN'), '人')}
            <SnapshotGrowthMetrics analytics={analytics} />
          </div>
        </> : <Empty description="尚无可用统计" />}
      </Spin>
    </section>

    <section className={`${styles.summaryBlock} ${styles.fullWidthBlock}`} id="report-order-cohort">
      <div className={styles.blockHead}><div><span>02</span><strong>价敏人群分布对比</strong></div><small>全量人群 / 有订单人群（ps_conf &gt; 0）</small></div>
      <Spin spinning={loading && !available}>
        {available ? <>
          {cohort && <div className={styles.metrics}>
            {metric('有订单用户数', cohort.user_count.toLocaleString('zh-CN'), '人')}
            {metric('占全量人群', `${Number(cohort.share.toFixed(2))}%`, '')}
          </div>}
          <div className={`${styles.card} ${local.distribution}`}>
            <ReportCohortComparison all={allDistribution} orders={cohort ? presentSensitivityDistribution(cohort.distribution) : null} />
          </div>
        </> : <Empty description="尚无可用统计" />}
      </Spin>
    </section>

    {renderGrowthChart && renderBar && <ReportSnapshotGrowth analytics={analytics} renderChart={renderGrowthChart} renderBar={renderBar} />}
    {renderChart && <ReportSnapshotTrends analytics={analytics} renderChart={renderChart} />}
  </>;
}
