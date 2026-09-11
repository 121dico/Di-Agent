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

// 只跨越明确筛出的离群日；缺失观测或日历缺口不能被当作离群点补线。
export function buildEstimatedCurvePath(labels: string[], values: number[], excluded: number[], point: (value: number, index: number) => { x: number; y: number }): string {
  const omitted = new Set(excluded);
  const paths: string[] = [];
  let previous: number | undefined;
  values.forEach((value, index) => {
    if (!Number.isFinite(value) || (index > 0 && Date.parse(labels[index] ?? '') - Date.parse(labels[index - 1] ?? '') !== 86400000)) previous = undefined;
    if (!Number.isFinite(value) || omitted.has(index)) return;
    if (previous !== undefined && index - previous > 1) {
      paths.push(buildSmoothChartPath([point(values[previous]!, previous), point(value, index)], 0, 0));
    }
    previous = index;
  });
  return paths.join(' ');
}
