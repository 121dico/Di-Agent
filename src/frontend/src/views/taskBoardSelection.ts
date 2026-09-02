import type { Conversation } from '@/types/conversation';

interface TaskConversationLike {
  id: string;
}

export function isTaskConversation(conversation: Conversation): boolean {
  return conversation.type === 'group' || conversation.type === 'agent';
}

export function getTaskBoardConversations(conversations: readonly Conversation[]): Conversation[] {
  return conversations.filter(isTaskConversation);
}

export function resolveActiveTaskConversationId(
  taskConversations: readonly TaskConversationLike[],
  activeConversationId?: string | null,
): string | null {
  if (activeConversationId && taskConversations.some((conversation) => conversation.id === activeConversationId)) {
    return activeConversationId;
  }
  return taskConversations[0]?.id ?? null;
}
