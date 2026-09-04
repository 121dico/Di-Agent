import { stripKnowledgeRefs } from '@/components/knowledge/knowledgeReferenceState';
import { getMessages } from '@/api/message';
import type { Message, MessageBlock } from '@/types/message';
import { getConversationCheckpoint } from '@/api/context';
import type { ConversationCheckpoint } from '@/types/context';
import type { CreateCheckpointRequest, ForkConversationRequest } from '@/types/context';

type MessagePageLoader = (
  conversationId: string,
  before?: string,
  limit?: number,
) => Promise<Message[]>;

const TRANSCRIPT_PAGE_SIZE = 200;
const CHECKPOINT_POLL_INTERVAL_MS = 2000;
const CHECKPOINT_MAX_ATTEMPTS = 90;

type CheckpointReader = (
  conversationId: string,
  checkpointId: string,
) => Promise<ConversationCheckpoint>;

interface CheckpointWaitOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

interface ForkLatestInput {
  conversationId: string;
  agentId: string;
}

interface ForkMessageInput extends ForkLatestInput {
  messageId: string;
}

interface ForkLatestActions {
  createCheckpoint: (
    conversationId: string,
    request: CreateCheckpointRequest,
  ) => Promise<ConversationCheckpoint>;
  readCheckpoint: CheckpointReader;
  createFork: (
    conversationId: string,
    request: ForkConversationRequest,
  ) => Promise<unknown>;
}

function compareMessageTime(left: Message, right: Message): number {
  // Go 服务端输出规范化 RFC3339Nano；字符串比较可保留 Date 会丢失的微秒精度。
  return left.created_at.localeCompare(right.created_at);
}

function isForkableCheckpoint(checkpoint: ConversationCheckpoint): boolean {
  return checkpoint.status === 'ready' || checkpoint.status === 'failed_fallback';
}

function isPendingCheckpoint(checkpoint: ConversationCheckpoint): boolean {
  return checkpoint.status === 'draft' || checkpoint.status === 'generating';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export async function waitForForkableCheckpoint(
  conversationId: string,
  initialCheckpoint: ConversationCheckpoint,
  readCheckpoint: CheckpointReader = getConversationCheckpoint,
  options: CheckpointWaitOptions = {},
): Promise<ConversationCheckpoint> {
  if (isForkableCheckpoint(initialCheckpoint)) return initialCheckpoint;
  if (!isPendingCheckpoint(initialCheckpoint)) {
    throw new Error('检查点生成失败，无法创建 Fork');
  }

  const intervalMs = options.intervalMs ?? CHECKPOINT_POLL_INTERVAL_MS;
  const maxAttempts = options.maxAttempts ?? CHECKPOINT_MAX_ATTEMPTS;
  let current = initialCheckpoint;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (intervalMs > 0) await delay(intervalMs);
    current = await readCheckpoint(conversationId, current.id);
    if (isForkableCheckpoint(current)) return current;
    if (!isPendingCheckpoint(current)) {
      throw new Error(current.error_message || '检查点生成失败，无法创建 Fork');
    }
  }
  throw new Error('检查点仍在生成，请稍后重试');
}

export async function forkConversationFromLatest(
  input: ForkLatestInput,
  actions: ForkLatestActions,
  waitOptions?: CheckpointWaitOptions,
): Promise<void> {
  const created = await actions.createCheckpoint(input.conversationId, {
    agent_id: input.agentId,
    scope: 'conversation_shared',
  });
  const checkpoint = await waitForForkableCheckpoint(
    input.conversationId,
    created,
    actions.readCheckpoint,
    waitOptions,
  );
  await actions.createFork(input.conversationId, {
    checkpoint_id: checkpoint.id,
    agent_id: input.agentId,
  });
}

export async function forkConversationFromMessage(
  input: ForkMessageInput,
  actions: ForkLatestActions,
  waitOptions?: CheckpointWaitOptions,
): Promise<void> {
  const created = await actions.createCheckpoint(input.conversationId, {
    agent_id: input.agentId,
    scope: 'conversation_shared',
    source_to_message_id: input.messageId,
  });
  const checkpoint = await waitForForkableCheckpoint(
    input.conversationId,
    created,
    actions.readCheckpoint,
    waitOptions,
  );
  await actions.createFork(input.conversationId, {
    checkpoint_id: checkpoint.id,
    agent_id: input.agentId,
  });
}

export async function loadCompleteConversation(
  conversationId: string,
  loadPage: MessagePageLoader = getMessages,
  pageSize = TRANSCRIPT_PAGE_SIZE,
): Promise<Message[]> {
  const messagesById = new Map<string, Message>();
  let before: string | undefined;

  while (true) {
    const page = await loadPage(conversationId, before, pageSize);
    if (page.length === 0) break;
    page.forEach((message) => messagesById.set(message.id, message));

    const oldest = page.reduce((current, message) => (
      compareMessageTime(message, current) < 0 ? message : current
    ));
    if (oldest.created_at === before) break;
    before = oldest.created_at;
  }

  return Array.from(messagesById.values()).sort(
    compareMessageTime,
  );
}

function assistantName(message: Message): string | null {
  if (!message.artifacts_json) return null;
  try {
    const metadata = JSON.parse(message.artifacts_json) as { agent_name?: unknown };
    return typeof metadata.agent_name === 'string' && metadata.agent_name.trim()
      ? metadata.agent_name.trim()
      : null;
  } catch {
    return null;
  }
}

function messageAuthor(message: Message): string {
  const username = message.username?.trim();
  if (username) return username;
  if (message.role === 'assistant') return assistantName(message) ?? '助手';
  if (message.role === 'system') return '系统';
  return '用户';
}

function messageHeading(message: Message): string {
  const role = message.role === 'assistant' ? '助手' : message.role === 'system' ? '系统' : '用户';
  const author = messageAuthor(message);
  return author === role ? role : `${role} · ${author}`;
}

export function messageText(message: Message): string {
  let blocks = message.blocks ?? [];
  if (blocks.length === 0 && message.blocks_json) {
    try {
      const parsed = JSON.parse(message.blocks_json) as unknown;
      blocks = Array.isArray(parsed) ? parsed.filter(isMessageBlock) : [];
    } catch {
      blocks = [];
    }
  }
  if (blocks.length > 0) {
    return blocks
      .filter((block) => block.kind === 'text' || block.kind === 'error')
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join('\n\n');
  }
  return stripKnowledgeRefs(message.content ?? '');
}

export function isCompletedAssistantMessage(message: Message): boolean {
  return message.role === 'assistant' && (!message.status || message.status === 'complete');
}

function isMessageBlock(value: unknown): value is MessageBlock {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { index?: unknown; kind?: unknown; text?: unknown };
  return typeof candidate.index === 'number'
    && typeof candidate.kind === 'string'
    && typeof candidate.text === 'string';
}

export function hasExportableMessage(message: Message): boolean {
  return message.status !== 'streaming'
    && Boolean(messageText(message) || (message.attachments?.length ?? 0) > 0);
}

export function conversationToMarkdown(title: string, messages: readonly Message[]): string {
  const sections = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.status !== 'streaming')
    .sort((left, right) => {
      const timeDiff = compareMessageTime(left.message, right.message);
      return timeDiff || left.index - right.index;
    })
    .map(({ message }) => {
      const content = messageText(message);
      const attachments = message.attachments
        ?.map((attachment) => attachment.file_name.trim())
        .filter(Boolean) ?? [];
      const body = [content];
      if (attachments.length > 0) {
        if (content) body.push('');
        body.push('附件：', ...attachments.map((name) => `- ${name}`));
      }
      if (body.every((line) => line === '')) return null;
      return `## ${messageHeading(message)}\n\n${body.join('\n')}`;
    })
    .filter((section): section is string => Boolean(section));

  const safeTitle = title.trim() || '未命名对话';
  return [`# ${safeTitle}`, ...sections].join('\n\n');
}
