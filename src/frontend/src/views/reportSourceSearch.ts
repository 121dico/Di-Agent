import type { ReportDataSource } from '@/types/report';

export function filterReportSources(sources: ReportDataSource[], rawQuery: string): ReportDataSource[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return sources;
  return sources.filter((source) => [source.name, source.description, source.api_name]
    .some((value) => value.toLocaleLowerCase().includes(query)));
}
