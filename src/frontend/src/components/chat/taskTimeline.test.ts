import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types/conversation';
import type { Message } from '@/types/message';
import { projectTaskTimeline } from './taskTimeline';

const conversations: Conversation[] = [
  {
    id: 'agent-conv',
    user_id: 'user-1',
    type: 'agent',
    title: 'Codex 私聊',
    pinned: false,
    created_at: '2026-08-24T08:00:00.000Z',
    updated_at: '2026-08-24T08:05:00.000Z',
  },
];

function userMessage(id: string, content: string, createdAt: string): Message {
  return {
    id,
    conversation_id: 'agent-conv',
    role: 'user',
    content,
    artifacts_json: null,
    created_at: createdAt,
  };
}

describe('projectTaskTimeline', () => {
  it('reconstructs a completed task and its checked steps from persisted blocks_json', () => {
    const messages: Message[] = [
      userMessage('user-1', '修复私聊任务同步并补齐测试', '2026-08-24T08:00:00.000Z'),
      {
        id: 'assistant-1',
        conversation_id: 'agent-conv',
        role: 'assistant',
        username: 'Codex',
        content: '同步已完成。',
        artifacts_json: null,
        blocks_json: JSON.stringify([
          { index: 0, kind: 'thinking', text: '检查消息和任务事件' },
          { index: 1, kind: 'tool_use', text: '{"path":"TaskBoardView.tsx"}', tool_name: 'Read' },
          { index: 2, kind: 'tool_result', text: '找到 task.changed 订阅' },
          { index: 3, kind: 'text', text: '同步已完成。' },
        ]),
        status: 'complete',
        created_at: '2026-08-24T08:00:02.000Z',
      },
    ];

    const timeline = projectTaskTimeline({ 'agent-conv': messages }, conversations);

    expect(timeline.active).toEqual([]);
    expect(timeline.completed).toHaveLength(1);
    expect(timeline.completed[0]).toMatchObject({
      id: 'assistant-1',
      title: '修复私聊任务同步并补齐测试',
      agentName: 'Codex',
      conversationTitle: 'Codex 私聊',
      status: 'complete',
      result: '同步已完成。',
    });
    expect(timeline.completed[0]?.steps.map((step) => [step.label, step.status])).toEqual([
      ['分析任务', 'completed'],
      ['读取文件', 'completed'],
      ['工具返回', 'completed'],
      ['生成回复', 'completed'],
      ['完成交付', 'completed'],
    ]);
  });

  it('keeps only the current streaming step running', () => {
    const messages: Message[] = [
      userMessage('user-2', '生成销售分析页面', '2026-08-24T08:10:00.000Z'),
      {
        id: 'assistant-2',
        conversation_id: 'agent-conv',
        role: 'assistant',
        username: 'Codex',
        content: '',
        artifacts_json: null,
        blocks: [
          { index: 0, kind: 'thinking', text: '规划页面结构' },
          { index: 1, kind: 'tool_use', text: '{"cmd":"npm test"}', tool_name: 'Bash' },
        ],
        status: 'streaming',
        created_at: '2026-08-24T08:10:01.000Z',
      },
    ];

    const timeline = projectTaskTimeline({ 'agent-conv': messages }, conversations);

    expect(timeline.completed).toEqual([]);
    expect(timeline.active[0]?.steps.map((step) => step.status)).toEqual(['completed', 'running', 'pending']);
    expect(timeline.active[0]).toMatchObject({
      title: '生成销售分析页面',
      currentStep: '运行命令',
      completedStepCount: 1,
      progress: 33,
    });
    const activeSteps = timeline.active[0]?.steps ?? [];
    expect(activeSteps[activeSteps.length - 1]).toMatchObject({
      kind: 'lifecycle',
      label: '完成交付',
      status: 'pending',
    });
  });

  it('falls back to lifecycle detail when persisted blocks_json is malformed or unknown', () => {
    const messages: Message[] = [
      userMessage('user-legacy', '查看旧任务', '2026-08-24T08:15:00.000Z'),
      {
        id: 'assistant-legacy',
        conversation_id: 'agent-conv',
        role: 'assistant',
        content: '旧任务结果',
        artifacts_json: null,
        blocks_json: JSON.stringify([{ index: 0, kind: 'unknown_kind', text: '不可识别内容' }]),
        status: 'complete',
        created_at: '2026-08-24T08:15:01.000Z',
      },
    ];

    const task = projectTaskTimeline({ 'agent-conv': messages }, conversations).completed[0];

    expect(task?.steps).toEqual([
      expect.objectContaining({ label: '完成交付', status: 'completed', detail: '旧任务结果' }),
    ]);
    expect(task?.result).toBe('旧任务结果');
  });

  it('ignores human direct-message conversations outside task eligibility', () => {
    const directConversation: Conversation = {
      id: 'single-conv',
      user_id: 'user-1',
      type: 'single',
      title: '用户私聊',
      pinned: false,
      created_at: '2026-08-24T08:00:00.000Z',
      updated_at: '2026-08-24T08:05:00.000Z',
    };
    const messages: Message[] = [
      {
        ...userMessage('single-user', '普通私聊消息', '2026-08-24T08:16:00.000Z'),
        conversation_id: 'single-conv',
      },
      {
        id: 'single-assistant',
        conversation_id: 'single-conv',
        role: 'assistant',
        content: '这不应成为任务',
        artifacts_json: null,
        status: 'complete',
        created_at: '2026-08-24T08:16:01.000Z',
      },
    ];

    const timeline = projectTaskTimeline({ 'single-conv': messages }, [...conversations, directConversation]);

    expect(timeline).toEqual({ active: [], completed: [] });
  });

  it.each([
    ['error', 'failed', '执行失败', '权限不足'],
    ['canceled', 'canceled', '任务已取消', '任务已由用户取消'],
  ] as const)('adds a lifecycle detail for a %s message without terminal blocks', (messageStatus, stepStatus, label, summary) => {
    const messages: Message[] = [
      userMessage(`user-${messageStatus}`, '处理客户数据', '2026-08-24T08:20:00.000Z'),
      {
        id: `assistant-${messageStatus}`,
        conversation_id: 'agent-conv',
        role: 'assistant',
        content: messageStatus === 'error' ? '权限不足' : '',
        artifacts_json: null,
        blocks: [{ index: 0, kind: 'thinking', text: '读取数据源' }],
        status: messageStatus,
        created_at: '2026-08-24T08:20:01.000Z',
      },
    ];

    const timeline = projectTaskTimeline({ 'agent-conv': messages }, conversations);
    const task = timeline.completed[0];

    expect(task?.status).toBe(messageStatus);
    expect(task?.steps[task.steps.length - 1]).toMatchObject({ label, status: stepStatus, summary });
    expect(task?.result).toBe(messageStatus === 'error' ? '权限不足' : '任务已由用户取消，已完成的步骤记录仍保留。');
  });
});
