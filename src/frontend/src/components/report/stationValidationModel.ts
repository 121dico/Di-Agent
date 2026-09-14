import type { StationValidationDay, StationValidationResult } from '@/types/stationValidation';

export const stationLevels = [
  ['VERY_LOW', '极低'], ['LOW', '低'], ['MEDIUM_LOW', '中低'], ['MEDIUM', '中'],
  ['MEDIUM_HIGH', '中高'], ['HIGH', '高'], ['VERY_HIGH', '极高'], ['UNKNOWN', '未知'],
] as const;

export const stationNumber = (v: number | undefined, digits = 0) => v !== undefined && Number.isFinite(v)
  ? v.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—';
export const stationRatio = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && b !== 0 ? a / b : NaN;
export const stationDelta = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined ? a - b : NaN;
export const stationPercent = (v: number) => Number.isFinite(v) ? `${stationNumber(v * 100, 2)}%` : '—';
export const stationSigned = (v: number) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${stationNumber(v, 2)}` : '—';
export const stationLevelCount = (row: StationValidationDay | undefined, level: string) => row ? row.levels[level] ?? 0 : undefined;
export const stationPreviousDate = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

export function stationCalendar(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`) && dates.length < 366; t += 86400000) dates.push(new Date(t).toISOString().slice(0, 10));
  return dates;
}

export function stationSelection(data: StationValidationResult, id: string, start: string, end: string, baseline: string) {
  const group = data.rows.filter((row) => row.station_id === id);
  const lookup = new Map(group.map((row) => [row.dt, row]));
  const rows = group.filter((row) => row.dt >= start && row.dt <= end);
  return {
    rows, lookup, current: lookup.get(end), previous: lookup.get(stationPreviousDate(end)), base: lookup.get(baseline),
    userDays: rows.reduce((sum, row) => sum + row.users, 0),
    missing: stationCalendar(start, end).filter((date) => !lookup.has(date)),
  };
}
