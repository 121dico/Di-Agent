import type { ReportAnalyticsRange, ReportAnalyticsResult } from '@/types/report';

type Query = (id: string, range: ReportAnalyticsRange | 'dates' | 'saved', end?: string, cities?: string[]) => Promise<ReportAnalyticsResult>;
export interface SnapshotProgress { completed: number; total: number; failed: string[] }

// V1.2 首日快照不可靠：只限制报表展示，不删除源数据或持久快照。
const FIRST_RELIABLE_SNAPSHOT = '2026-07-29';
const reliableStart = (date: string) => date < FIRST_RELIABLE_SNAPSHOT ? FIRST_RELIABLE_SNAPSHOT : date;

/** Latest first, one bounded upstream day at a time. Never sum users across snapshots. */
export async function loadSnapshotHistory(
  query: Query, id: string, range: ReportAnalyticsRange, cities: string[],
  publish: (result: ReportAnalyticsResult | null, progress: SnapshotProgress) => void,
  active: () => boolean = () => true,
  retained?: ReportAnalyticsResult,
): Promise<void> {
  const directory = await query(id, 'dates', undefined, cities);
  if (!active()) return;
  const available = [...new Set(directory.available_dates ?? [])].filter(date => date >= FIRST_RELIABLE_SNAPSHOT).sort();
  const end = available[available.length - 1];
  if (!end) throw new Error('当前筛选下没有可用的 dt 分区');
  const start = reliableStart(range === 'all' ? available[0]! : new Date(Date.parse(`${end}T00:00:00Z`) - (Number.parseInt(range, 10) - 1) * 86400000).toISOString().slice(0, 10));
  const dates = available.filter((date) => date >= start);
  // A withdrawn latest partition invalidates its overview as well as its point.
  const retainedPoints = retained?.data_date && dates.includes(retained.data_date) ? retained.trend.filter((point) => dates.includes(point.dt)) : [];
  const retainedDates = new Set(retainedPoints.map((point) => point.dt));
  const results: ReportAnalyticsResult[] = retained && retainedPoints.length ? [{...retained, trend: retainedPoints}] : [];
  const failed: string[] = [];
  let completed = retainedDates.size;
  let lastError = '';
  const publishCurrent = () => {
    const latest = [...results].sort((a,b)=>(b.data_date??'').localeCompare(a.data_date??''))[0];
    const trend = results.flatMap((result) => result.trend).sort((a, b) => a.dt.localeCompare(b.dt));
    publish(latest ? { ...latest, range, start_date: start, end_date: end, available_dates: dates, trend,
      missing_dates: failed.slice(), query_ids: results.flatMap((result) => result.query_ids ?? []) } : null,
    { completed, total: dates.length, failed: failed.slice() });
  };
  publishCurrent();
  for (const date of [...dates].reverse()) {
    if (!active()) return;
    if (retainedDates.has(date)) continue;
    try {
      const result = await query(id, '1d', date, cities);
      if (!active()) return;
      if (!result.trend?.some((point) => point.dt === date)) throw new Error('分区聚合未返回该日数据');
      results.push(result);
    } catch (error) {
      if (!active()) return;
      failed.push(date);
      lastError = error instanceof Error ? error.message : '读取失败';
    }
    completed++;
    publishCurrent();
  }
  if (failed.length) throw new Error(`${failed.length} 个 dt 统计失败（${failed.join('、')}）；已保留成功日期。${lastError}`);
}

/** One authenticated stored-report read replaces N daily requests on revisit. */
export async function loadStoredSnapshotHistory(
 query: Query, id: string, range: ReportAnalyticsRange, cities: string[],
 publish: (result: ReportAnalyticsResult | null, progress: SnapshotProgress) => void,
 active: () => boolean = () => true,
): Promise<void> {
 const saved = await query(id,'saved',undefined,cities);
 if(!active())return;
 if(saved.data_date && saved.data_date >= FIRST_RELIABLE_SNAPSHOT && saved.trend?.length) {
  const start=reliableStart(range==='all' ? saved.start_date : new Date(Date.parse(`${saved.data_date}T00:00:00Z`)-(Number.parseInt(range,10)-1)*86400000).toISOString().slice(0,10));
  const trend=saved.trend.filter(point=>point.dt>=start);
  publish({...saved,range,start_date:start,trend,available_dates:saved.available_dates?.filter(date=>date>=start),missing_dates:saved.missing_dates?.filter(date=>date>=start)},{completed:trend.length,total:trend.length,failed:[]});
 }
 await loadSnapshotHistory(query,id,range,cities,publish,active,saved);
}
