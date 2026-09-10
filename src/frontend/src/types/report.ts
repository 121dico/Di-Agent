export type ReportRow = Record<string, unknown>;

export interface ReportDataSource {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  api_name: string;
  app_key_env: string;
  signature_env: string;
  x_date_env: string;
  enabled: boolean;
  created_at: string;
}

export interface ReportFieldContract {
  id?: string;
  name: string;
  data_type: string;
  label?: string;
  description?: string;
  sensitive: boolean;
  enabled: boolean;
  selectable: boolean;
  filterable: boolean;
  groupable: boolean;
  aggregatable: boolean;
  sortable: boolean;
}

export interface ReportDataSourceContract {
  source_id: string;
  name: string;
  description: string;
  endpoint: string;
  api_name: string;
  app_key_env: string;
  signature_env: string;
  x_date_env: string;
  api_example: string;
  response_example: string;
  hive_table: string;
  hive_ddl: string;
  hive_example: string;
  enabled: boolean;
  fields: ReportFieldContract[];
  updated_at?: string;
}

export interface ReportMetricConfig { field: string; label: string; suffix?: string }
export interface ReportSeriesConfig { field: string; label: string; color?: string }
export interface ReportVisualization {
  template?: { id: string; version: string; renderer: string; profile: string; partition_mode: string };
  metrics?: ReportMetricConfig[];
  chart?: { xField: string; series: ReportSeriesConfig[] };
  detail?: { defaultGroup?: 'all' | 'd1' | 'd2' | 'd3' | 'd4' | 'result' };
  analytics?: { enabled: boolean };
}

export type ReportAnalyticsRange = 'all' | '1d' | '7d' | '30d' | '31d' | '365d';

export interface ReportAnalyticsTrendPoint {
  total_user_count?: number;
  order_user_count?: number;
  distribution?: Array<{ level: string; user_count: number }>;
  order_distribution?: Array<{ level: string; user_count: number }>;
  nullable_scores?: Record<string, number | null>;
  dt: string;
  average_price_sensitivity_score: number;
  average_d1_price_score: number;
  average_d2_coupon_score: number;
  average_d3_time_score: number;
  total_order_count: number;
  calculated_user_count: number;
  daily_net_user_growth?: number;
  daily_growth_available?: boolean;
  daily_user_growth_rate?: number;
  cumulative_net_user_growth?: number;
}

export interface ReportAnalyticsResult {
  available_dates?: string[];
  counting_basis?: string;
  order_cohort?: { user_count: number; share: number; distribution: Array<{ level: string; user_count: number }> };
  profile?: string;
  data_date?: string;
  fetched_at?: string;
  query_ids?: string[];
  missing_dates?: string[];
  assigned_by_type?: Record<string, number>;
  range: ReportAnalyticsRange;
  start_date: string;
  end_date: string;
  cached: boolean;
  summary: {
    average_price_sensitivity_score: number;
    total_user_count: number;
    total_order_count: number;
    calculated_user_count: number;
    calculated_user_share: number;
    high_sensitivity_share: number;
    medium_sensitivity_share: number;
    low_sensitivity_share: number;
    baseline_calculated_user_count?: number;
    latest_daily_net_user_growth?: number;
    cumulative_net_user_growth?: number;
    latest_user_growth_rate?: number;
    average_daily_net_user_growth?: number;
  };
  trend: ReportAnalyticsTrendPoint[];
  distribution: Array<{ level: string; user_count: number }>;
  duration_ms: number;
}

export interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  data_source_id: string;
  query: Record<string, unknown>;
  visualization: ReportVisualization;
  enabled: boolean;
  created_at: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  version: string;
  renderer: string;
  description: string;
  profiles: Record<string, { name: string }>;
}

export interface ReportRun {
  id: string;
  report_id: string;
  trigger: 'manual' | 'scheduled';
  status: 'pending' | 'succeeded' | 'failed';
  snapshot?: ReportRow[];
  source_partition?: string;
  duration_ms: number;
  error_message?: string;
  started_at: string;
  finished_at?: string;
}

export interface ReportPagination {
  total: number;
  page: number;
  page_size: number;
  page_count: number;
}

export interface ReportPageResult {
  rows: ReportRow[];
  pagination: ReportPagination;
  source_partition?: string;
  query_id?: string;
  duration_ms: number;
}
