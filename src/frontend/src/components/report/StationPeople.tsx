import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { queryStationPeople } from '@/api/stationValidation';
import type { StationPeopleResult } from '@/types/stationPeople';
import type { SnapshotChartRenderer } from './ReportSnapshotTrends';
import { StationDataTable } from './StationValidationTables';
import { StationScoreEvidence } from './StationScoreEvidence';
import { stationCalendar, stationLevels, stationNumber, stationPercent, stationRatio } from './stationValidationModel';
import styles from './StationValidation.module.css';

export function StationPeople({ reportId, station, dates, isAdmin, renderChart }: {
  reportId: string; station: string; dates: string[]; isAdmin: boolean; renderChart: SnapshotChartRenderer;
}) {
  const [start, setStart] = useState(dates[0] ?? '');
  const [end, setEnd] = useState(dates[dates.length - 1] ?? '');
  const [level, setLevel] = useState('VERY_HIGH');
  const [data, setData] = useState<StationPeopleResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const valid = dates.includes(start) && dates.includes(end) && start <= end;
  const load = useCallback(async (refresh = false) => {
    if (!valid) return;
    const epoch = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await queryStationPeople(reportId, station, start, end, refresh);
      if (request.current === epoch) setData(result);
    } catch (cause) {
      if (request.current === epoch) setError(cause instanceof Error ? cause.message : '用户复购分析失败');
    } finally { if (request.current === epoch) setLoading(false); }
  }, [reportId, station, start, end, valid]);
  useEffect(() => {
    request.current++; setLoading(false); setError(''); setData(null);
    // 日期输入连续变化时只请求最终有效范围，旧范围结果不得覆盖当前选择。
    const timer = valid ? window.setTimeout(() => void load(), 300) : undefined;
    return () => { window.clearTimeout(timer); request.current++; };
  }, [load, valid]);
  const calendar = stationCalendar(start, end);
  const lookup = new Map(data?.days.map((day) => [day.dt, day]));
  const missing = calendar.filter((date) => !dates.includes(date));
  return <><section className={styles.card} aria-label="用户复购与人群重合">
    <h3>用户复购与人群重合</h3>
    <div className={styles.controls}>
      <label>复购开始日期<input type="date" min={dates[0]} max={dates[dates.length - 1]} value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>复购结束日期<input type="date" min={dates[0]} max={dates[dates.length - 1]} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <Button disabled={!valid || loading} loading={loading} onClick={() => void load()}>重新加载复购</Button>
      {isAdmin && <Button disabled={!valid || loading} onClick={() => void load(true)}>重新计算</Button>}
    </div>
    {!valid && <Alert type="warning" message="请选择有数据的日期，开始不能晚于结束。" />}
    {error && <Alert type="error" message={error} description={data ? '重新计算失败，仍显示上次成功结果。' : '没有用人数差、示例数据或部分分页替代真实用户比对。'} action={<Button disabled={loading} onClick={() => void load()}>重试复购</Button>} />}
    {missing.length > 0 && <Alert type="warning" message={`区间缺少 ${missing.length} 个数据日，频次与回访只能依据可查询日期；缺失日不补零。`} />}
    {!data ? <p className={styles.note} role="status">{loading ? '正在读取缓存或比对真实用户身份，页面不接收 DUID 明细…' : error ? '未能加载复购结果，请重试。' : valid ? '正在准备加载复购结果…' : '请选择有效消费区间。'}</p> : <>
      <div className={styles.metrics}>
        <article><span>区间去重消费用户</span><strong>{stationNumber(data.users)}</strong></article>
        <article><span>至少 2 笔消费用户</span><strong>{stationNumber(data.repeat_users)}</strong><small>{stationPercent(stationRatio(data.repeat_users, data.users))}</small></article>
        <article><span>至少 2 天消费用户</span><strong>{stationNumber(data.multi_day_users)}</strong><small>{stationPercent(stationRatio(data.multi_day_users, data.users))}</small></article>
        <article><span>{station === 'ALL' ? '至少 2 站消费用户' : '当前为单站分析'}</span><strong>{station === 'ALL' ? stationNumber(data.cross_station_users) : '—'}</strong><small>{station === 'ALL' ? '所选区间内跨试点场站' : '切换全部场站查看跨站消费'}</small></article>
      </div>
      <StationDataTable title="多次消费用户是什么价敏等级" note="按区间内最后一次消费当日等级归类；消费次数为订单去重数（同一 dt 内 order_id 唯一），同日多单与跨天消费分开统计。"
        headers={['最后消费等级', '去重用户', '消费 1 次', '消费 2 次', '消费 3 次及以上', '至少 2 天消费', ...(station === 'ALL' ? ['至少 2 站消费'] : [])]}
        rows={stationLevels.map(([key, label]) => { const band = data.levels[key]; return [label, band?.users ?? 0, band?.once ?? 0, band?.twice ?? 0, band?.three_plus ?? 0, band?.multi_day ?? 0, ...(station === 'ALL' ? [band?.cross_station ?? 0] : [])]; })} />
      <div className={styles.controls}><label>查看当日价敏人群<select value={level} onChange={(event) => setLevel(event.target.value)}>{stationLevels.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      {renderChart(calendar, [
        { key: 'people-new', label: '历史内首次出现', color: '#356ba2', values: calendar.map((date) => lookup.has(date) ? lookup.get(date)?.levels[level]?.new ?? 0 : NaN) },
        { key: 'people-returning', label: '此前消费过的同一用户', color: '#16877c', values: calendar.map((date) => lookup.has(date) ? lookup.get(date)?.levels[level]?.returning ?? 0 : NaN) },
      ], 'actual')}
      <StationDataTable title="每天是不是同一批人在消费" note="占比以当日所选等级消费用户为分母。过去7天不含当天；历史窗口不足7天时仅使用已有历史，不代表完整留存率。"
        headers={['日期', '当日该等级用户', '历史内首次出现', '此前消费过', '过去7天消费过', '过去7天同等级消费过', '同等级重合占比']}
        rows={data.days.map((day) => { const band = day.levels[level]; const partial = day.week_days_available < 7 ? `（仅覆盖${day.week_days_available}/7天）` : ''; return [day.dt, band?.users ?? 0, band?.new ?? 0, band?.returning ?? 0, day.week_days_available ? `${band?.previous_week ?? 0}${partial}` : '—', day.week_days_available ? `${band?.same_level_week ?? 0}${partial}` : '—', partial ? '—（窗口不完整）' : stationPercent(stationRatio(band?.same_level_week ?? 0, band?.users ?? 0))]; })} />
      <StationDataTable title="每日全部人群回访" note="前一天为严格日历日；没有历史覆盖时，重合人数只是已观测值，不能用于判断真实流失。"
        headers={['日期', '消费用户', '历史内首次出现', '此前消费过', '前一天也消费', '过去7天也消费']}
        rows={data.days.map((day) => [day.dt, day.users, day.new, day.returning, day.previous_available ? day.previous : '—', day.week_days_available ? `${day.previous_week}${day.week_days_available < 7 ? `（仅覆盖${day.week_days_available}/7天）` : ''}` : '—'])} />
    </>}
  </section><StationScoreEvidence reportId={reportId} station={station} start={start} end={end} valid={valid} isAdmin={isAdmin} /></>;
}
