import { describe, expect, it } from 'vitest';
import type { ReportDataSource } from '@/types/report';
import { filterReportSources } from './reportSourceSearch';

const sources = [
  { id: '1', name: 'epower_platform.price_sensitive', description: '充电用户价敏标签', api_name: 'price_sensitive' },
  { id: '2', name: 'epower_platform.main_station_180d_downstream', description: '近 180 天充电订单明细', api_name: 'main_station_180d_downstream' },
] as ReportDataSource[];

describe('data source search', () => {
  it('matches the source name, Chinese purpose and API name without case sensitivity', () => {
    expect(filterReportSources(sources, '价敏').map((source) => source.id)).toEqual(['1']);
    expect(filterReportSources(sources, 'MAIN_STATION').map((source) => source.id)).toEqual(['2']);
    expect(filterReportSources(sources, 'epower_platform.price').map((source) => source.id)).toEqual(['1']);
  });

  it('returns the complete catalog for an empty query', () => {
    expect(filterReportSources(sources, '  ')).toEqual(sources);
  });
});
