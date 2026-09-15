import { useState } from 'react';
import { sensitivityColors } from './ReportCohortComparison';
import styles from './ReportOrderGradeCharts.module.css';

type Item = { label: string; value: number };
interface Props { items: Item[] | null; baseline: Item[] | null; loading: boolean; label: string }
const levels = Object.keys(sensitivityColors);
const count = (value: number) => value.toLocaleString('zh-CN');
const compact = (value: number) => value >= 1e8 ? `${Number((value / 1e8).toFixed(2))}亿` : value >= 1e4 ? `${Number((value / 1e4).toFixed(1))}万` : count(value);

export function ReportOrderGradeCharts({ items, baseline, loading, label }: Props) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const rows = levels.filter((level) => !hidden.includes(level)).map((level) => {
    const value = items ? items.find((item) => item.label === level)?.value ?? 0 : null;
    const denominator = baseline?.find((item) => item.label === level)?.value;
    const people = value !== null && Number.isFinite(value) && value >= 0 ? value : null;
    const total = denominator !== undefined && Number.isFinite(denominator) && denominator > 0 ? denominator : null;
    return { level, people, total, share: people !== null && total !== null && people <= total ? people / total * 100 : null };
  });
  const selected = rows.find((row) => row.level === active);
  const detail = (row: typeof rows[number]) => `${row.level}：${row.people === null ? '—' : count(row.people)} 人 · 占同等级 ${row.share === null ? '—' : `${row.share.toFixed(2)}%`} · 同等级基数 ${row.total === null ? '—' : count(row.total)} 人`;
  const ceiling = Math.max(1, ...rows.map((row) => row.people ?? 0));
  return <section className={styles.section} aria-label="订单人数与同等级占比" aria-busy={loading}>
    <div className={styles.header}><h3>订单人数与同等级占比</h3><span>{label}</span></div>
    <fieldset className={styles.filters}><legend>价敏等级</legend>{levels.map((level) => <label key={level}>
      <input type="checkbox" aria-label={`显示${level}`} checked={!hidden.includes(level)} onChange={() => setHidden((old) => old.includes(level) ? old.filter((item) => item !== level) : [...old, level])} />
      <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill={sensitivityColors[level]} /></svg>{level.replace('价敏', '')}
    </label>)}<button type="button" onClick={() => setHidden([])}>全选</button></fieldset>
    {loading ? <p className={styles.empty}>正在加载真实统计…</p> : !items ? <p className={styles.empty}>暂无可用人数统计</p> : !rows.length ? <p className={styles.empty}>请选择至少一个价敏等级，或点击全选恢复。</p> : <div className={styles.charts}>
      {(['people', 'share'] as const).map((metric) => {
        const title = metric === 'people' ? '各等级人数' : '同等级占比';
        const max = metric === 'people' ? ceiling : 100;
        return <div className={styles.chart} key={metric}><h4>{title}<span>{metric === 'people' ? '单位：人' : '单位：%'}</span></h4><div className={styles.scroll}>
          <svg viewBox="0 0 540 300" className={styles.plot} aria-label={`${title}柱状图`}>
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => <g key={tick}><line x1="60" x2="530" y1={248 - tick * 206} y2={248 - tick * 206} className={styles.grid} /><text x="53" y={253 - tick * 206} textAnchor="end" className={styles.axis}>{metric === 'people' ? compact(max * tick) : `${tick * 100}%`}</text></g>)}
            {rows.map((row, index) => {
              const value = row[metric]; const x = 60 + (index + 0.5) * 470 / rows.length;
              const height = value === null ? 0 : value / max * 206;
              const aria = `${title} ${detail(row).split(' · ').join('，')}`;
              return <g key={row.level} role="button" tabIndex={0} aria-label={aria} className={styles.bar} onMouseEnter={() => setActive(row.level)} onFocus={() => setActive(row.level)} onClick={() => setActive(row.level)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(row.level); } }}>
                <title>{detail(row)}</title><rect x={x - 25} y="24" width="50" height="254" fill="transparent" />
                {value !== null && value > 0 && <rect x={x - 18} y={248 - height} width="36" height={height} rx="4" fill={sensitivityColors[row.level]} />}
                <text x={x} y={value === null || value === 0 ? 238 : 238 - height} textAnchor="middle" className={styles.number}>{value === null ? '—' : metric === 'people' ? compact(value) : `${value.toFixed(2)}%`}</text>
                <text x={x} y="275" textAnchor="middle" className={styles.axis}>{row.level.replace('价敏', '')}</text>
              </g>;
            })}
          </svg></div></div>;
      })}
    </div>}
    <p className={styles.readout} role="status">{!loading && items && selected ? detail(selected) : '悬停、点击或聚焦柱形查看人数与同等级占比'}</p>
  </section>;
}
