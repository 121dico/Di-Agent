import type { ReactNode } from 'react';
import type { StationValidationResult } from '@/types/stationValidation';
import { stationLevels, stationSelection, stationLevelCount as count, stationNumber as n, stationPercent as pct, stationRatio as ratio, stationDelta as delta, stationSigned as signed, stationPreviousDate } from './stationValidationModel';
import styles from './StationValidation.module.css';

export function StationDataTable({ title, note, headers, rows }: { title: string; note: string; headers: string[]; rows: ReactNode[][] }) {
  return <section className={styles.card}><h3>{title}</h3><p className={styles.note}>{note}</p><div className={styles.tableScroll} tabIndex={0} role="region" aria-label={title}><table><thead><tr>{headers.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table></div></section>;
}

const DataTable = StationDataTable;

export function StationValidationTables({ data, id, start, end, baseline, range, onStation }: {
  data: StationValidationResult; id: string; start: string; end: string; baseline: string; range: boolean; onStation: (id: string) => void;
}) {
  const view = stationSelection(data, id, start, end, baseline);
  const { current, previous, base, rows, userDays } = view;
  const stations = [...new Map(data.rows.filter((r) => r.station_id !== 'ALL').map((r) => [r.station_id, r.station_name])).entries()];
  const ranking = stations.map(([sid, name]) => ({ sid, name, ...stationSelection(data, sid, end, end, baseline) }))
    .sort((a, b) => (delta(a.current?.users, a.base?.users) || 0) - (delta(b.current?.users, b.base?.users) || 0));
  return <>
    <DataTable title="价敏分布比较" note={`查看日 ${end} · 前一天 ${stationPreviousDate(end)} · 基准日 ${baseline}。区间占比以用户日加权，不平均每日百分比。`}
      headers={['价敏等级', '查看日人数', '查看日占比', '前一天人数', '较前一天变化', '基准日人数', '较基准人数变化', '较基准占比变化（百分点）', ...(range ? ['区间用户日', '区间占比'] : [])]}
      rows={stationLevels.map(([key, label]) => {
        const total = rows.reduce((sum, row) => sum + (count(row, key) ?? 0), 0);
        return [label, n(count(current, key)), pct(ratio(count(current, key), current?.users)), n(count(previous, key)), signed(delta(count(current, key), count(previous, key))), n(count(base, key)), signed(delta(count(current, key), count(base, key))), signed((ratio(count(current, key), current?.users) - ratio(count(base, key), base?.users)) * 100), ...(range ? [n(total), pct(ratio(total, userDays))] : [])];
      })} />
    <DataTable title="各站人数变化" note="按较基准日人数变化排序。点击场站切换全部图表；各站人数不能相加替代当天跨站去重人数。"
      headers={['场站', '查看日人数', '前一天人数', '较前一天变化', '环比', '基准日人数', '较基准变化', '较基准变化率']}
      rows={ranking.map((row) => [<button type="button" className={styles.stationLink} onClick={() => onStation(row.sid)}>{row.name}<small>{row.sid}</small></button>, n(row.current?.users), n(row.previous?.users), signed(delta(row.current?.users, row.previous?.users)), pct(ratio(delta(row.current?.users, row.previous?.users), row.previous?.users)), n(row.base?.users), signed(delta(row.current?.users, row.base?.users)), pct(ratio(delta(row.current?.users, row.base?.users), row.base?.users))])} />
    <DataTable title="每日人数与七档分布" note="人数是每日有消费的去重用户，不是新增用户。缺失日期不填零；人数下降不等于用户标签被移除。"
      headers={['日期', '人数', '较前一天变化', '环比', '较基准变化', ...stationLevels.map(([, label]) => `${label} 人数 / 占比`)]}
      rows={rows.map((row) => {
        const prev = view.lookup.get(stationPreviousDate(row.dt));
        return [row.dt, n(row.users), signed(delta(row.users, prev?.users)), pct(ratio(delta(row.users, prev?.users), prev?.users)), signed(delta(row.users, base?.users)), ...stationLevels.map(([key]) => <>{n(count(row, key))} 人<small>{pct(ratio(count(row, key), row.users))}</small></>)];
      })} />
  </>;
}
