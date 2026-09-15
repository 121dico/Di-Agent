import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Spin } from 'antd';
import { queryStationValidation } from '@/api/stationValidation';
import type { StationValidationResult } from '@/types/stationValidation';
import type { SnapshotChartRenderer, SnapshotSeries } from './ReportSnapshotTrends';
import { StationValidationTables } from './StationValidationTables';
import { StationPeople } from './StationPeople';
import { stationCalendar, stationSelection, stationNumber as n, stationSigned as signed, stationPercent as pct, stationRatio as ratio, stationDelta as delta } from './stationValidationModel';
import shared from '@/views/ReportsView.module.css';
import styles from './StationValidation.module.css';

export function StationValidation({ reportId, isAdmin, renderChart }: { reportId: string; isAdmin: boolean; renderChart: SnapshotChartRenderer }) {
  const [data, setData] = useState<StationValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [station, setStation] = useState('ALL');
  const [mode, setMode] = useState('day');
  const [day, setDay] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [baseline, setBaseline] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const epoch = useRef(0);
  const controls = useRef<HTMLDivElement>(null);
  const first = data?.available_dates[0] ?? '';
  const last = data?.available_dates[data.available_dates.length - 1] ?? '';
  const load = useCallback(async (refresh = false) => {
    const request = ++epoch.current;
    setLoading(true); setError('');
    try {
      const result = await queryStationValidation(reportId, refresh);
      if (epoch.current !== request) return;
      setData(result);
      setStation((old) => old === 'ALL' || result.rows.some((row) => row.station_id === old) ? old : 'ALL');
      const firstDay = result.available_dates[0] ?? '';
      const lastDay = result.available_dates[result.available_dates.length - 1] ?? '';
      setDay((old) => result.available_dates.includes(old) ? old : lastDay);
      setStart((old) => result.available_dates.includes(old) ? old : firstDay);
      setEnd((old) => result.available_dates.includes(old) ? old : lastDay);
      setBaseline((old) => result.available_dates.includes(old) ? old : firstDay);
    } catch (cause) {
      if (epoch.current === request) setError(cause instanceof Error ? cause.message : '数据验证加载失败');
    } finally { if (epoch.current === request) setLoading(false); }
  }, [reportId]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  const stations = useMemo(() => [...new Map(data?.rows.filter((row) => row.station_id !== 'ALL').map((row) => [row.station_id, row.station_name]) ?? []).entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN')), [data]);
  const found = stations.filter(([id, name]) => `${id} ${name}`.toLowerCase().includes(search.trim().toLowerCase()));
  const visibleStations = found.some(([id]) => id === station) || station === 'ALL' ? found : [...found, ...stations.filter(([id]) => id === station)];
  const range = mode === 'range';
  const from = range ? start : day;
  const to = range ? end : day;
  const valid = !!data && data.available_dates.includes(from) && data.available_dates.includes(to) && data.available_dates.includes(baseline) && from <= to;
  const view = data && valid ? stationSelection(data, station, from, to, baseline) : null;
  const reset = () => { setSearch(''); setStation('ALL'); setMode('day'); setDay(last); setStart(first); setEnd(last); setBaseline(first); setHidden([]); };
  const chooseStation = (id: string) => { setStation(id); setSearch(''); controls.current?.scrollIntoView({ block: 'start', behavior: 'auto' }); controls.current?.querySelector('select')?.focus(); };
  const dateControl = (label: string, value: string, change: (value: string) => void) => <label>{label}<input type="date" min={first} max={last} value={value} onChange={(event) => change(event.target.value)} /></label>;
  const seriesChart = (title: string, labels: string[], series: SnapshotSeries[]) => <section className={styles.card}>
    <h3>{title}</h3><div className={styles.legend}>{series.map((item) => <button type="button" key={item.key} data-series={item.key} aria-pressed={!hidden.includes(item.key)} onClick={() => setHidden((old) => old.includes(item.key) ? old.filter((key) => key !== item.key) : [...old, item.key])}>{item.label}</button>)}</div>
    {renderChart(labels, series.filter((s) => !hidden.includes(s.key)), 'actual')}
  </section>;
  const labels = view ? stationCalendar(range ? from : first, to) : [];
  return <section className={`${shared.summaryBlock} ${shared.fullWidthBlock} ${styles.root}`} id="report-station-validation" aria-label="数据验证">
    <div className={shared.blockHead}><div><span>验证</span><strong>数据验证</strong></div><Button disabled={loading} onClick={() => void load(isAdmin)}>{isAdmin ? '刷新验证数据' : '重新加载'}</Button></div>
    {error && <Alert type="error" showIcon message={error} description={data ? '刷新未成功，下面仍为上次成功读取的数据。' : '未使用离线样例或模拟数据代替真实查询。'} action={<Button onClick={() => void load(isAdmin)}>重试</Button>} />}
    <Spin spinning={loading} tip="正在读取试点站聚合数据"><div aria-busy={loading}>
      {!data ? <div className={styles.empty}>{loading ? '首次读取后将保存汇总，重新进入无需逐日初始化。' : '暂无验证结果'}</div> : data.available_dates.length === 0 ? <Empty description="接口尚无可查询的订单日期" /> : <>
        <div className={styles.controls} ref={controls}>
          <label>搜索场站<input type="search" placeholder="输入站名或站点ID" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label>统计范围<select value={station} onChange={(event) => setStation(event.target.value)}><option value="ALL">全部 {stations.length} 站（当天跨站去重）</option>{visibleStations.map(([id, name]) => <option value={id} key={id}>{name} · {id}</option>)}</select></label>
          <label>查看方式<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="day">单日比较</option><option value="range">日期区间</option></select></label>
          {range ? <>{dateControl('区间开始', start, setStart)}{dateControl('区间结束', end, setEnd)}</> : dateControl('查看日期', day, setDay)}
          {dateControl('基准日', baseline, setBaseline)}<Button onClick={reset}>重置</Button>
        </div>
        {search && <p className={styles.note} role="status">找到 {found.length} 个场站；搜索仅筛选选项，请选择场站查看。</p>}
        {!valid ? <Alert type="warning" message="请选择有数据的有效日期，区间开始不能晚于结束。" /> : view && <>
          {view.missing.length > 0 && <Alert type="warning" message={`有 ${view.missing.length} 天缺失：${view.missing.join('、')}；曲线断开，区间统计仅包含已返回日期。`} />}
          <div className={styles.metrics}>
            <article><span>查看日消费人数</span><strong>{n(view.current?.users)}</strong><small>前一天 {n(view.previous?.users)} 人</small></article>
            <article><span>较前一天变化</span><strong>{signed(delta(view.current?.users, view.previous?.users))}</strong><small>{pct(ratio(delta(view.current?.users, view.previous?.users), view.previous?.users))}</small></article>
            <article><span>较基准日变化</span><strong>{signed(delta(view.current?.users, view.base?.users))}</strong><small>{pct(ratio(delta(view.current?.users, view.base?.users), view.base?.users))} · 基准 {n(view.base?.users)} 人</small></article>
            <article><span>{range ? '区间日均消费人数' : '当天高＋极高人数'}</span><strong>{range ? n(ratio(view.userDays, view.rows.length), 1) : n(view.current ? (view.current.levels.HIGH ?? 0) + (view.current.levels.VERY_HIGH ?? 0) : undefined)}</strong><small>{range ? `${view.rows.length} 个数据日 · ${n(view.userDays)} 用户日` : ''}</small></article>
          </div>
          <div className={styles.charts}>
            {seriesChart('每日消费人数', labels, [{ key: 'validation-users', label: '消费人数（人）', color: '#356ba2', values: labels.map((date) => view.lookup.get(date)?.users ?? NaN) }])}
            {seriesChart('价敏组成趋势', labels, [
              { key: 'validation-high', label: '高＋极高（%）', color: '#b74848', values: labels.map((date) => { const row = view.lookup.get(date); return row ? ratio((row.levels.HIGH ?? 0) + (row.levels.VERY_HIGH ?? 0), row.users) * 100 : NaN; }) },
              { key: 'validation-low', label: '低＋极低（%）', color: '#64748b', values: labels.map((date) => { const row = view.lookup.get(date); return row ? ratio((row.levels.LOW ?? 0) + (row.levels.VERY_LOW ?? 0), row.users) * 100 : NaN; }) },
            ])}
          </div>
          <StationValidationTables data={data} id={station} start={from} end={to} baseline={baseline} range={range} onStation={chooseStation} />
          <StationPeople key={data.fetched_at} reportId={reportId} station={station} dates={data.available_dates} isAdmin={isAdmin} renderChart={renderChart} />
        </>}
      </>}
    </div></Spin>
  </section>;
}
