import type { AgentRuntimeOverview } from '@/types/agent';

export interface RuntimeMetric {
  key: string;
  label: string;
  value: string;
}

const integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

export function buildRuntimeMetrics(overview: AgentRuntimeOverview): RuntimeMetric[] {
  return [
    { key: 'conversations', label: '对话数', value: integerFormatter.format(overview.conversation_count) },
    { key: 'executions', label: '执行次数', value: integerFormatter.format(overview.execution_count) },
    { key: 'tool_calls', label: '工具调用', value: integerFormatter.format(overview.tool_call_count) },
    { key: 'tokens', label: '累计 Token', value: integerFormatter.format(overview.total_tokens) },
  ];
}

export function getRuntimeStatusMeta(status: string): { label: string; className: 'completed' | 'running' | 'failed' } {
  switch (status) {
    case 'complete':
    case 'completed':
      return { label: '已完成', className: 'completed' };
    case 'streaming':
    case 'running':
      return { label: '进行中', className: 'running' };
    default:
      return { label: '失败', className: 'failed' };
  }
}
