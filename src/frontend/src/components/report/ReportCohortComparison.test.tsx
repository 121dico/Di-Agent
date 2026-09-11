// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReportCohortComparison } from './ReportCohortComparison';

it('shares one level legend with independent cohort denominators and toggles', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<ReportCohortComparison all={[{ label: '高价敏', value: 20 }, { label: '低价敏', value: 80 }]} orders={[{ label: '高价敏', value: 10 }, { label: '低价敏', value: 10 }]} />));
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('tbody th')).toHaveLength(2);
    expect(container.querySelectorAll('svg[aria-label$="环形图"]')).toHaveLength(2);
    const all = container.querySelector<HTMLButtonElement>('button[aria-label="全量人群 高价敏 人数与占比"]')!;
    const orders = container.querySelector<HTMLButtonElement>('button[aria-label="有订单人群 高价敏 人数与占比"]')!;
    expect(all.textContent).toContain('20.0%');
    expect(orders.textContent).toContain('50.0%');
    act(() => all.click());
    expect(all.getAttribute('aria-pressed')).toBe('false');
    expect(orders.getAttribute('aria-pressed')).toBe('true');
    expect(all.textContent).toContain('20.0%');
    act(() => all.click());
    expect(all.getAttribute('aria-pressed')).toBe('true');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
