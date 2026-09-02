import type { Message } from '@/types/message';

export const EMPTY_TASK_MESSAGES: readonly Message[] = [];

export function selectTaskMessageLists(
  messages: Readonly<Record<string, readonly Message[]>>,
  taskConversationIds: readonly string[],
): ReadonlyArray<readonly Message[]> {
  return taskConversationIds.map((conversationId) => (
    messages[conversationId] ?? EMPTY_TASK_MESSAGES
  ));
}
