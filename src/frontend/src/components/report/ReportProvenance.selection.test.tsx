// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ChartBinding, ChartExecution, ChartProvenance } from '@/api/reportProvenance';
import { getChartProvenance } from '@/api/reportProvenance';
import { ReportProvenance } from './ReportProvenance';

vi.mock('antd', async (importOriginal) => ({
  ...await importOriginal<typeof import('antd')>(),
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
}));
vi.mock('@/api/reportProvenance', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/reportProvenance')>(),
  getChartProvenance: vi.fn(),
}));

it('uses native selectors to switch charts, history records and current execution IDs', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const bindings: ChartBinding[] = ['all_distribution', 'order_distribution'].map((key) => ({
    chart_key: key, title: key === 'all_distribution' ? '全量分布' : '订单分布',
    query_keys: [key], formula: `${key}公式`, field_mapping: { value: 'user_count' },
  }));
  const execution = (id: string, binding: ChartBinding): ChartExecution => ({
    id, report_id: 'report', source_id: 'source', query_key: binding.chart_key,
    request_json: {}, sql: '', query_id: `query-${id}`, status: 'succeeded', error_message: '',
    rows: [{ user_count: 12 }], created_at: '2026-09-11T10:00:00Z',
    start_date: '2026-09-10', end_date: '2026-09-10', cities: [], bindings: [binding],
  });
  const data: ChartProvenance = { available: true, message: '', bindings, executions: [
    execution('all-current', bindings[0]!), execution('all-replay', bindings[0]!),
    execution('orders-current', bindings[1]!), execution('orders-replay', bindings[1]!),
  ] };
  vi.mocked(getChartProvenance).mockResolvedValue(data);
  const host = document.createElement('div');
  const root = createRoot(host);
  const select = (label: string) => host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const values = () => [...select('执行记录').options].map((option) => option.value);
  const change = (label: string, value: string) => act(() => {
    select(label).value = value;
    select(label).dispatchEvent(new Event('change', { bubbles: true }));
  });
  try {
    await act(async () => { root.render(<ReportProvenance reportId="report" open onClose={() => {}}
      executionIds={['all-current', 'orders-current']} dataDate="2026-09-10" />); });
    expect(host.querySelectorAll('select')).toHaveLength(3);
    expect(getChartProvenance).toHaveBeenCalledWith('report', ['all-current', 'orders-current']);
    expect(select('选择图表').disabled).toBe(false);
    expect(values()).toEqual(['all-current']);
    change('记录范围', 'history');
    expect(values()).toEqual(['all-current', 'all-replay']);
    change('执行记录', 'all-replay');
    expect(select('执行记录').value).toBe('all-replay');
    expect(host.textContent).toContain('query-all-replay');
    change('选择图表', 'order_distribution');
    expect(values()).toEqual(['orders-current', 'orders-replay']);
    expect(select('执行记录').value).toBe('orders-current');
    change('执行记录', 'orders-replay');
    expect(host.textContent).toContain('query-orders-replay');
    change('记录范围', 'current');
    expect(values()).toEqual(['orders-current']);
    expect(host.textContent).toContain('query-orders-current');
    expect(host.textContent).not.toContain('query-orders-replay');
    change('选择图表', 'all_distribution');
    expect(values()).toEqual(['all-current']);
  } finally {
    act(() => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  }
});
