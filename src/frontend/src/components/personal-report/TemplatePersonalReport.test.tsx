// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PersonalReport } from '@/types/personalReport';
import { TemplatePersonalReport } from './TemplatePersonalReport';

const report = {
  id: 'report-1', owner_user_id: 'user-1', title: 'V1.3 价敏报表', description: '已查询分区数据',
  status: 'saved', style_preset: 'business', style_prompt: '', revision: 1,
  created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
  query: {}, provenance: { source_name: '价敏 V1.3', source_partition: '2026-09-22', query_id: 'query-1' },
  document: {
    template_id: 'template-1', template_version: '1.0.0',
    sections: [
      { id: 'overview', type: 'metrics', title: '指标概览', query_id: 'query-1', metrics: [{ field: 'user_count', label: '用户数', suffix: '人' }], data: { rows: [{ user_count: 123 }], pagination: { total: 1, page: 1, page_size: 1, page_count: 1 } } },
      { id: 'trend', type: 'chart', title: '每日趋势', chart_type: 'line', x_field: 'dt', query_id: 'query-2', series: [{ field: 'user_count', label: '用户数' }], data: { rows: [{ dt: '2026-09-21', user_count: 100 }, { dt: '2026-09-22', user_count: 123 }], pagination: { total: 2, page: 1, page_size: 2, page_count: 1 } } },
      { id: 'detail', type: 'table', title: '分区明细', query_id: 'query-2', columns: [{ field: 'dt', label: '日期' }, { field: 'user_count', label: '人数' }], data: { rows: [{ dt: '2026-09-22', user_count: 123 }], pagination: { total: 1, page: 1, page_size: 1, page_count: 1 } } },
    ],
  },
} as PersonalReport;

describe('V1.2 template-backed personal report', () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => { container?.remove(); container = null; });

  it('shows the server-hydrated metric, chart, table and source provenance in template order', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<TemplatePersonalReport report={report} />));
    const text = container.textContent ?? '';
    expect(text).toContain('V1.3 价敏报表');
    expect(text).toContain('123人');
    expect(text).toContain('2026-09-22');
    expect(text).toContain('价敏 V1.3');
    expect(container.querySelectorAll('nav a')).toHaveLength(3);
    expect(container.querySelector('table tbody tr')?.textContent).toContain('123');
    expect(container.querySelector('svg')).not.toBeNull();
    act(() => root.unmount());
  });

  it('reuses the V1.2 overview, cohort, growth and trend sections for a prepared snapshot', () => {
    const prepared = {
      ...report,
      document: { template_id: 'template-1', sections: [{ id: 'v12_snapshot', type: 'v12_dashboard', title: '价敏 V1.2', data: { rows: [{ analytics: {
        prepared: true, profile: 'price_sensitive_v1_2', data_date: '2026-09-22', start_date: '2026-09-21', end_date: '2026-09-22',
        summary: { total_user_count: 123, calculated_user_count: 123, average_price_sensitivity_score: 54 },
        distribution: [{ level: 'HIGH', user_count: 23 }, { level: 'LOW', user_count: 100 }],
        trend: [{ dt: '2026-09-21', total_user_count: 120, calculated_user_count: 120, distribution: [] },
          { dt: '2026-09-22', total_user_count: 123, calculated_user_count: 123, distribution: [] }],
        order_cohort: { user_count: 50, share: 40, distribution: [{ level: 'HIGH', user_count: 10 }] },
      } }] } }] },
    } as PersonalReport;
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<TemplatePersonalReport report={prepared} />));
    const text = container.textContent ?? '';
    expect(text).toContain('指标概览 · 全量人群');
    expect(text).toContain('价敏人群分布对比');
    expect(text).toContain('增量分析');
    expect(text).toContain('每日标签快照趋势');
    expect(container.querySelectorAll('nav a')).toHaveLength(4);
    act(() => root.unmount());
  });

  it('locks arbitrary data to the V1.2 line, bar and donut components without price-sensitivity copy', () => {
    const generic = {
      ...report,
      title: '投放概览',
      document: { template_id: 'template-1', template_version: '1.0.0', sections: [
        { id: 'daily', type: 'chart', title: '每日花费', chart_type: 'line', x_field: 'dt', series: [{ field: 'spend', label: '花费', color: '#ff00ff' }], data: { rows: [{ dt: '2026-09-21', spend: 12 }, { dt: '2026-09-22', spend: 15 }] } },
        { id: 'channels', type: 'chart', title: '渠道转化', chart_type: 'bar', x_field: 'channel', series: [{ field: 'orders', label: '订单数' }], data: { rows: [{ channel: '搜索', orders: 3 }, { channel: '信息流', orders: 8 }] } },
        { id: 'share', type: 'chart', title: '渠道占比', chart_type: 'donut', label_field: 'channel', value_field: 'orders', data: { rows: [{ channel: '搜索', orders: 3 }, { channel: '信息流', orders: 8 }] } },
      ] },
    } as PersonalReport;
    container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<TemplatePersonalReport report={generic} />));
    expect(container.querySelector('svg[aria-label="报表趋势图"]')?.getAttribute('viewBox')).toMatch(/ 270$/);
    expect(container.querySelector('svg[aria-label="订单数柱状图"]')).not.toBeNull();
    expect(container.querySelector('svg[aria-label="报表扇形分布图"]')).not.toBeNull();
    expect(container.querySelector('[data-donut-sector]')?.getAttribute('stroke')).toBe('#2F6FDB');
    expect(container.querySelector('svg[aria-label="报表扇形分布图"]')?.textContent).toContain('总量');
    expect(container.textContent).not.toContain('正常幅度平滑趋势');
    expect(container.textContent).not.toContain('价敏用户');
    expect(container.innerHTML).not.toContain('#ff00ff');
    act(() => root.unmount());
  });

});
