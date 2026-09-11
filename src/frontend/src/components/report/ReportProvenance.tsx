import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Empty, Select, Spin } from 'antd';
import { executionsForChart, getChartProvenance, replayChartExecution } from '@/api/reportProvenance';
import type { ChartBinding, ChartExecution, ChartProvenance } from '@/api/reportProvenance';
import styles from './ReportProvenance.module.css';

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const cell = (value: unknown) => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function ExecutionDetails({ binding, execution }: { binding: ChartBinding; execution: ChartExecution }) {
  // 回看历史执行时使用当次保存的版本，不能用当前公式冒充历史口径。
  const recorded = execution.bindings?.find((item) => item.chart_key === binding.chart_key);
  const rows = execution.rows ?? [];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const succeeded = execution.status === 'succeeded';
  return <>
    <dl className={styles.meta}>
      <dt>数据日期</dt><dd>{execution.start_date} → {execution.end_date}</dd>
      <dt>城市范围</dt><dd>{execution.cities?.length ? execution.cities.join('、') : '全部城市'}</dd>
      <dt>查询 ID</dt><dd>{execution.query_id || '未返回'}</dd>
      <dt>数据来源</dt><dd>{execution.source_name || execution.source_id}{execution.api_name ? ` · ${execution.api_name}` : ''}</dd>
      <dt>执行状态</dt><dd>{succeeded ? '成功' : execution.status === 'pending' ? '执行中' : '结果不可用'}</dd>
      <dt>执行时公式</dt><dd>{recorded?.formula || '本次执行未保存此图的公式版本'}</dd>
    </dl>
    {execution.error_message && <Alert type="error" title={execution.error_message} />}
    <details className={styles.details}><summary>结果字段与图表的对应关系</summary><pre className={styles.code}>{recorded ? pretty(recorded.field_mapping) : '未记录历史字段映射'}</pre></details>
    <details className={styles.details}><summary>实际 API 请求参数</summary><pre className={styles.code}>{pretty(execution.request_json)}</pre></details>
    <details className={styles.details}><summary>上游实际执行 SQL</summary><pre className={styles.code}>{execution.sql || '此次 API 未返回 SQL；已保留真实请求参数，不生成替代 SQL。'}</pre></details>
    <details className={styles.details}><summary>本次聚合结果 · {succeeded ? `${rows.length} 行` : '不可用'}</summary>
      {succeeded && rows.length > 0 ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{columns.map((name) => <th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((name) => <td key={name}>{cell(row[name])}</td>)}</tr>)}</tbody></table></div>
        : <p className={styles.hint}>{succeeded ? '本次查询成功，返回空结果。' : '失败或未完成的结果不作为报表数据。'}</p>}
    </details>
  </>;
}

function ProvenanceBody({ reportId, executionIds, startDate, endDate }: { reportId: string; executionIds: string[]; startDate?: string; endDate?: string }) {
  const [data, setData] = useState<ChartProvenance | null>(null);
  const [chartKey, setChartKey] = useState('');
  const [executionId, setExecutionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [scope, setScope] = useState('current');
  const alive = useRef(true);
  const idsKey = executionIds.join(',');
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void getChartProvenance(reportId, idsKey ? idsKey.split(',') : []).then((result) => {
      if (!active) return;
      setData(result);
      setChartKey((key) => result.bindings?.some((item) => item.chart_key === key) ? key : result.bindings?.[0]?.chart_key ?? '');
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : '记录加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reportId, reload, idsKey]);
  const binding = data?.bindings?.find((item) => item.chart_key === chartKey);
  const linkedExecutions = executionsForChart(data?.executions ?? [], chartKey);
  const executions = scope === 'history' ? linkedExecutions : linkedExecutions.filter((item) => executionIds.includes(item.id)
    && (!startDate || item.end_date >= startDate) && (!endDate || item.start_date <= endDate));
  const execution = executions.find((item) => item.id === executionId) ?? executions[0];
  const replay = async () => {
    if (!execution || running) return;
    setRunning(true); setError(''); setNotice('');
    try {
      const result = await replayChartExecution(reportId, execution.id);
      if (!alive.current) return;
      setNotice(result.message); setExecutionId(result.execution.id); setScope('history');
      setReload((value) => value + 1);
    } catch (reason: unknown) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '重跑失败');
    } finally { if (alive.current) setRunning(false); }
  };
  return <Spin spinning={loading}><div className={styles.body}>
    {error && <Alert type="error" title={error} action={<Button disabled={running} onClick={() => setReload((value) => value + 1)}>重试</Button>} />}
    {notice && <Alert type="success" title={notice} />}
    <label className={styles.field}><span>选择图表</span><Select aria-label="选择图表" value={chartKey || undefined} disabled={loading || running}
      options={(data?.bindings ?? []).map((item) => ({ value: item.chart_key, label: item.title }))} onChange={(key) => { setChartKey(key); setExecutionId(''); setNotice(''); }} /></label>
    <label className={styles.field}><span>记录范围</span><Select aria-label="记录范围" value={scope} disabled={loading || running} options={[{ value: 'current', label: '当前图表结果对应的执行' }, { value: 'history', label: '全部历史执行（含核验重跑）' }]} onChange={(value) => { setScope(value); setExecutionId(''); }} /></label>
    {binding && <><p className={styles.hint}>{binding.formula}</p><label className={styles.field}><span>执行记录</span><Select aria-label="执行记录" value={execution?.id} disabled={loading || running}
      placeholder="暂无对应记录" options={executions.map((item) => ({ value: item.id, label: `${item.created_at} · ${item.query_key} · ${item.status === 'succeeded' ? '成功' : '不可用'}` }))} onChange={setExecutionId} /></label></>}
    {binding && execution ? <><ExecutionDetails binding={binding} execution={execution} /><div className={styles.actions}>
      <Button loading={running} disabled={loading} onClick={() => void replay()}>重跑并保存核验结果</Button><span className={styles.hint}>不会替换公开图表；更新图表请使用“立即生成”。</span>
    </div></> : !loading && <Empty description={scope === 'current' ? '当前缓存尚无可查看的对应执行记录；旧缓存不会补造来源，可查看历史执行或使用“立即生成”更新。' : data?.message || '此图暂未保存查询记录。'} />}
  </div></Spin>;
}

const NO_EXECUTIONS: string[] = [];
export function ReportProvenance({ reportId, open, onClose, executionIds = NO_EXECUTIONS, startDate, endDate }: { reportId: string; open: boolean; onClose: () => void; executionIds?: string[]; startDate?: string; endDate?: string }) {
  return <Drawer title="图表数据逻辑" open={open} onClose={onClose} width="min(880px, 100vw)">
    {open && <ProvenanceBody key={reportId} reportId={reportId} executionIds={executionIds} startDate={startDate} endDate={endDate} />}
  </Drawer>;
}
