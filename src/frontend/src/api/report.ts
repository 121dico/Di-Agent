import { get, post, put, getAuthHeaders } from './client';
import type { ReportAnalyticsRange, ReportAnalyticsResult, ReportDataSource, ReportDataSourceContract, ReportDefinition, ReportPageResult, ReportRun, ReportTemplate } from '@/types/report';

export const listReportTemplates = () => get<ReportTemplate[]>('/api/reports/templates');
export const applyReportTemplate = (templateId: string, sourceId: string) => post<ReportDefinition>('/api/reports/templates/apply', { template_id: templateId, source_id: sourceId });

export const listReportSources = () => get<ReportDataSource[] | null>('/api/reports/sources').then((rows) => rows ?? []);
export const createReportSource = (body: Omit<ReportDataSource, 'id' | 'created_at'>) => post<ReportDataSource>('/api/reports/sources', body);
export const getReportSourceContract = (id: string) => get<ReportDataSourceContract>(`/api/reports/sources/${id}/contract`);
export const saveReportSourceContract = (id: string, body: ReportDataSourceContract) => put<ReportDataSourceContract>(`/api/reports/sources/${id}/contract`, body);
export const listReports = () => get<ReportDefinition[] | null>('/api/reports').then((rows) => rows ?? []);
export const createReport = (body: Omit<ReportDefinition, 'id' | 'created_at'>) => post<ReportDefinition>('/api/reports', body);
export const updateReport = (id: string, body: Omit<ReportDefinition, 'id' | 'created_at'>) => put<ReportDefinition>(`/api/reports/${id}`, body);
export const runReport = (id: string, range?: ReportAnalyticsRange, cities: string[] = []) => {
  const params = new URLSearchParams();
  if (range) params.set('range', range);
  cities.forEach((city) => params.append('city', city));
  return post<ReportRun>(`/api/reports/${id}/run?${params.toString()}`);
};
export const listReportRuns = (id: string) => get<ReportRun[] | null>(`/api/reports/${id}/runs`).then((rows) => rows ?? []);
export const queryReportPage = (id: string, page: number, pageSize: number) => get<ReportPageResult>(`/api/reports/${id}/data?page=${page}&page_size=${pageSize}`);
export const queryReportSearch = (id: string, duid: string) => get<ReportPageResult>(`/api/reports/${id}/search?duid=${encodeURIComponent(duid)}`);
export const queryReportAnalytics = (id: string, range: ReportAnalyticsRange | 'dates', endDate?: string, cities: string[] = []) => {
  const params = new URLSearchParams({ range });
  if (endDate) params.set('end_date', endDate);
  cities.forEach((city) => params.append('city', city));
  return get<ReportAnalyticsResult>(`/api/reports/${id}/analytics?${params.toString()}`);
};

export async function downloadReportRun(reportId: string, runId: string): Promise<void> {
  const response = await fetch(`/api/reports/${reportId}/runs/${runId}/download`, { headers: getAuthHeaders() });
  if (!response.ok) throw new Error('下载报表失败');
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `report-${runId}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}
