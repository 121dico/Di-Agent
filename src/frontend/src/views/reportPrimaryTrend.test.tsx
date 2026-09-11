// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { IncrementBarChart } from './ReportsView';

it('keeps ordinary movement readable when both an interior spike and the latest day are extreme', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const labels = Array.from({ length: 45 }, (_, i) => new Date(Date.UTC(2026, 6, 28 + i)).toISOString().slice(0, 10));
  const values = labels.map((_, i) => i === 0 ? 0 : 40000 + i * 500);
  values[14] = 14000000;
  values[44] = 11000000;
  try {
    act(() => root.render(<IncrementBarChart labels={labels} values={values} raw />));
    const ordinary = container.querySelector(`[aria-label="${labels[1]}，价敏用户净增 40500"]`)!;
    expect(Number(ordinary.getAttribute('height'))).toBeGreaterThan(80);
    expect(container.querySelectorAll('rect[data-outlier]')).toHaveLength(0);
    const marker = container.querySelector(`[aria-label="${labels[44]}，价敏用户净增 11000000"]`)!;
    expect(marker.tagName.toLowerCase()).toBe('circle');
    expect(Number(marker.getAttribute('r'))).toBeLessThanOrEqual(6);
    act(() => marker.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('11,000,000');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
