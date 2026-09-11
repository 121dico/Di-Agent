// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IncrementBarChart, SmoothChart } from './ReportsView';

describe('report chart mode boundaries', () => {
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
  const labels = ['2026-09-07', '2026-09-08', '2026-09-09'];
  function focusDate(date: string) {
    act(() => container.querySelector(`[aria-label="${date}，查看该日所有指标"]`)
      ?.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    return container.querySelector('[role="status"]')?.textContent;
  }

  it('restores original shared-scale geometry after leaving trend comparison', () => {
    const series = [{ label: '大人群', values: [100000000, 110000000, 120000000] }, { label: '小人群', values: [10, 15, 20] }];
    const render = (scaleMode: 'actual' | 'trend') => act(() => root.render(<SmoothChart labels={labels} series={series} trendRule="raw" scaleMode={scaleMode} />));
    const geometry = () => [...container.querySelectorAll('svg path')].map(path => path.getAttribute('d'));
    render('actual');
    const original = geometry();
    expect(original).toHaveLength(2);
    expect(original[0]).not.toBe(original[1]);
    render('trend');
    const paths = [...container.querySelectorAll('svg path')];
    const y = paths.map((path) => [...path.parentElement!.querySelectorAll('circle')].map((circle) => Number(circle.getAttribute('cy'))));
    y[0]?.forEach((value, index) => expect(value).toBeCloseTo(y[1]![index]!, 6));
    render('actual');
    expect(geometry()).toEqual(original);
    expect(container.textContent).toContain('真实数值');
    expect(focusDate(labels[1]!)).not.toContain('日变化率');
  });

  it('preserves a falling curve and a real -100% fall to zero', () => {
    act(() => root.render(<SmoothChart labels={labels} series={[{ label: '下降', values: [100, 50, 0] }]} trendRule="raw" scaleMode="trend" />));
    const y = [...container.querySelectorAll('svg circle')].map(circle => Number(circle.getAttribute('cy')));
    expect(y).toHaveLength(3);
    expect(y[0]).toBeLessThan(y[1]!);
    expect(y[1]).toBeLessThan(y[2]!);
    expect(focusDate(labels[0]!)).toContain('首日无对比');
    expect(focusDate(labels[1]!)).toContain('日变化率 -50.00%');
    expect(focusDate(labels[2]!)).toContain('日变化率 -100.00%');
  });

  it('does not join nonadjacent dates or invent a rate for a zero baseline', () => {
    const dates = ['2026-09-06', '2026-09-07', '2026-09-09'];
    act(() => root.render(<SmoothChart labels={dates} series={[{ label: '零人群', values: [0, 0, 10] }]} trendRule="raw" scaleMode="trend" />));
    expect(container.querySelector('svg path')?.getAttribute('d')?.match(/C /g)).toHaveLength(1);
    expect(focusDate(dates[1]!)).toContain('前日为 0，日变化率不可计算');
    expect(focusDate(dates[2]!)).toContain('前日缺失，日变化率不可计算');
    expect(container.innerHTML).not.toMatch(/(?:cy|d)="[^"]*(?:NaN|Infinity)/);
  });

  it('keeps a sustained population step in the line without labelling it an outlier', () => {
    const dates = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09'];
    act(() => root.render(<SmoothChart labels={dates} series={[{ label: '持续变更', values: [100, 100, 500, 500, 500] }]} scaleMode="trend" />));
    expect(container.querySelector('[data-outlier]')).toBeNull();
    expect(container.querySelector('svg path')).not.toBeNull();
    expect(focusDate('2026-09-07')).toContain('+400.00%');
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain('疑似离群');
  });

  it('does not infer outliers at endpoints or across missing observations and calendar gaps', () => {
    const cases = [
      { dates: labels, values: [900, 100, 100] },
      { dates: labels, values: [100, 100, 900] },
      { dates: ['2026-09-06', '2026-09-07', '2026-09-09'], values: [100, 900, 100] },
      { dates: labels, values: [NaN, 900, 100] },
    ];
    cases.forEach(({ dates, values }) => {
      act(() => root.render(<SmoothChart labels={dates} series={[{ label: '未确认跳变', values }]} scaleMode="trend" />));
      expect(container.querySelector('[data-outlier]')).toBeNull();
      expect(container.textContent).not.toContain('个疑似离群点');
    });
  });

  it('marks an isolated three-day spike while retaining its real value and flagged rate', () => {
    act(() => root.render(<SmoothChart labels={labels} series={[{ label: '孤立跳变', values: [100, 900, 100] }]} scaleMode="trend" />));
    expect(container.querySelectorAll('[data-outlier]')).toHaveLength(1);
    expect(container.querySelector('[data-outlier] circle[fill="#fff"] title')?.textContent).toContain('900');
    expect(focusDate(labels[1]!)).toContain('疑似离群');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('+800.00%');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('含疑似离群日');
  });

  it('does not let an isolated spike change the trend coordinates of normal observations', () => {
    const dates = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09'];
    const render = (values: number[]) => act(() => root.render(<SmoothChart labels={dates} series={[{ label: '稳定趋势', values }]} scaleMode="trend" />));
    const normalCoordinates = () => [...container.querySelectorAll('svg circle')]
      .filter(circle => !circle.closest('[data-outlier]'))
      .map(circle => [Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))]);
    render([100, 101, 900, 102, 103]);
    expect(container.querySelectorAll('[data-outlier]')).toHaveLength(1);
    const withSpike = normalCoordinates();
    render([100, 101, NaN, 102, 103]);
    expect(normalCoordinates()).toEqual(withSpike);
    expect(withSpike).toHaveLength(4);
  });

  it('does not draw estimated bridges across missing samples or calendar gaps in curves or bars', () => {
    const cases = [
      { dates: labels, values: [100, NaN, 100] },
      { dates: ['2026-09-06', '2026-09-07', '2026-09-09'], values: [100, 900, 100] },
    ];
    cases.forEach(({ dates, values }) => {
      act(() => root.render(<SmoothChart labels={dates} series={[{ label: '缺口', values }]} scaleMode="trend" />));
      expect(container.querySelector('path[data-estimated]')).toBeNull();
      act(() => root.render(<IncrementBarChart labels={dates} values={values} raw />));
      expect(container.querySelector('path[data-estimated]')).toBeNull();
    });
  });

  it('keeps empty bars empty and a single negative observation signed without inventing a trend', () => {
    act(() => root.render(<IncrementBarChart labels={[]} values={[]} raw />));
    expect(container.textContent).toContain('暂无增量数据');
    expect(container.querySelector('svg rect')).toBeNull();
    expect(container.querySelector('svg path')).toBeNull();
    act(() => root.render(<IncrementBarChart labels={[labels[0]!]} values={[-42]} raw />));
    expect(container.querySelector('svg path')).toBeNull();
    expect(container.querySelector('[data-direction="negative"]')).not.toBeNull();
    act(() => container.querySelector('[aria-label="2026-09-07，价敏用户净增 -42"]')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('-42');
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain('疑似离群');
  });

  it('keeps actual-mode empty and all-missing chart axes finite', () => {
    [[], [{ label: '缺失', values: [NaN, NaN, NaN] }]].forEach(series => {
      act(() => root.render(<SmoothChart labels={labels} series={series} scaleMode="actual" />));
      expect(container.textContent).toContain('暂无趋势数据');
      expect(container.querySelector('svg')?.outerHTML).not.toMatch(/NaN|Infinity/);
    });
  });

  it('keeps ordinary bar heights linear while an exceptional negative bar retains its raw signed tooltip', () => {
    const dates = ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09'];
    act(() => root.render(<IncrementBarChart labels={dates} values={[100, 100, -10000, 100, 200]} raw />));
    const normal = container.querySelector('[aria-label="2026-09-05，价敏用户净增 100"]');
    const double = container.querySelector('[aria-label="2026-09-09，价敏用户净增 200"]');
    expect(Number(double?.getAttribute('height')) / Number(normal?.getAttribute('height'))).toBeCloseTo(2, 8);
    expect(container.querySelector('circle[data-outlier="true"]')).not.toBeNull();
    expect(container.querySelector('path[data-estimated="true"]')).not.toBeNull();
    act(() => container.querySelector('[aria-label="2026-09-07，价敏用户净增 -10000"]')?.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('-10,000');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('已从主图分离');
  });
});
