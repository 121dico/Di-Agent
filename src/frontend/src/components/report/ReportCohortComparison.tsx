import { useState } from 'react';
import { Empty } from 'antd';
import styles from './ReportCohortComparison.module.css';

type Item = { label: string; value: number };
const colors: Record<string, string> = { 极高价敏: '#A63437', 高价敏: '#D75A50', 中高价敏: '#DB843C', 中价敏: '#D79A2B', 中低价敏: '#259F9A', 低价敏: '#4B78D1', 极低价敏: '#7B9ECA' };
const count = (value: number) => value.toLocaleString('zh-CN');
const compactCount = (value: number) => value >= 100000000 ? `${Number((value / 100000000).toFixed(2))}亿` : value >= 10000 ? `${Number((value / 10000).toFixed(1))}万` : count(value);

export function ReportCohortComparison({ all, orders }: { all: Item[]; orders: Item[] | null }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  const groups = [{ key: 'all', title: '全量人群', items: all }, { key: 'orders', title: '有订单人群', items: orders }];
  const labels = [...new Set([...all, ...(orders ?? [])].map((item) => item.label))];
  const toggle = (key: string) => setHidden((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const totals = groups.map((group) => group.items?.reduce((sum, item) => sum + item.value, 0) ?? 0);
  return <div className={styles.layout}>
    <div className={styles.charts}>{groups.map((group, index) => {
      const total = totals[index] ?? 0;
      const activeItem = group.items?.find((item) => `${group.key}:${item.label}` === active);
      let consumed = 0;
      return <section className={styles.chart} key={group.key} aria-label={`${group.title}价敏分布`}>
        <h3>{group.title}</h3><p>{group.items ? `${count(total)} 人` : '尚无可用统计'}</p>
        {group.items && total > 0 ? <svg viewBox="0 0 260 260" aria-label={`${group.title}环形图`}>
          <circle cx="130" cy="130" r="84" fill="none" stroke="var(--wb-surface-hover)" strokeWidth="30" />
          <g transform="rotate(-90 130 130)">{group.items.filter((item) => item.value > 0).map((item) => {
            const key = `${group.key}:${item.label}`;
            const length = item.value / total * 2 * Math.PI * 84;
            const offset = -consumed; consumed += length;
            return <circle key={key} cx="130" cy="130" r="84" fill="none" stroke={hidden.has(key) ? '#DDE1E7' : colors[item.label] ?? '#8B8E95'} strokeWidth={active === key ? 35 : 30}
              strokeDasharray={`${length} ${2 * Math.PI * 84 - length}`} strokeDashoffset={offset} className={styles.sector}
              role="button" tabIndex={0} aria-pressed={!hidden.has(key)} aria-label={`${group.title} ${item.label}`}
              onClick={() => toggle(key)} onMouseEnter={() => setActive(key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(key)} onBlur={() => setActive(null)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(key); } }}>
              <title>{`${item.label}：${count(item.value)} 人 · ${(item.value / total * 100).toFixed(1)}%`}</title>
            </circle>;
          })}</g>
          <text x="130" y="128" textAnchor="middle" className={styles.value}>{compactCount(activeItem?.value ?? total)}</text>
          <text x="130" y="151" textAnchor="middle" className={styles.caption}>{activeItem?.label ?? group.title}</text>
        </svg> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={group.items ? '暂无分布数据' : '订单人群统计未加载'} />}
        {group.items && total > 0 && <p className={styles.readout} role="status">{activeItem ? `${activeItem.label}：${count(activeItem.value)} 人 · ${(activeItem.value / total * 100).toFixed(1)}%` : ''}</p>}
      </section>;
    })}</div>
    <div className={styles.legend}>
      <table><thead><tr><th scope="col">价敏等级</th><th scope="col">全量人群</th><th scope="col">有订单人群</th></tr></thead><tbody>{labels.map((label) => <tr key={label}>
        <th scope="row"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill={colors[label] ?? '#8B8E95'} /></svg>{label}</th>
        {groups.map((group, index) => {
          const value = group.items?.find((item) => item.label === label)?.value ?? 0;
          const total = totals[index] ?? 0;
          const key = `${group.key}:${label}`;
          return <td key={key}>{group.items ? <button type="button" disabled={!value} aria-label={`${group.title} ${label} 人数与占比`} aria-pressed={!hidden.has(key)}
            onClick={() => toggle(key)} onMouseEnter={() => setActive(key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(key)} onBlur={() => setActive(null)}>
            <strong>{count(value)} 人</strong><span>{total ? (value / total * 100).toFixed(1) : '0.0'}%</span>
          </button> : '—'}</td>;
        })}
      </tr>)}</tbody></table>
    </div>
  </div>;
}
