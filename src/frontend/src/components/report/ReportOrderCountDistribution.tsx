import { useEffect, useRef, useState } from 'react';
import { queryReportOrderCohort } from '@/api/report';
import type { ReportAnalyticsResult } from '@/types/report';
import { presentSensitivityDistribution } from '@/views/reportPresentation';
import { ReportCohortComparison } from './ReportCohortComparison';
import { ReportOrderGradeCharts } from './ReportOrderGradeCharts';
import styles from './ReportOrderCountDistribution.module.css';

interface Props {
  preparedGroups?: ReportAnalyticsResult['order_groups'];
  reportId: string;
  date: string;
  cities: string[];
  all: Array<{ label: string; value: number }>;
}

const cohortCacheTTL = 10 * 60 * 1000;
interface CachedCohort { result: ReportAnalyticsResult; expiresAt: number }

export function ReportOrderCountDistribution({ reportId, date, cities, all, preparedGroups }: Props) {
  const [orders, setOrders] = useState('all');
  const [retry, setRetry] = useState(0);
  const [baselineRetry, setBaselineRetry] = useState(0);
  const [baseline, setBaseline] = useState<{ key: string; result?: ReportAnalyticsResult; error?: string }>({ key: '' });
  const [state, setState] = useState<{ key: string; result?: ReportAnalyticsResult; error?: string }>({ key: '' });
  const citiesKey = JSON.stringify([...new Set(cities)].sort());
  const scopeKey = JSON.stringify([reportId, date, citiesKey]);
  // 当前挂载实例只保留一个范围的 12 个固定档位，成功结果至多复用十分钟。
  const cache = useRef<{ scope: string; groups: Record<string, CachedCohort> }>({ scope: scopeKey, groups: {} });
  const cached = (order: string) => {
    const entry = cache.current.scope === scopeKey ? cache.current.groups[order] : undefined;
    return entry && entry.expiresAt > Date.now() ? entry.result : undefined;
  };
  const key = JSON.stringify([reportId, date, citiesKey, orders, retry]);
  const baselineKey = JSON.stringify([reportId, date, citiesKey, baselineRetry]);
  useEffect(() => { cache.current = { scope: scopeKey, groups: {} }; }, [scopeKey]);
  useEffect(() => {
    if (preparedGroups) return;
    let current = true;
    setBaseline({ key: baselineKey });
    void queryReportOrderCohort(reportId, date, 'all', JSON.parse(citiesKey) as string[]).then((result) => {
      if (current) {
        cache.current.groups.all = { result, expiresAt: Date.now() + cohortCacheTTL };
        setBaseline({ key: baselineKey, result });
      }
    }).catch(() => {
      if (current) setBaseline({ key: baselineKey, error: '全部有订单人群的同等级基数查询失败，暂不展示同等级占比。' });
    });
    return () => { current = false; };
  }, [reportId, date, citiesKey, baselineKey, preparedGroups]);
  useEffect(() => {
    if (preparedGroups) return;
    if (orders === 'all') return;
    let current = true;
    const entry = cache.current.groups[orders];
    if (entry && entry.expiresAt > Date.now()) { setState({ key, result: entry.result }); return; }
    setState({ key });
    void queryReportOrderCohort(reportId, date, orders, JSON.parse(citiesKey) as string[]).then((result) => {
      if (current) {
        cache.current.groups[orders] = { result, expiresAt: Date.now() + cohortCacheTTL };
        setState({ key, result });
      }
    }).catch(() => {
      if (current) setState({ key, error: '该组人群查询失败，请重试；未使用旧数据或样本替代。' });
    });
    return () => { current = false; };
  }, [reportId, date, orders, citiesKey, key, preparedGroups]);
  // TTL 只用于下一次切换的复用决策；已展示结果不能因无关重渲染凭空变成加载中。
  const baselineResult = preparedGroups ? { order_cohort: preparedGroups.all } : baseline.key === baselineKey ? baseline.result : cached('all');
  const baselineError = preparedGroups ? undefined : baseline.key === baselineKey ? baseline.error : undefined;
  const result = preparedGroups ? { order_cohort: preparedGroups[orders] } : orders === 'all' ? baselineResult : state.key === key ? state.result : cached(orders);
  const error = preparedGroups || orders === 'all' ? undefined : state.key === key ? state.error : undefined;
  const label = orders === 'all' ? '全部有订单人群' : orders === 'gt10' ? '超过 10 笔订单人群' : `${orders} 笔订单人群`;
  const cohort = result?.order_cohort;
  return <div>
    <div className={styles.toolbar}>
      <label>订单笔数 <select aria-label="订单笔数" value={orders} onChange={(event) => {
        setOrders(event.target.value);
        // 切换时检查分母有效期；过期后也必须更新 all，不能和新分子混算。
        if (!preparedGroups && baseline.key === baselineKey && baseline.result && !cached('all')) setBaselineRetry((value) => value + 1);
      }}>
        <option value="all">全部有订单</option>
        {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1} 笔</option>)}
        <option value="gt10">超过 10 笔</option>
      </select></label>
      <span>快照 {date} · {cities.length ? `${cities.length} 个城市` : '全部城市'}</span>
    </div>
    {baselineError ? <p className={styles.error} role="alert">{baselineError} <button type="button" onClick={() => setBaselineRetry((value) => value + 1)}>重试同等级基数</button></p> : !baselineResult && orders !== 'all' ? <p role="status">同等级基数加载中，占同等级总人数暂显示 —。</p> : null}
    {error ? <p className={styles.error} role="alert">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>重新查询</button></p> : !cohort ? !(orders === 'all' && baselineError) && <p role="status">正在查询{label}的真实人数…</p> : <p className={styles.total} role="status">{label}：<strong>{cohort.user_count.toLocaleString('zh-CN')} 人</strong></p>}
    <ReportOrderGradeCharts items={cohort ? presentSensitivityDistribution(cohort.distribution) : null} baseline={baselineResult?.order_cohort ? presentSensitivityDistribution(baselineResult.order_cohort.distribution) : null} loading={!cohort && !(orders === 'all' ? baselineError : error)} label={label} />
    <ReportCohortComparison key={`${key}:${Boolean(cohort)}`} all={all} orders={cohort ? presentSensitivityDistribution(cohort.distribution) : null} ordersLoading={!cohort && !(orders === 'all' ? baselineError : error)} ordersLabel={label} precision={2} orderGradeTotals={baselineResult?.order_cohort ? presentSensitivityDistribution(baselineResult.order_cohort.distribution) : null} />
  </div>;
}
