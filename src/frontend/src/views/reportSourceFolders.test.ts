import { describe, expect, it } from 'vitest';
import type { ReportDataSource } from '@/types/report';
import { groupReportSourcesByFolder } from './reportSourceFolders';

function source(id: string, folder?: string): ReportDataSource {
  return {
    id,
    name: `source-${id}`,
    description: '',
    api_name: `api_${id}`,
    endpoint: '',
    app_key_env: '',
    signature_env: '',
    x_date_env: '',
    enabled: true,
    created_at: '',
    folder,
  };
}

describe('report source folders', () => {
  it('groups sources by trimmed folder name and keeps ungrouped last', () => {
    const groups = groupReportSourcesByFolder([
      source('1', '价敏标签'),
      source('2', ' 价敏标签 '),
      source('3', '充电场站'),
      source('4'),
      source('5', '   '),
    ]);

    expect(groups.map((group) => group.label)).toEqual(['充电场站', '价敏标签', '未分组']);
    expect(groups[1]?.sources.map((item) => item.id)).toEqual(['1', '2']);
    expect(groups[2]?.sources.map((item) => item.id)).toEqual(['4', '5']);
  });
});
