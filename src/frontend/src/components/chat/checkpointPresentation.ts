import type { CheckpointScope, CheckpointStatus } from '@/types/context';

export const CHECKPOINT_STATUS_LABEL: Record<CheckpointStatus, string> = {
  draft: '准备中',
  generating: '正在压缩',
  ready: '可使用',
  fallback: '规则摘要',
  failed_fallback: '已使用兜底摘要',
  fallback_failed: '生成失败',
  failed: '生成失败',
  deleted: '已删除',
};

export const CHECKPOINT_SCOPE_LABEL: Record<CheckpointScope, string> = {
  private_agent: '仅来源 Agent',
  task_shared: '任务内共享',
  conversation_shared: '会话内共享',
  orchestrator_only: '仅编排 Agent',
};

export const CHECKPOINT_SCOPE_OPTIONS = (
  Object.entries(CHECKPOINT_SCOPE_LABEL) as [CheckpointScope, string][]
).map(([value, label]) => ({ value, label }));

export function checkpointTagColor(status: CheckpointStatus): string {
  if (status === 'ready') return 'green';
  if (status === 'fallback' || status === 'failed_fallback') return 'gold';
  if (status === 'draft' || status === 'generating') return 'processing';
  return 'error';
}

export function canContinueCheckpoint(status: CheckpointStatus): boolean {
  return status === 'ready' || status === 'fallback' || status === 'failed_fallback';
}

export function shortCheckpointId(value?: string | null): string {
  if (!value) return '未记录';
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
