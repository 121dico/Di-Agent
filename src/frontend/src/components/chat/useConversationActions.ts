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
  forkConversationFromMessage,
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
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const activeConversationIdRef = useRef(conversation?.id);

  useEffect(() => {
    activeConversationIdRef.current = conversation?.id;
    setCopying(false);
    setForking(false);
    setForkingMessageId(null);
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

  const forkMessage = useCallback(async (selected: Message) => {
    if (!conversation || selected.role !== 'assistant' || selected.status === 'streaming' || forkingMessageId) return;
    let selectedAgentId = '';
    if (selected.artifacts_json) {
      try {
        const metadata = JSON.parse(selected.artifacts_json) as { agent_id?: unknown };
        if (typeof metadata.agent_id === 'string') selectedAgentId = metadata.agent_id;
      } catch {
        // Legacy message metadata can be invalid; direct-chat fallback below stays usable.
      }
    }
    selectedAgentId ||= conversation.type === 'agent' ? (conversation.peer_id ?? '') : forkAgentId;
    if (!selectedAgentId) {
      message.error('无法确定这条回复对应的 Agent');
      return;
    }

    setForkingMessageId(selected.id);
    try {
      await forkConversationFromMessage(
        { conversationId: conversation.id, messageId: selected.id, agentId: selectedAgentId },
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
      message.success('已从此回复创建 Fork');
    } catch (error) {
      message.error(error instanceof Error && error.message
        ? error.message
        : '创建 Fork 失败，请稍后重试');
    } finally {
      setForkingMessageId(null);
    }
  }, [conversation, createFork, forkAgentId, forkingMessageId, onForkCreated]);

  return {
    copying,
    forking,
    forkingMessageId,
    forkDisabledReason,
    copyConversation,
    forkConversation,
    forkMessage,
  };
}
