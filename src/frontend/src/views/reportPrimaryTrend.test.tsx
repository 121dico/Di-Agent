// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { IncrementBarChart, SmoothChart } from './ReportsView';

it('keeps daily growth curves readable with an extreme final daily change', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const values = [NaN, 100, 110, 120, 130, 140, 150, 160, 11000000];
  const labels = values.map((_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  try {
    for (const series of [
      { key: 'dailyNet', label: '每日净增', values },
      { key: 'growthRate', label: '每日增长率', values: [NaN, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.9] },
    ]) {
      act(() => root.render(<SmoothChart labels={labels} series={[series]} />));
      expect(container.querySelectorAll('g[data-outlier]')).toHaveLength(1);
      expect(container.querySelector('g[data-outlier] title')?.textContent).toContain(String(series.values[8]));
      const ticks = Array.from(container.querySelectorAll('text')).map(node => node.textContent);
      expect(ticks).not.toContain('1500万');
    }
  } finally { act(() => root.unmount()); }
});

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

it('does not hide a short sample endpoint or a sustained majority high level', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    [[40, 41, 1000000], [40, 41, 1000000, 1000000, 1000000, 1000000, 1000000, 1000000]].forEach(values => {
      const labels = values.map((_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
      act(() => root.render(<IncrementBarChart labels={labels} values={values} raw />));
      expect(container.querySelectorAll('circle[data-outlier]')).toHaveLength(0);
      expect(container.querySelectorAll('rect[data-direction]')).toHaveLength(values.length);
    });
  } finally { act(() => root.unmount()); container.remove(); }
});

it('does not remove an entire high block exceeding the rare-extreme allowance', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const values = [40, 40, 40, 40, 40, 40, 40, 1000000, 1000000, 1000000];
  const labels = values.map((_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  try {
    act(() => root.render(<IncrementBarChart labels={labels} values={values} raw />));
    expect(container.querySelectorAll('circle[data-outlier]')).toHaveLength(0);
    expect(container.querySelectorAll('rect[data-direction]')).toHaveLength(10);
  } finally { act(() => root.unmount()); container.remove(); }
});

it('opens a negative endpoint extreme from click, Enter and Space with its unmodified signed value', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const values = [40000, 41000, 42000, 43000, 44000, 45000, 46000, 47000, -11000000];
  const labels = values.map((_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  try {
    act(() => root.render(<IncrementBarChart labels={labels} values={values} raw />));
    const marker = container.querySelector('[aria-label="2026-09-09，价敏用户净增 -11000000"]')!;
    expect(marker.tagName.toLowerCase()).toBe('circle');
    expect(marker.getAttribute('tabindex')).toBe('0');
    for (const event of [new MouseEvent('click', { bubbles: true }), new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }), new KeyboardEvent('keydown', { key: ' ', bubbles: true })]) {
      act(() => marker.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      expect(container.querySelector('[role="status"]')).toBeNull();
      act(() => marker.dispatchEvent(event));
      expect(container.querySelector('[role="status"]')?.textContent).toContain('-11,000,000');
    }
  } finally { act(() => root.unmount()); container.remove(); }
});
