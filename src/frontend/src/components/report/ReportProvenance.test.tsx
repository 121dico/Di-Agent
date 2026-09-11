// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ChartBinding, ChartExecution } from '@/api/reportProvenance';
import { currentChartExecutions, executionsForChart } from '@/api/reportProvenance';
import { ExecutionDetails } from './ReportProvenance';

const binding: ChartBinding = { chart_key: 'orders', title: '有订单人群分布', query_keys: ['order_distribution'], formula: '当前公式', field_mapping: { x: 'level', value: 'user_count' } };
const execution: ChartExecution = { id: '1', report_id: 'r', source_id: 's', query_key: 'order_distribution', request_json: { conditionList: [{ name: 'ps_conf', operatorEnum: 'GQ', value: '0' }] }, sql: '', query_id: 'real-query', status: 'succeeded', error_message: '', rows: [{ level: 'HIGH', user_count: 1234 }], created_at: '2026-09-11T10:00:00Z', start_date: '2026-09-10', end_date: '2026-09-10', cities: [], bindings: [{ ...binding, formula: '执行时公式' }] };

it('shows the execution-time mapping and real aggregate without inventing missing SQL', () => {
  const html = renderToStaticMarkup(<ExecutionDetails binding={binding} execution={execution} />);
  expect(html).toContain('执行时公式');
  expect(html).not.toContain('当前公式');
  expect(html).toContain('未返回 SQL');
  expect(html).toContain('real-query');
  expect(html).toContain('1234');
  expect(html).toContain('ps_conf');
});

it('does not call an empty or failed snapshot zero users', () => {
  const html = renderToStaticMarkup(<ExecutionDetails binding={binding} execution={{ ...execution, status: 'failed', rows: [], error_message: '查询失败' }} />);
  expect(html).toContain('查询失败');
  expect(html).not.toContain('0 人');
  expect(html).toContain('不可用');
});

it('keeps historical query versions attached to their saved chart, not a reused current query key', () => {
  const old = { ...execution, query_key: 'old_orders', bindings: [{ ...binding, query_keys: ['old_orders'] }] };
  const unrelated = { ...execution, id: '2', bindings: [{ ...binding, chart_key: 'another-chart' }] };
  expect(executionsForChart([old, unrelated], 'orders').map((item) => item.id)).toEqual(['1']);
  expect(executionsForChart([{ ...execution, bindings: [] }], 'orders')).toEqual([]);
});

it('links a donut only to its displayed snapshot while a trend keeps the selected history', () => {
  const previous = { ...execution, id: 'previous', start_date: '2026-09-09', end_date: '2026-09-09' };
  const rows = [execution, previous];
  expect(currentChartExecutions(rows, ['1', 'previous'], 'all_distribution', '2026-09-09', '2026-09-10', '2026-09-10').map((item) => item.id)).toEqual(['1']);
  expect(currentChartExecutions(rows, ['1', 'previous'], 'all_trend', '2026-09-09', '2026-09-10', '2026-09-10')).toHaveLength(2);
  expect(currentChartExecutions(rows, ['1'], 'all_distribution')).toEqual([]);
});
