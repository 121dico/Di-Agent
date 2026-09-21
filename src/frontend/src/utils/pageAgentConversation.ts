import type { Conversation } from '@/types/conversation';

/** 页面 Agent 由固定名称创建；旧会话标题也保留用于兼容 Agent 改名。 */
export function pageAgentPath(name: string): string | null {
  if (name === '报表agent') return '/reports';
  if (name === '投放agent' || name === '投放agent（旧环境鉴权失败）') return '/delivery-analysis';
  return null;
}

export function isPageAgentConversation(conversation: Conversation): boolean {
  if (conversation.type === 'group') return conversation.title === '投放分析';
  return conversation.type === 'agent'
    && Boolean(pageAgentPath(conversation.peer_name ?? '') || pageAgentPath(conversation.title));
}
