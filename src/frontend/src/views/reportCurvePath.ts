import { buildSmoothChartPath } from './reportPresentation';

// NaN 同时表达未观测或单独标记的点：断开路径而不是补值连接。
export function buildObservedCurvePath(labels: string[], values: number[], point: (value: number, index: number) => { x: number; y: number }): string {
  const segments: Array<Array<{ x: number; y: number }>> = [[]];
  values.forEach((value, index) => {
    const gap = index > 0 && Date.parse(labels[index] ?? '') - Date.parse(labels[index - 1] ?? '') > 86400000;
    if (gap || !Number.isFinite(value)) segments.push([]);
    if (Number.isFinite(value)) segments[segments.length - 1]!.push(point(value, index));
  });
  return segments.map((segment) => buildSmoothChartPath(segment, 0, 0)).join(' ');
}
