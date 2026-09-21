import { describe, expect, it } from 'vitest';
import { replaceReportAgentContext } from './reportAgentContext';

describe('报表问题上下文', () => {
  it('只替换报表数据区，保留用户黑板，并限制附带的数据范围', () => {
    const first = replaceReportAgentContext('我的备注：请先解释口径。', {
      reportId: 'report-1', reportName: '旧报表', cities: ['北京'], dataDate: '2026-09-18',
    });
    const second = replaceReportAgentContext(first, {
      reportId: 'report-2', reportName: '当前报表', cities: ['上海'], dataDate: '2026-09-19', dateRange: '最近 7 天', summary: '聚合人数：100',
    });
    expect(second).toContain('我的备注：请先解释口径。');
    expect(second).toContain('当前报表');
    expect(second).toContain('2026-09-19');
    expect(second).toContain('最近 7 天');
    expect(second).not.toContain('旧报表');
    expect(second).not.toContain('北京');
    expect(second.match(/报表页面数据/g)).toHaveLength(1);
    expect(replaceReportAgentContext('', { reportName: '报表', cities: [], summary: 'x'.repeat(20_000) }).length).toBeLessThan(6000);
  });
});
