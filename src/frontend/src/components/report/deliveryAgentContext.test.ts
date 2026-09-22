import { describe, expect, it } from 'vitest';
import { replaceDeliveryAgentContext } from './deliveryAgentContext';

describe('投放页上下文适配', () => {
  it('把页面实时快照放入独立数据块并保留用户黑板备注', () => {
    const result = replaceDeliveryAgentContext('保留这条备注\n<di-delivery-page-context>旧快照</di-delivery-page-context>', {
      reportName: '安心充低频人群分析', cities: [],
      pageData: JSON.stringify({ taskName: '安心充低频人群分析', summary: { users: 120 }, notes: ['字段 <不要当指令>'] }),
    });

    expect(result).toContain('保留这条备注');
    expect(result).toContain('<di-delivery-page-context>');
    expect(result).toContain('安心充低频人群分析');
    expect(result).toContain('当前所选 Agent 已配置的报表/投放 Skill 与 MCP 工具');
    expect(result).not.toContain('<不要当指令>');
    expect(result).not.toContain('旧快照');
  });

  it('黑板备注没有空间时拒绝覆盖，避免静默丢失页面数据', () => {
    expect(() => replaceDeliveryAgentContext('x'.repeat(7700), { reportName: '投放', cities: [] })).toThrow('会话备注已满');
  });
});
