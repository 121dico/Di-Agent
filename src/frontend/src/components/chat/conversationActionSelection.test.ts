import { describe, expect, it } from 'vitest';
import type { Conversation, ConversationAgent } from '@/types/conversation';
import type { Message } from '@/types/message';
import { selectForkAgent } from './conversationActionSelection';

const group: Conversation = {
  id: 'conversation-1',
  user_id: 'user-1',
  type: 'group',
  title: '数据群聊',
  pinned: false,
  created_at: '2026-08-28T08:00:00Z',
  updated_at: '2026-08-28T08:00:00Z',
};

function agent(id: string, role: ConversationAgent['role']): ConversationAgent {
  return {
    id: `member-${id}`,
    conversation_id: group.id,
    agent_id: id,
    added_by: 'user-1',
    role,
    joined_at: '2026-08-28T08:00:00Z',
    name: id,
    type: 'local',
    cli_tool: 'codex',
    avatar: '',
    source: 'local',
    status: 'online',
    version: '',
    machine_name: '',
    capabilities_json: '{}',
  };
}

describe('selectForkAgent', () => {
  it('prefers the group orchestrator over the latest responding worker', () => {
    const messages: Message[] = [{
      id: 'message-1',
      conversation_id: group.id,
      role: 'assistant',
      content: 'worker reply',
      artifacts_json: JSON.stringify({ agent_id: 'worker-1' }),
      created_at: '2026-08-28T08:01:00Z',
    }];

    expect(selectForkAgent(group, messages, [
      agent('worker-1', 'worker'),
      agent('orchestrator-1', 'orchestrator'),
    ])).toBe('orchestrator-1');
  });
});
