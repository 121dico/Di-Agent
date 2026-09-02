import { describe, expect, it } from 'vitest';
import { buildRuntimeMetrics, getRuntimeStatusMeta } from './agentRuntimePresentation';

describe('agentRuntimePresentation', () => {
  it('builds metrics from the backend overview without placeholder values', () => {
    expect(buildRuntimeMetrics({
      period_days: 7,
      conversation_count: 12,
      execution_count: 18,
      tool_call_count: 1042,
      total_tokens: 250000,
      recent_runs: [],
    })).toEqual([
      { key: 'conversations', label: '对话数', value: '12' },
      { key: 'executions', label: '执行次数', value: '18' },
      { key: 'tool_calls', label: '工具调用', value: '1,042' },
      { key: 'tokens', label: '累计 Token', value: '250,000' },
    ]);
  });

  it('maps persisted message statuses to user-facing states', () => {
    expect(getRuntimeStatusMeta('complete')).toEqual({ label: '已完成', className: 'completed' });
    expect(getRuntimeStatusMeta('streaming')).toEqual({ label: '进行中', className: 'running' });
    expect(getRuntimeStatusMeta('error')).toEqual({ label: '失败', className: 'failed' });
  });
});
