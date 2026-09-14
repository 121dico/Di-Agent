import { useEffect, useState } from 'react';
import { queryReportOrderCohort } from '@/api/report';
import type { ReportAnalyticsResult } from '@/types/report';
import { presentSensitivityDistribution } from '@/views/reportPresentation';
import { ReportCohortComparison } from './ReportCohortComparison';
import styles from './ReportOrderCountDistribution.module.css';

interface Props {
  reportId: string;
  date: string;
  cities: string[];
  all: Array<{ label: string; value: number }>;
}

export function ReportOrderCountDistribution({ reportId, date, cities, all }: Props) {
  const [orders, setOrders] = useState('all');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; result?: ReportAnalyticsResult; error?: string }>({ key: '' });
  const citiesKey = JSON.stringify(cities);
  const key = JSON.stringify([reportId, date, citiesKey, orders, retry]);
  useEffect(() => {
    let current = true;
    setState({ key });
    void queryReportOrderCohort(reportId, date, orders, JSON.parse(citiesKey) as string[]).then((result) => {
      if (current) setState({ key, result });
    }).catch(() => {
      if (current) setState({ key, error: '该组人群查询失败，请重试；未使用旧数据或样本替代。' });
    });
    return () => { current = false; };
  }, [reportId, date, orders, citiesKey, key]);
  const result = state.key === key ? state.result : undefined;
  const error = state.key === key ? state.error : undefined;
  const label = orders === 'all' ? '全部有订单人群' : orders === 'gt10' ? '超过 10 笔订单人群' : `${orders} 笔订单人群`;
  const cohort = result?.order_cohort;
  return <div>
    <div className={styles.toolbar}>
      <label>订单笔数 <select aria-label="订单笔数" value={orders} onChange={(event) => setOrders(event.target.value)}>
        <option value="all">全部有订单</option>
        {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1} 笔</option>)}
        <option value="gt10">超过 10 笔</option>
      </select></label>
      <span>快照 {date} · {cities.length ? `${cities.length} 个城市` : '全部城市'}</span>
    </div>
    <p className={styles.note}>按 order_cnt_180d（标签最近更新时的订单数）筛选，ps_conf &gt; 0、DUID &gt; 0。占比 = 各等级人数 ÷ 当前所选人群总数。</p>
    {error ? <p className={styles.error} role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>重新查询</button></p> : !cohort ? <p role="status">正在查询{label}的真实人数…</p> : <p className={styles.total} role="status">{label}：<strong>{cohort.user_count.toLocaleString('zh-CN')} 人</strong><span>服务端去重统计 · 分级合计已核对</span></p>}
    <ReportCohortComparison key={`${key}:${Boolean(cohort)}`} all={all} orders={cohort ? presentSensitivityDistribution(cohort.distribution) : null} ordersLabel={label} precision={2} />
  </div>;
}
