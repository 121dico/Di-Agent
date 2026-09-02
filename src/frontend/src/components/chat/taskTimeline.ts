import type { Conversation } from '@/types/conversation';
import type { Message, MessageBlock, MessageStatus } from '@/types/message';
import { isTaskConversation } from '@/views/taskBoardSelection';

export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
export type TaskTimelineStatus = Exclude<MessageStatus, 'streaming'> | 'streaming';

export interface TaskTimelineStep {
  id: string;
  kind: MessageBlock['kind'] | 'lifecycle';
  label: string;
  summary: string;
  detail: string;
  status: TaskStepStatus;
}

export interface TaskTimelineItem {
  id: string;
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  agentName: string;
  title: string;
  status: TaskTimelineStatus;
  recordedAt: number;
  steps: TaskTimelineStep[];
  currentStep: string;
  completedStepCount: number;
  progress: number;
  result: string;
}

export interface TaskTimeline {
  active: TaskTimelineItem[];
  completed: TaskTimelineItem[];
}

const COMPLETED_CAP = 20;
const TITLE_CAP = 72;
const validBlockKinds = new Set<MessageBlock['kind']>([
  'thinking',
  'tool_use',
  'tool_result',
  'text',
  'error',
  'card',
]);

const toolLabels: Record<string, string> = {
  Bash: '运行命令',
  Edit: '编辑文件',
  Glob: '查找文件',
  Grep: '搜索代码',
  Read: '读取文件',
  Task: '调用协作 Agent',
  TodoWrite: '更新任务计划',
  WebFetch: '读取网页',
  WebSearch: '搜索资料',
  Write: '写入文件',
};

function compactText(value: string | undefined, cap = 160): string {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  if (compact.length <= cap) return compact;
  return `${compact.slice(0, cap)}…`;
}

function messageBlocks(message: Message): MessageBlock[] {
  if (message.blocks && message.blocks.length > 0) return message.blocks;
  if (!message.blocks_json) return [];
  try {
    const parsed: unknown = JSON.parse(message.blocks_json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((block): block is MessageBlock => {
      if (!block || typeof block !== 'object') return false;
      const candidate = block as Partial<MessageBlock>;
      return typeof candidate.kind === 'string'
        && validBlockKinds.has(candidate.kind as MessageBlock['kind'])
        && typeof candidate.text === 'string';
    });
  } catch {
    return [];
  }
}

function agentName(message: Message): string {
  if (message.username?.trim()) return message.username.trim();
  if (message.artifacts_json) {
    try {
      const artifacts: unknown = JSON.parse(message.artifacts_json);
      if (artifacts && typeof artifacts === 'object') {
        const name = (artifacts as { agent_name?: unknown }).agent_name;
        if (typeof name === 'string' && name.trim()) return name.trim();
      }
    } catch {
      // 老消息的 artifacts_json 可能不是合法 JSON，继续使用稳定降级名。
    }
  }
  return 'Agent';
}

function labelForBlock(block: MessageBlock): string {
  switch (block.kind) {
    case 'thinking':
      return '分析任务';
    case 'tool_use':
      return toolLabels[block.tool_name ?? ''] ?? `使用 ${block.tool_name || '工具'}`;
    case 'tool_result':
      return '工具返回';
    case 'text':
      return '生成回复';
    case 'error':
      return '执行失败';
    case 'card':
      return '生成交互卡片';
  }
}

function initialStepStatus(block: MessageBlock): TaskStepStatus {
  return block.kind === 'error' || block.is_error ? 'failed' : 'completed';
}

function deriveSteps(message: Message): TaskTimelineStep[] {
  const blocks = messageBlocks(message);
  const steps: TaskTimelineStep[] = [];

  blocks.forEach((block, index) => {
    const label = labelForBlock(block);
    const detail = block.text.trim();
    const summary = compactText(detail || block.tool_name, 88);
    steps.push({
      id: `${message.id}:${block.index ?? index}`,
      kind: block.kind,
      label,
      summary,
      detail,
      status: initialStepStatus(block),
    });
  });

  const status = message.status ?? 'complete';
  if (status === 'streaming') {
    if (steps.length === 0) {
      steps.push({
        id: `${message.id}:preparing`,
        kind: 'lifecycle',
        label: '准备执行',
        summary: 'Agent 正在接收任务',
        detail: 'Agent 正在接收任务并准备执行。',
        status: 'running',
      });
    } else if (steps[steps.length - 1]?.status !== 'failed') {
      steps[steps.length - 1]!.status = 'running';
    }
    steps.push({
      id: `${message.id}:delivery`,
      kind: 'lifecycle',
      label: '完成交付',
      summary: '等待回复与任务明细写入完成',
      detail: '当前执行完成后，Agent 将保存回复与任务明细。',
      status: 'pending',
    });
    return steps;
  }

  if (status === 'error' && !steps.some((step) => step.status === 'failed')) {
    const detail = compactText(message.content, 500) || '任务执行过程中发生错误';
    steps.push({
      id: `${message.id}:failed`,
      kind: 'lifecycle',
      label: '执行失败',
      summary: compactText(detail, 88),
      detail,
      status: 'failed',
    });
  }

  if (status === 'canceled') {
    steps.push({
      id: `${message.id}:canceled`,
      kind: 'lifecycle',
      label: '任务已取消',
      summary: '任务已由用户取消',
      detail: '任务已由用户取消，已完成的步骤记录仍保留。',
      status: 'canceled',
    });
  }

  if (status === 'complete') {
    steps.push({
      id: `${message.id}:delivery`,
      kind: 'lifecycle',
      label: '完成交付',
      summary: '回复与任务明细已保存',
      detail: message.content.trim() || '该历史任务已完成，但没有结构化步骤记录。',
      status: 'completed',
    });
  }
  return steps;
}

function resultForMessage(message: Message, steps: readonly TaskTimelineStep[]): string {
  if (message.status === 'error' || message.status === 'canceled') {
    const terminal = lastMatchingStep(steps, (step) => step.status === 'failed' || step.status === 'canceled');
    if (terminal?.detail) return terminal.detail;
  }
  const blocks = messageBlocks(message);
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === 'text' && block.text.trim()) return block.text.trim();
  }
  if (message.content.trim()) return message.content.trim();
  return '';
}

function taskTitle(messages: readonly Message[], assistantIndex: number): string {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && message.content.trim()) {
      return compactText(message.content, TITLE_CAP);
    }
  }
  return 'Agent 任务';
}

function toTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function lastMatchingStep(
  steps: readonly TaskTimelineStep[],
  predicate: (step: TaskTimelineStep) => boolean,
): TaskTimelineStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step && predicate(step)) return step;
  }
  return undefined;
}

/**
 * 将已加载会话消息投影成任务时间线。它是纯函数，因此刷新后从 blocks_json
 * 还原的输入和流式期间的 blocks 输入遵循完全相同的步骤规则。
 */
export function projectTaskTimeline(
  messagesByConversation: Readonly<Record<string, readonly Message[]>>,
  conversations: readonly Conversation[],
): TaskTimeline {
  const taskConversations = conversations.filter(isTaskConversation);
  const conversationTitles = new Map(taskConversations.map((conversation) => [conversation.id, conversation.title]));
  const eligibleConversationIds = new Set(taskConversations.map((conversation) => conversation.id));
  const active: TaskTimelineItem[] = [];
  const completed: TaskTimelineItem[] = [];

  Object.entries(messagesByConversation).forEach(([conversationId, sourceMessages]) => {
    if (!eligibleConversationIds.has(conversationId)) return;
    const messages = [...sourceMessages].sort((left, right) => toTimestamp(left.created_at) - toTimestamp(right.created_at));
    messages.forEach((message, index) => {
      if (message.role !== 'assistant') return;
      const status = message.status ?? 'complete';
      const steps = deriveSteps(message);
      const completedStepCount = steps.filter((step) => step.status === 'completed').length;
      const progress = status === 'complete'
        ? 100
        : Math.round((completedStepCount / Math.max(steps.length, 1)) * 100);
      const currentStep = lastMatchingStep(steps, (step) => step.status === 'running')?.label
        ?? lastMatchingStep(steps, (step) => step.status !== 'completed')?.label
        ?? steps[steps.length - 1]?.label
        ?? '准备执行';
      const recordedAt = toTimestamp(message.created_at);
      const item: TaskTimelineItem = {
        id: message.id,
        messageId: message.id,
        conversationId,
        conversationTitle: conversationTitles.get(conversationId) || '对话',
        agentName: agentName(message),
        title: taskTitle(messages, index),
        status,
        recordedAt,
        steps,
        currentStep,
        completedStepCount,
        progress,
        result: resultForMessage(message, steps),
      };
      if (status === 'streaming') active.push(item);
      else completed.push(item);
    });
  });

  active.sort((left, right) => right.recordedAt - left.recordedAt);
  completed.sort((left, right) => right.recordedAt - left.recordedAt);
  return { active, completed: completed.slice(0, COMPLETED_CAP) };
}
