import type { ReactNode } from 'react';
import { Empty } from 'antd';
import type { ReportAnalyticsResult } from '@/types/report';
import type { SnapshotChartRenderer } from './ReportSnapshotTrends';
import styles from '@/views/ReportsView.module.css';
import local from './ReportCohortSections.module.css';

const day = 86400000;
function snapshotGrowth(analytics: ReportAnalyticsResult) {
  const points = new Map(analytics.trend.filter((point) => point.dt >= analytics.start_date && point.dt <= analytics.end_date).map((point) => [point.dt, point]));
  const dates = [...points.keys()].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const baseline = first ? points.get(first)?.calculated_user_count : undefined;
  const labels: string[] = [];
  for (let time = Date.parse(analytics.start_date); time <= Date.parse(analytics.end_date); time += day) labels.push(new Date(time).toISOString().slice(0, 10));
  // 缓存每个单日的增量均为零，必须从组装后的快照人数重算。
  const daily = labels.map((date) => {
    const current = points.get(date);
    if (!current) return NaN;
    if (date === first) return 0;
    const previous = points.get(new Date(Date.parse(date) - day).toISOString().slice(0, 10));
    return previous ? current.calculated_user_count - previous.calculated_user_count : NaN;
  });
  const cumulative = labels.map((date) => points.has(date) && baseline !== undefined ? points.get(date)!.calculated_user_count - baseline : NaN);
  const rates = labels.map((date, i) => {
    if (date === first) return 0;
    const previous = points.get(new Date(Date.parse(date) - day).toISOString().slice(0, 10));
    return previous && previous.calculated_user_count > 0 ? daily[i]! / previous.calculated_user_count * 100 : NaN;
  });
  const latestIndex = last ? labels.indexOf(last) : -1;
  const changes = daily.filter((value, i) => labels[i] !== first && Number.isFinite(value));
  const latest = last ? points.get(last) : undefined;
  const total = latest?.total_user_count;
  return { labels, daily, cumulative, rates, first, last, pairCount: changes.length,
    net: cumulative[latestIndex] ?? NaN,
    latestNet: dates.length > 1 ? daily[latestIndex] ?? NaN : NaN,
    latestRate: dates.length > 1 ? rates[latestIndex] ?? NaN : NaN,
    average: changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : NaN,
    coverage: latest && total !== undefined && total > 0 ? latest.calculated_user_count / total * 100 : NaN,
  };
}

export function SnapshotGrowthMetrics({ analytics }: { analytics: ReportAnalyticsResult }) {
  const growth = snapshotGrowth(analytics);
  const format = (value: number, percent = false) => Number.isFinite(value) ? `${!percent && value > 0 ? '+' : ''}${percent ? Number(value.toFixed(2)) : Math.round(value).toLocaleString('zh-CN')}` : '—';
  const metrics = [
    { label: '本期累计净增', value: growth.net },
    { label: '最近一日净增', value: growth.latestNet },
    { label: '最近一日增长率', value: growth.latestRate, percent: true },
    { label: '日均净增', value: growth.average },
    { label: '价敏赋分覆盖率', value: growth.coverage, percent: true },
  ];
  return <>{metrics.map((item) => <article key={item.label} className={styles.metricCard} data-direction={item.value > 0 ? 'up' : item.value < 0 ? 'down' : 'flat'}>
    <span>{item.label}</span><strong>{format(item.value, item.percent)}<small>{Number.isFinite(item.value) ? item.percent ? '%' : '人' : ''}</small></strong>
  </article>)}</>;
}

export function ReportSnapshotGrowth({ analytics, renderChart, renderBar }: {
  analytics: ReportAnalyticsResult | null;
  renderChart: SnapshotChartRenderer;
  renderBar: (labels: string[], values: number[]) => ReactNode;
}) {
  const growth = analytics ? snapshotGrowth(analytics) : null;
  return <section className={`${styles.summaryBlock} ${styles.fullWidthBlock}`} id="report-increments">
    <div className={styles.blockHead}><div><span>02</span><strong>增量分析</strong></div><small>{growth?.first} → {growth?.last} · 当前城市筛选</small></div>
    <p className={local.note}>按 dt 快照中 ps_score 非空的人数计算（含先验赋分），不是首次新增用户，也不是当天订单用户。首个可用快照为基线；日均净增按 {growth?.pairCount ?? 0} 个连续日对计算。缺失日期不补零，真实负值不隐藏。</p>
    {!growth?.first ? <Empty description="尚无可用快照" /> : <div className={styles.chartGrid}>
      <div className={`${styles.card} ${styles.trendCard}`}>
        <div className={styles.cardTitle}><div><i />每日价敏用户净增</div><small>当天已赋分人数 − 前一日已赋分人数 · 单位：人</small></div>
        {renderBar(growth.labels, growth.daily)}
      </div>
      <div className={`${styles.card} ${styles.incrementAnalysisCard}`}>
        <div className={styles.cardTitle}><div><i />累计与增长效率</div><small>不重复累计存量用户 · 横轴：dt</small></div>
        <div className={styles.volumeTrendGrid}>
          <section className={styles.volumeTrendPanel}><header><span>累计净增</span><small>相对首个可用快照 · 单位：人</small></header>
            {renderChart(growth.labels, [{ key: 'cumulativeNet', label: '累计净增（人）', color: '#15857A', values: growth.cumulative }])}
          </section>
          <section className={styles.volumeTrendPanel}><header><span>每日增长率</span><small>当日净增 ÷ 前一日已赋分人数 · 单位：%</small></header>
            {renderChart(growth.labels, [{ key: 'growthRate', label: '每日增长率（%）', color: '#765BC4', values: growth.rates }])}
          </section>
        </div>
      </div>
    </div>}
  </section>;
}
