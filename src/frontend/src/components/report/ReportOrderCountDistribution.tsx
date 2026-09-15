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
  const [baselineRetry, setBaselineRetry] = useState(0);
  const [baseline, setBaseline] = useState<{ key: string; result?: ReportAnalyticsResult; error?: string }>({ key: '' });
  const [state, setState] = useState<{ key: string; result?: ReportAnalyticsResult; error?: string }>({ key: '' });
  const citiesKey = JSON.stringify(cities);
  const key = JSON.stringify([reportId, date, citiesKey, orders, retry]);
  const baselineKey = JSON.stringify([reportId, date, citiesKey, baselineRetry]);
  useEffect(() => {
    let current = true;
    setBaseline({ key: baselineKey });
    void queryReportOrderCohort(reportId, date, 'all', JSON.parse(citiesKey) as string[]).then((result) => {
      if (current) setBaseline({ key: baselineKey, result });
    }).catch(() => {
      if (current) setBaseline({ key: baselineKey, error: '全部有订单人群的同等级基数查询失败，暂不展示同等级占比。' });
    });
    return () => { current = false; };
  }, [reportId, date, citiesKey, baselineKey]);
  useEffect(() => {
    if (orders === 'all') return;
    let current = true;
    setState({ key });
    void queryReportOrderCohort(reportId, date, orders, JSON.parse(citiesKey) as string[]).then((result) => {
      if (current) setState({ key, result });
    }).catch(() => {
      if (current) setState({ key, error: '该组人群查询失败，请重试；未使用旧数据或样本替代。' });
    });
    return () => { current = false; };
  }, [reportId, date, orders, citiesKey, key]);
  const baselineResult = baseline.key === baselineKey ? baseline.result : undefined;
  const baselineError = baseline.key === baselineKey ? baseline.error : undefined;
  const result = orders === 'all' ? baselineResult : state.key === key ? state.result : undefined;
  const error = orders === 'all' ? undefined : state.key === key ? state.error : undefined;
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
    <p className={styles.note}>按 order_cnt_180d（标签最近更新时的订单数）筛选，ps_conf &gt; 0、DUID &gt; 0。组内占比 = 该等级人数 ÷ 所选笔数组总人数；占同等级总人数 = 该等级人数 ÷ 全部有订单人群中该等级人数。两者使用相同快照、城市和报表条件。</p>
    {baselineError ? <p className={styles.error} role="alert">{baselineError} <button type="button" onClick={() => setBaselineRetry((value) => value + 1)}>重试同等级基数</button></p> : !baselineResult && orders !== 'all' ? <p role="status">同等级基数加载中，占同等级总人数暂显示 —。</p> : null}
    {error ? <p className={styles.error} role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>重新查询</button></p> : !cohort ? !(orders === 'all' && baselineError) && <p role="status">正在查询{label}的真实人数…</p> : <p className={styles.total} role="status">{label}：<strong>{cohort.user_count.toLocaleString('zh-CN')} 人</strong><span>服务端去重统计 · 分级合计已核对</span></p>}
    <ReportCohortComparison key={`${key}:${Boolean(cohort)}`} all={all} orders={cohort ? presentSensitivityDistribution(cohort.distribution) : null} ordersLabel={label} precision={2} orderGradeTotals={baselineResult?.order_cohort ? presentSensitivityDistribution(baselineResult.order_cohort.distribution) : null} />
  </div>;
}
