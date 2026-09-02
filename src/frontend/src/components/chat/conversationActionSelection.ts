import type { Conversation, ConversationAgent } from '@/types/conversation';
import type { Message } from '@/types/message';

function latestRespondingAgent(
  messages: readonly Message[],
  conversationAgents: readonly ConversationAgent[],
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role !== 'assistant' || !item.artifacts_json) continue;
    try {
      const metadata = JSON.parse(item.artifacts_json) as { agent_id?: unknown };
      if (
        typeof metadata.agent_id === 'string'
        && conversationAgents.some((agent) => agent.agent_id === metadata.agent_id)
      ) {
        return metadata.agent_id;
      }
    } catch {
      // 旧消息元数据无法解析时，继续使用成员角色兜底。
    }
  }
  return '';
}

export function selectForkAgent(
  conversation: Conversation | undefined,
  messages: readonly Message[],
  conversationAgents: readonly ConversationAgent[],
): string {
  if (conversation?.type === 'agent') return conversation.peer_id ?? '';
  if (conversation?.type !== 'group') return '';
  return conversationAgents.find((agent) => agent.role === 'orchestrator')?.agent_id
    || latestRespondingAgent(messages, conversationAgents)
    || conversationAgents[0]?.agent_id
    || '';
}
