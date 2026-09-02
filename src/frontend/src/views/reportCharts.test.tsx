// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DonutChart, IncrementBarChart, SmoothChart } from './ReportsView';

describe('report chart interactions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reveals every visible value for a focused date', () => {
    act(() => {
      root.render(
        <SmoothChart
          labels={['2026-08-19', '2026-08-20']}
          series={[
            { key: 'score', label: '价敏均分', color: '#2F6FDB', values: [61.2, 63.8] },
            { key: 'd1', label: 'D1 价格分', color: '#15857A', values: [58, 60] },
          ]}
          bounds={[0, 100]}
        />,
      );
    });

    const dateHitArea = container.querySelector('[aria-label="2026-08-20，查看该日所有指标"]');
    expect(dateHitArea).not.toBeNull();
    act(() => dateHitArea?.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));

    const tooltip = container.querySelector('[role="status"]');
    expect(tooltip?.textContent).toContain('2026-08-20');
    expect(tooltip?.textContent).toContain('价敏均分63.8');
    expect(tooltip?.textContent).toContain('D1 价格分60');
  });

  it('uses a real-value dynamic axis and keeps a single sample as a point', () => {
    act(() => {
      root.render(
        <SmoothChart
          labels={['2026-08-25']}
          series={[{ key: 'score', label: '价敏均分', color: '#2F6FDB', values: [55.07] }]}
          bounds={[0, 100]}
        />,
      );
    });

    expect(container.textContent).toContain('真实值动态刻度');
    expect(container.textContent).toContain('50–60');
    expect(container.textContent).toContain('仅标记基准点，不生成虚假曲线');
    expect(container.querySelector('path')).toBeNull();
    expect(container.querySelector('svg circle')).not.toBeNull();
  });

  it('makes a real multi-day change legible without normalizing the values', () => {
    act(() => {
      root.render(
        <SmoothChart
          labels={['2026-08-18', '2026-08-22', '2026-08-24']}
          series={[{ key: 'score', label: '价敏均分', color: '#2F6FDB', values: [58, 67, 64.25] }]}
          bounds={[0, 100]}
        />,
      );
    });

    expect(container.textContent).toContain('55–70');
    expect(container.textContent).toContain('+6.25 · 波动 9');
    expect(container.querySelector('path')).not.toBeNull();
  });

  it('keeps donut legend state explicit and toggles through the shared control', () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        <DonutChart
          distribution={[{ label: '高价敏', value: 40 }, { label: '中价敏', value: 60 }]}
          hidden={new Set(['高价敏'])}
          onToggle={onToggle}
        />,
      );
    });

    const highSensitivity = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('高价敏'));
    expect(highSensitivity?.getAttribute('aria-pressed')).toBe('false');
    act(() => highSensitivity?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onToggle).toHaveBeenCalledWith('高价敏');
  });

  it('keeps every donut sector proportional while a disabled sector turns neutral', () => {
    act(() => {
      root.render(
        <DonutChart
          distribution={[{ label: '高价敏', value: 20 }, { label: '中价敏', value: 50 }, { label: '低价敏', value: 30 }]}
          hidden={new Set(['中价敏'])}
          onToggle={() => undefined}
        />,
      );
    });

    const sectors = Array.from(container.querySelectorAll('[data-donut-sector]'));
    expect(sectors).toHaveLength(3);

    const lengths = sectors.map((sector) => Number(sector.getAttribute('stroke-dasharray')?.split(' ')[0]));
    const totalLength = lengths.reduce((sum, length) => sum + length, 0);
    expect(lengths[0]! / totalLength).toBeCloseTo(0.2, 3);
    expect(lengths[1]! / totalLength).toBeCloseTo(0.5, 3);
    expect(lengths[2]! / totalLength).toBeCloseTo(0.3, 3);

    expect(sectors[1]!.getAttribute('data-state')).toBe('disabled');
    expect(sectors[1]!.getAttribute('stroke')).toBe('var(--report-donut-muted)');
    expect(sectors[0]!.getAttribute('data-state')).toBe('enabled');
    expect(sectors[0]!.getAttribute('stroke')).toBe('#D75A50');
  });

  it('renders signed daily net growth around a real zero baseline', () => {
    act(() => {
      root.render(
        <IncrementBarChart
          labels={['2026-08-25', '2026-08-26', '2026-08-27']}
          values={[0, 31_034, -12_400]}
        />,
      );
    });

    expect(container.textContent).toContain('正增长');
    expect(container.textContent).toContain('负增长');
    expect(container.querySelector('[data-direction="positive"]')).not.toBeNull();
    expect(container.querySelector('[data-direction="negative"]')).not.toBeNull();
    const lastDate = container.querySelector('[aria-label="2026-08-27，价敏用户净增 -12400"]');
    expect(lastDate).not.toBeNull();
    act(() => lastDate?.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('-12,400');
  });

  it('compresses an extreme signed outlier without hiding ordinary daily movement', () => {
    act(() => {
      root.render(
        <IncrementBarChart
          labels={['2026-08-01', '2026-08-02']}
          values={[-640_000, 40_000]}
        />,
      );
    });

    expect(container.textContent).toContain('符号压缩刻度');
    const negativeHeight = Number(container.querySelector('[data-direction="negative"]')?.getAttribute('height'));
    const positiveHeight = Number(container.querySelector('[data-direction="positive"]')?.getAttribute('height'));
    expect(positiveHeight / negativeHeight).toBeGreaterThan(0.2);
  });
});
