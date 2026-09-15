import { useEffect, useRef, useState } from 'react';
import type { FC } from 'react';
import { Alert, Button } from 'antd';
import { queryStationScoreEvidence } from '@/api/stationValidation';
import type { StationScoreCase, StationScoreEvidenceResult } from '@/types/stationScoreEvidence';
import { stationNumber } from './stationValidationModel';
import styles from './StationValidation.module.css';

const fieldLabels: Record<string, string> = {
  ps_score: '价敏总分', ps_level: '价敏等级', ps_type: '价敏类型', ps_conf: '置信度', ps_update_dt: '标签更新日期',
  price_score: '价格维度原始分', coupon_score: '用券维度原始分', time_score: '时间维度原始分',
  base_score: '基础得分', profile_factor: '画像调节系数',
  dt: '快照日期', ps_version: '标签版本', order_cnt_180d: '180天订单数', ps_order_cnt: '参与判分订单数', last_order_time: '最后订单时间',
  price_cmp_cnt: '可比价格订单数', cheap_cnt: '低价订单数', same_cnt: '同价订单数', expensive_cnt: '高价订单数', price_dir_idx: '价格方向指标',
  valley_valid_cnt: '谷时可判断订单数', valley_order_cnt: '谷时订单数', valley_rate: '谷时订单占比', sort_confirm_cnt: '价格排序验证次数', price_status: '价格维度状态',
  coupon_used_cnt: '已使用券数', coupon_expired_cnt: '过期券数', coupon_total_cnt: '券总数', coupon_use_rate: '用券率', coupon_status: '用券维度状态',
  time_cmp_cnt: '时间可比订单数', busy_order_cnt: '忙时订单数', busy_low_cnt: '忙时低价订单数', busy_low_rate: '忙时低价占比', busy_station_cnt: '忙时场站数', busy_date_cnt: '忙时日期数', time_status: '时间维度状态',
  is_vip: '会员标记', vehicle_type: '车辆类别', vehicle_brand: '车辆品牌', vehicle_factor: '车辆调节系数', brand_factor: '品牌调节系数', member_factor: '会员调节系数', dim_cnt: '有效维度数', prior_score: '先验分数',
};
const scoreFields = ['ps_score', 'ps_level', 'ps_type', 'ps_conf', 'ps_update_dt', 'price_score', 'coupon_score', 'time_score', 'base_score', 'profile_factor'];
const valueText = (value: string | number | boolean | null | undefined) => value == null || value === '' ? '未提供' : String(value);
const contributionText = (value: number | null | undefined) => value == null ? '未提供' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

interface EvidenceCaseProps { item: StationScoreCase }
interface StationScoreEvidenceProps {
  reportId: string; station: string; start: string; end: string; valid: boolean; isAdmin: boolean;
}

const EvidenceCase: FC<EvidenceCaseProps> = ({ item }) => {
  const keys = [...new Set([...Object.keys(fieldLabels), ...Object.keys(item.fields ?? {})])].filter((key) => !scoreFields.includes(key));
  const value = (key: string) => valueText(item.fields[key]);
  const contributions = [
    { label: '价格', value: item.observed_contributions?.price },
    { label: '用券', value: item.observed_contributions?.coupon },
    { label: '时间', value: item.observed_contributions?.time },
  ].filter((entry) => entry.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const scoreTable = (fields: string[]) => <div className={styles.tableScroll}><table><thead><tr><th>判分字段</th><th>真实值</th></tr></thead><tbody>{fields.map((key) => <tr key={key}><td>{fieldLabels[key] ?? key}<small>{fieldLabels[key] ? key : '原始证据字段'}</small></td><td>{value(key)}</td></tr>)}</tbody></table></div>;
  return <details className={styles.boundary}>
    <summary>DUID {item.duid} · {stationNumber(item.orders)} 笔订单 / {item.consumption_days} 个消费日 · {item.level === 'VERY_HIGH' ? '极高价敏' : '高价敏'}</summary>
    <p className={styles.note}>首末消费日 {item.first_date} — {item.last_date} · 对应标签快照 {item.label_date || '未提供'}</p>
    {item.status !== 'matched' ? <Alert type="warning" message="判分依据不可用" description={item.reason || '未获得同日唯一标签记录。'} /> : <>
      {item.reason && <p className={styles.note}>{item.reason}</p>}
      <p className={styles.note}>总分 {value('ps_score')} · 置信度 {value('ps_conf')} · 基础分 {value('base_score')} × 画像调节系数 {value('profile_factor')}。{contributions[0] ? `已返回的观测维度中，${contributions[0].label}加权贡献最大（${contributionText(contributions[0].value)}）；不等同于已证明最终判分的唯一原因。` : '观测维度贡献未提供，无法比较主要贡献。'}</p>
      <p className={styles.note}>观测维度贡献（按提供的 SQL 权重，展示至两位小数）：价格 × 50%：{contributionText(item.observed_contributions?.price)}；用券 × 30%：{contributionText(item.observed_contributions?.coupon)}；时间 × 20%：{contributionText(item.observed_contributions?.time)}。</p>
      <ul className={styles.note}>
        <li>价格证据：可比订单 {value('price_cmp_cnt')} 笔，低价 {value('cheap_cnt')} 笔、同价 {value('same_cnt')} 笔、高价 {value('expensive_cnt')} 笔；价格方向指标 {value('price_dir_idx')}。谷时可判断 {value('valley_valid_cnt')} 笔，其中谷时订单 {value('valley_order_cnt')} 笔；价格排序验证 {value('sort_confirm_cnt')} 次。</li>
        <li>用券证据：已使用 {value('coupon_used_cnt')} 张，过期 {value('coupon_expired_cnt')} 张；用券率原始值 {value('coupon_use_rate')}。</li>
        <li>时间证据：可比订单 {value('time_cmp_cnt')} 笔，忙时订单 {value('busy_order_cnt')} 笔，其中忙时低价 {value('busy_low_cnt')} 笔。</li>
      </ul>
      {scoreTable(scoreFields)}
      <details className={styles.boundary}><summary>查看完整原始证据字段</summary>{scoreTable(keys)}</details>
    </>}
  </details>;
};

export const StationScoreEvidence: FC<StationScoreEvidenceProps> = ({ reportId, station, start, end, valid, isAdmin }) => {
  const [level, setLevel] = useState('VERY_HIGH');
  const [minDays, setMinDays] = useState('2');
  const [data, setData] = useState<StationScoreEvidenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const days = Number(minDays);
  const canLoad = isAdmin && valid && station !== 'ALL' && Number.isInteger(days) && days >= 1 && days <= 365;
  useEffect(() => {
    request.current++; setData(null); setError(''); setLoading(false);
    return () => { request.current++; };
  }, [reportId, station, start, end, level, minDays, isAdmin, valid]);
  const load = async () => {
    if (!canLoad) return;
    const epoch = ++request.current;
    setLoading(true); setError(''); setData(null);
    try {
      const result = await queryStationScoreEvidence(reportId, station, start, end, level, days);
      if (epoch === request.current) setData(result);
    } catch (cause) {
      if (epoch === request.current) setError(cause instanceof Error ? cause.message : '判分依据查询失败');
    } finally { if (epoch === request.current) setLoading(false); }
  };
  if (!isAdmin) return null;
  return <section className={styles.card} aria-label="高价敏判分依据">
    <h3>高价敏判分依据</h3>
    <div className={styles.controls}>
      <label>核验价敏等级<select value={level} onChange={(event) => setLevel(event.target.value)}><option value="VERY_HIGH">极高价敏</option><option value="HIGH">高价敏</option></select></label>
      <label>最少同站消费日<input type="number" min="1" max="365" step="1" value={minDays} onChange={(event) => setMinDays(event.target.value)} /></label>
      <Button type="primary" disabled={!canLoad || loading} loading={loading} onClick={() => void load()}>查询判分依据</Button>
    </div>
    {station === 'ALL' && <p className={styles.note}>请选择单个场站，再核验同站多次消费用户。</p>}
    {!valid && <p className={styles.note}>请先选择有效的复购消费区间。</p>}
    {(days < 1 || days > 365 || !Number.isInteger(days)) && <p className={styles.note}>最少消费日需为 1 至 365 的整数。</p>}
    {error && <Alert type="error" message={error} action={<Button disabled={!canLoad || loading} onClick={() => void load()}>重试判分依据</Button>} />}
    {loading && <p className={styles.note} role="status">正在匹配同一用户消费当日的真实标签与评分证据…</p>}
    {data && <>
      <p className={styles.note} role="status">符合条件 {stationNumber(data.candidate_count)} 人 · 展示 {data.cases.length} 个案例 · 至少 {data.min_days} 个消费日</p>
      {data.cases.length === 0 ? <p className={styles.note}>当前场站和区间没有符合条件的用户。</p> : data.cases.map((item) => <EvidenceCase key={item.duid} item={item} />)}
    </>}
  </section>;
};
