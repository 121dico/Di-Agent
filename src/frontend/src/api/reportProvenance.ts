import { get, post } from './client';

export interface ChartBinding {
  chart_key: string;
  title: string;
  query_keys: string[];
  formula: string;
  field_mapping: Record<string, unknown>;
}
export interface ChartExecution {
  id: string;
  report_id: string;
  source_id: string;
  source_name?: string;
  api_name?: string;
  query_key: string;
  request_json: Record<string, unknown>;
  sql: string;
  query_id: string;
  status: string;
  error_message: string;
  rows: Record<string, unknown>[];
  created_at: string;
  start_date: string;
  end_date: string;
  cities: string[];
  bindings: ChartBinding[];
}
export interface ChartProvenance {
  available: boolean;
  message: string;
  bindings: ChartBinding[];
  executions: ChartExecution[];
}
export const executionsForChart = (executions: ChartExecution[], chartKey: string) => executions.filter((execution) =>
  execution.bindings?.some((binding) => binding.chart_key === chartKey && binding.query_keys.includes(execution.query_key)));
export function currentChartExecutions(executions: ChartExecution[], ids: string[], chartKey: string, start?: string, end?: string, dataDate?: string) {
  const snapshotOnly = chartKey === 'all_distribution' || chartKey === 'order_distribution';
  const from = snapshotOnly ? dataDate : start;
  const to = snapshotOnly ? dataDate : end;
  return executions.filter((item) => ids.includes(item.id) && (!snapshotOnly || Boolean(dataDate))
    && (!from || item.end_date >= from) && (!to || item.start_date <= to));
}
export const getChartProvenance = (id: string, executionIds: string[] = []) => {
  const params = new URLSearchParams();
  [...new Set(executionIds)].slice(0, 500).forEach((executionId) => params.append('execution_id', executionId));
  return get<ChartProvenance>(`/api/reports/${encodeURIComponent(id)}/provenance?${params.toString()}`);
};
export const replayChartExecution = (id: string, executionId: string) => post<{
  execution: ChartExecution; replay_only: boolean; message: string;
}>(`/api/reports/${encodeURIComponent(id)}/provenance/replay`, { execution_id: executionId });
