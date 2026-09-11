// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
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

it('distinguishes unloaded order statistics from a genuine zero cohort', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<ReportCohortComparison all={[{ label: '高价敏', value: 20 }]} orders={null} />);
  const orders = container.querySelector('section[aria-label="有订单人群价敏分布"]')!;
  expect(orders.textContent).toContain('尚无可用统计');
  expect(orders.textContent).toContain('订单人群统计未加载');
  expect(orders.textContent).not.toContain('0 人');
  expect(container.querySelector('tbody tr td:last-child')?.textContent).toBe('—');
  expect(container.querySelectorAll('svg[aria-label$="环形图"]')).toHaveLength(1);

  container.innerHTML = renderToStaticMarkup(<ReportCohortComparison all={[{ label: '高价敏', value: 20 }]} orders={[]} />);
  const zeroOrders = container.querySelector('section[aria-label="有订单人群价敏分布"]')!;
  expect(zeroOrders.textContent).toContain('0 人');
  expect(zeroOrders.textContent).toContain('暂无分布数据');
  expect(zeroOrders.textContent).not.toContain('未加载');
  const zeroValue = container.querySelector<HTMLButtonElement>('button[aria-label="有订单人群 高价敏 人数与占比"]')!;
  expect(zeroValue.disabled).toBe(true);
  expect(zeroValue.textContent).toBe('0 人0.0%');
});

it('renders empty distributions without fabricated sectors or invalid percentages', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<ReportCohortComparison all={[]} orders={[]} />);
  expect(container.querySelectorAll('svg[aria-label$="环形图"]')).toHaveLength(0);
  expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  expect(container.textContent?.match(/暂无分布数据/g)).toHaveLength(2);
  expect(container.textContent).not.toMatch(/NaN|Infinity/);
});

it('lets keyboard users toggle and restore a sector without changing the other cohort', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<ReportCohortComparison all={[{ label: '高价敏', value: 20 }, { label: '低价敏', value: 80 }]} orders={[{ label: '高价敏', value: 10 }, { label: '低价敏', value: 10 }]} />));
    const sector = container.querySelector<SVGCircleElement>('circle[aria-label="全量人群 高价敏"]')!;
    const otherSector = container.querySelector<SVGCircleElement>('circle[aria-label="有订单人群 高价敏"]')!;
    const value = container.querySelector<HTMLButtonElement>('button[aria-label="全量人群 高价敏 人数与占比"]')!;
    expect(sector.getAttribute('tabindex')).toBe('0');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => { sector.dispatchEvent(enter); });
    expect(enter.defaultPrevented).toBe(true);
    expect(sector.getAttribute('aria-pressed')).toBe('false');
    expect(value.getAttribute('aria-pressed')).toBe('false');
    expect(otherSector.getAttribute('aria-pressed')).toBe('true');
    expect(value.textContent).toContain('20.0%');
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    act(() => { sector.dispatchEvent(space); });
    expect(space.defaultPrevented).toBe(true);
    expect(sector.getAttribute('aria-pressed')).toBe('true');
    expect(value.getAttribute('aria-pressed')).toBe('true');
    act(() => { sector.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(sector.getAttribute('aria-pressed')).toBe('true');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
