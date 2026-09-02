import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createConversationCheckpoint,
  getConversationCheckpoint,
} from '@/api/context';
import type { Conversation, ConversationAgent } from '@/types/conversation';
import type { ForkConversationRequest } from '@/types/context';
import type { Message } from '@/types/message';
import { copyText } from '@/utils/clipboard';
import { message } from '@/utils/message';
import {
  conversationToMarkdown,
  forkConversationFromLatest,
  hasExportableMessage,
  loadCompleteConversation,
} from './conversationActions';
import { selectForkAgent } from './conversationActionSelection';

interface UseConversationActionsInput {
  conversation?: Conversation;
  messages: readonly Message[];
  conversationAgents: readonly ConversationAgent[];
  isGenerating: boolean;
  createFork: (
    sourceConversationId: string,
    request: ForkConversationRequest,
  ) => Promise<unknown>;
  onForkCreated?: () => void;
}

export function useConversationActions({
  conversation,
  messages,
  conversationAgents,
  isGenerating,
  createFork,
  onForkCreated,
}: UseConversationActionsInput) {
  const [copying, setCopying] = useState(false);
  const [forking, setForking] = useState(false);
  const activeConversationIdRef = useRef(conversation?.id);

  useEffect(() => {
    activeConversationIdRef.current = conversation?.id;
    setCopying(false);
    setForking(false);
  }, [conversation?.id]);

  const forkAgentId = useMemo(
    () => selectForkAgent(conversation, messages, conversationAgents),
    [conversation, conversationAgents, messages],
  );

  const hasForkableMessage = messages.some(hasExportableMessage);
  const forkDisabledReason = isGenerating
    ? '当前回复完成后才能 Fork'
    : !forkAgentId
      ? '当前对话没有可用的 Agent'
      : !hasForkableMessage
        ? '当前对话还没有可 Fork 的消息'
        : undefined;

  const copyConversation = useCallback(async () => {
    if (!conversation || copying) return;
    setCopying(true);
    try {
      const history = await loadCompleteConversation(conversation.id);
      const exportable = history.filter(hasExportableMessage);
      if (exportable.length === 0) {
        message.info('当前对话还没有可复制的消息');
        return;
      }
      await copyText(conversationToMarkdown(conversation.title, history));
      message.success(`已复制 ${exportable.length} 条对话消息`);
    } catch {
      message.error('复制对话失败，请稍后重试');
    } finally {
      setCopying(false);
    }
  }, [conversation, copying]);

  const forkConversation = useCallback(async () => {
    if (!conversation || !forkAgentId || forkDisabledReason || forking) return;
    setForking(true);
    try {
      await forkConversationFromLatest(
        { conversationId: conversation.id, agentId: forkAgentId },
        {
          createCheckpoint: createConversationCheckpoint,
          readCheckpoint: getConversationCheckpoint,
          createFork: (sourceConversationId, request) => {
            if (activeConversationIdRef.current !== sourceConversationId) {
              throw new Error('已切换对话，本次 Fork 已取消');
            }
            return createFork(sourceConversationId, request);
          },
        },
      );
      onForkCreated?.();
      message.success('Fork 已创建，正在打开独立对话');
    } catch (error) {
      const reason = error instanceof Error && error.message
        ? error.message
        : '创建 Fork 失败，请稍后重试';
      message.error(reason);
    } finally {
      setForking(false);
    }
  }, [conversation, createFork, forkAgentId, forkDisabledReason, forking, onForkCreated]);

  return {
    copying,
    forking,
    forkDisabledReason,
    copyConversation,
    forkConversation,
  };
}
