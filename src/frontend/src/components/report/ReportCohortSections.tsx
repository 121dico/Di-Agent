import { useState, type ReactNode } from 'react';
import { Alert, Empty, Spin } from 'antd';
import type { ReportAnalyticsResult } from '@/types/report';
import { presentSensitivityDistribution } from '@/views/reportPresentation';
import styles from '@/views/ReportsView.module.css';
import local from './ReportCohortSections.module.css';

interface Props {
  analytics: ReportAnalyticsResult | null;
  loading: boolean;
  error: string;
  renderDistribution: (items: Array<{ label: string; value: number }>, hidden: Set<string>, onToggle: (label: string) => void, label: string) => ReactNode;
}

const pendingMetrics = [
  { title: '首次新增标签用户', reason: '需首次入库日期，或完整相邻快照的 DUID 集合比较；标签更新日期不是首次日期。' },
  { title: '当天有订单用户', reason: '需按真实订单发生日期去重 DUID，包含新老用户；账单入库日不能替代。' },
  { title: '当天新增订单', reason: '需按真实订单发生日期去重订单 ID；180天滚动订单数的差值不是每日订单量。' },
  { title: '新增人群价敏分布', reason: '需将上述两类人群分别匹配当日标签后统计；不会用全量分布代替。' },
];

export function ReportCohortSections({ analytics, loading, error, renderDistribution }: Props) {
  const [hiddenAll, setHiddenAll] = useState<Set<string>>(() => new Set());
  const [hiddenOrders, setHiddenOrders] = useState<Set<string>>(() => new Set());
  const toggle = (current: Set<string>, label: string) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  };
  const available = analytics && analytics.data_date;
  const allDistribution = presentSensitivityDistribution(analytics?.distribution ?? []);
  const unassigned = analytics ? analytics.summary.total_user_count - analytics.summary.calculated_user_count : 0;
  if (unassigned > 0) allDistribution.push({ label: '未赋分', value: unassigned });
  const cohort = analytics?.order_cohort;
  const metric = (label: string, value: string, suffix: string) => <article className={styles.metricCard}><span>{label}</span><strong>{value}<small>{suffix}</small></strong></article>;

  return <>
    <section className={`${styles.summaryBlock} ${styles.overviewBlock}`} id="report-overview">
      {error && <Alert type="warning" showIcon message="统计数据暂未生成" description={error} />}
      <div className={styles.blockHead}><div><span>01</span><strong>全量人群</strong></div><small>标签快照 {analytics?.data_date || '—'}</small></div>
      <p className={local.note}>当前城市筛选内的完整标签人群，包含先验赋分与历史继承用户；不跨快照累加人数。</p>
      <Spin spinning={loading}>
        {available ? <>
          <div className={styles.metrics}>
            {metric('全量用户数', analytics.summary.total_user_count.toLocaleString('zh-CN'), '人')}
            {metric('已赋价敏分用户', analytics.summary.calculated_user_count.toLocaleString('zh-CN'), '人')}
          </div>
          <div className={`${styles.card} ${local.distribution}`}>
            <div className={styles.cardTitle}><div><i />全量价敏分布</div></div>
            {renderDistribution(allDistribution, hiddenAll, (label) => setHiddenAll((current) => toggle(current, label)), '全量用户')}
          </div>
        </> : <Empty description="尚无可用统计" />}
      </Spin>
    </section>

    <section className={`${styles.summaryBlock} ${styles.trendBlock}`} id="report-order-cohort">
      <div className={styles.blockHead}><div><span>02</span><strong>有订单人群</strong></div><small>订单置信度 ps_conf &gt; 0</small></div>
      <p className={local.note}>以标签最近刷新时保留的置信度为准，不等同于今日重新计算的180天活跃人群。分布分母仅为本组用户。</p>
      <Spin spinning={loading}>
        {available && cohort ? <div className={local.cohortGrid}>
          <div className={local.cohortMetrics}>
            {metric('有订单用户数', cohort.user_count.toLocaleString('zh-CN'), '人')}
            {metric('占全量人群', `${Number(cohort.share.toFixed(2))}%`, '')}
          </div>
          <div className={styles.card}>
            <div className={styles.cardTitle}><div><i />有订单人群价敏分布</div><small>点击图例或扇区可显隐</small></div>
            {renderDistribution(presentSensitivityDistribution(cohort.distribution), hiddenOrders, (label) => setHiddenOrders((current) => toggle(current, label)), '有订单用户')}
          </div>
        </div> : <Empty description="尚无可用统计" />}
      </Spin>
    </section>

    <section className={`${styles.summaryBlock} ${styles.fullWidthBlock}`} id="report-trend">
      <div className={styles.blockHead}><div><span>03</span><strong>每日新增</strong></div><small>日粒度数据未接入，不代表 0</small></div>
      <p className={local.note}>首次新增标签用户与当天有订单用户分别统计，两类人群可能重叠，不直接相加。当前 API 尚未提供所需日粒度指标。</p>
      <div className={local.pendingGrid}>{pendingMetrics.map((item) => <article className={styles.card} key={item.title}>
        <h3>{item.title}</h3><span className={local.pending}>待接入</span><p className={local.note}>{item.reason}</p>
      </article>)}</div>
    </section>
  </>;
}
