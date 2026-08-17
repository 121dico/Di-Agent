import { del, get, post } from './client';
import type {
  ContextUsage,
  ContinueCheckpointRequest,
  ContinueCheckpointResult,
  ConversationCheckpoint,
  CreateCheckpointRequest,
  ImportCheckpointRequest,
  ForkConversationRequest,
  ConversationFork,
  ConversationForkResult,
} from '@/types/context';

export async function getConversationCheckpoints(
  conversationId: string,
): Promise<ConversationCheckpoint[]> {
  const result = await get<ConversationCheckpoint[] | null>(
    `/api/conversations/${conversationId}/checkpoints`,
  );
  return result ?? [];
}

export function forkConversation(
  sourceConversationId: string,
  body: ForkConversationRequest,
): Promise<ConversationForkResult> {
  return post<ConversationForkResult>(
    `/api/conversations/${sourceConversationId}/forks`,
    body,
  );
}

export function getConversationFork(
  childConversationId: string,
): Promise<ConversationFork | null> {
  return get<ConversationFork | null>(`/api/conversations/${childConversationId}/fork`);
}

export function getConversationCheckpoint(
  conversationId: string,
  checkpointId: string,
): Promise<ConversationCheckpoint> {
  return get<ConversationCheckpoint>(
    `/api/conversations/${conversationId}/checkpoints/${checkpointId}`,
  );
}

export function createConversationCheckpoint(
  conversationId: string,
  body: CreateCheckpointRequest,
): Promise<ConversationCheckpoint> {
  return post<ConversationCheckpoint>(
    `/api/conversations/${conversationId}/checkpoints`,
    body,
  );
}

export function deleteConversationCheckpoint(
  conversationId: string,
  checkpointId: string,
): Promise<void> {
  return del<void>(
    `/api/conversations/${conversationId}/checkpoints/${checkpointId}`,
  );
}

export function continueFromConversationCheckpoint(
  conversationId: string,
  checkpointId: string,
  body: ContinueCheckpointRequest,
): Promise<ContinueCheckpointResult> {
  return post<ContinueCheckpointResult>(
    `/api/conversations/${conversationId}/checkpoints/${checkpointId}/continue`,
    body,
  );
}

export function importConversationCheckpoint(
  targetConversationId: string,
  body: ImportCheckpointRequest,
): Promise<ContinueCheckpointResult> {
  return post<ContinueCheckpointResult>(
    `/api/conversations/${targetConversationId}/checkpoint-imports`,
    body,
  );
}

export async function getConversationContextUsage(
  conversationId: string,
): Promise<ContextUsage[]> {
  const result = await get<ContextUsage[] | null>(
    `/api/conversations/${conversationId}/context-usage`,
  );
  return result ?? [];
}
