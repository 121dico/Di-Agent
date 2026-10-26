import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Input, Button, Tooltip, Spin } from 'antd';
import { message } from '@/utils/message';
import {
  ArrowUpOutlined,
  CloseOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  LockOutlined,
  RobotOutlined,
  CrownOutlined,
  UpOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useMessages } from '@/hooks/useMessages';
import { useMessageStore } from '@/store/messageStore';
import { onConversationRoleChanged, useWsStore } from '@/store/wsStore';
import { useConversationStore } from '@/store/conversationStore';
import { useAgentStore } from '@/store/agentStore';
import { useAuthStore } from '@/store/authStore';
import { uploadFile } from '@/api/upload';
import { getGroupMembers } from '@/api/group';
import { getConversationAgents } from '@/api/conversation';
import { getGroupKnowledgeBases, getKnowledgeBases } from '@/api/knowledge';
import { truncateGraphemes } from '@/utils/truncateText';
import type { GroupMember } from '@/types/group';
import type { ConversationAgent } from '@/types/conversation';
import type { GroupKnowledgeBase } from '@/types/knowledge';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import type { AttachmentPayload } from '@/types/attachment';
import type { Message, ReplyToPreview } from '@/types/message';
import { AttachmentPreview, type PendingAttachment } from './AttachmentPreview';
import { ComposerAddMenu } from './ComposerAddMenu';
import { ContextUsageFooter } from './ContextUsageFooter';
import {
  ComposerApprovalControl,
  ComposerRuntimeControls,
  ComposerRuntimeFallback,
} from './ComposerRuntimeControls';
import { AgentApprovalPrompt } from './AgentApprovalPrompt';
import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  readRuntimePreference,
  resolveRuntimePreference,
  writeRuntimePreference,
  type AgentRuntimeConfig,
} from './agentRuntime';
import { appendKnowledgeRefs } from '@/components/knowledge/knowledgeReferenceState';
import styles from './ChatInput.module.css';

const { TextArea } = Input;

const ACCEPTED_TYPES =
  '.jpg,.jpeg,.png,.gif,.webp,.pdf,.pptx,.ppt,.docx,.doc,.xlsx,.xls,.txt,.md,.csv';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
// 与后端附件图片传输的限制保持一致。
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 4;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
function imageInputError(files: File[]): string | null {
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (images.some((file) => !IMAGE_TYPES.has(file.type))) return 'Agent 图片仅支持 PNG、JPEG、GIF 或 WebP，请转换格式后重试。';
  if (images.length > MAX_IMAGES) return '每条消息最多 4 张图片，请移除部分图片后重试。';
  if (images.reduce((bytes, file) => bytes + file.size, 0) > MAX_IMAGE_BYTES) return '每条消息图片总大小不能超过 4MiB，请压缩图片后重试。';
  return null;
}
const REPLY_PREVIEW_LIMIT = 50;
const EMPTY_MESSAGES: Message[] = [];
class RecipientRoutingError extends Error {}

type MentionTarget =
  | { id: string; label: string; mentionLabel: string; kind: 'user'; user: GroupMember }
  | { id: string; label: string; mentionLabel: string; kind: 'agent'; agent: ConversationAgent };

function toMentionLabel(label: string): string {
  return label.replace(/\s+/g, '');
}

function truncatePreview(text: string, maxLength = REPLY_PREVIEW_LIMIT): string {
  return truncateGraphemes(text, maxLength);
}

interface KBTarget {
  username: string;
  kbName: string;
  kbId: string;
  visibility: string;
}

interface ChatInputProps {
  conversationId: string;
  replyTo?: Message | null;
  onCancelReply?: () => void;
  onOpenContext?: () => void;
  /**
   * 把内部 processFiles 暴露给父级（ChatWindow），让整个聊天窗口的拖放都能复用同一套
   * 校验 + 上传逻辑。传 null 表示注销（卸载时）。
   */
  onRegisterProcessFiles?: (handler: ((files: FileList | File[]) => void) | null) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  conversationId,
  replyTo,
  onCancelReply,
  onOpenContext,
  onRegisterProcessFiles,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const attachmentSequenceRef = useRef(0);
  const attachmentEpochRef = useRef(0);
  const attachmentInputsRef = useRef<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const pendingImageError = imageInputError(pendingFiles.map((item) => item.file));
  const { send } = useMessages(conversationId);
  const isStreaming = useMessageStore(
    (s) => (s.messages[conversationId] ?? EMPTY_MESSAGES).some((msg) => msg.status === 'streaming'),
  );
  const wsClient = useWsStore((s) => s.wsClient);
  const agentTyping = useWsStore((s) => conversationId ? (s.agentTyping[conversationId] ?? false) : false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mentionVisible, setMentionVisible] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [recipientOpen, setRecipientOpen] = useState(false);
  const recipientRevisionRef = useRef(0);
  const mentionRequestEpochRef = useRef(0);
  const latestAgentMembersRef = useRef<ConversationAgent[]>([]);
  const [mentionLoadError, setMentionLoadError] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [agentMembers, setAgentMembers] = useState<ConversationAgent[]>([]);
  const [mentionTargetsLoaded, setMentionTargetsLoaded] = useState(false);
  const [mentionStart, setMentionStart] = useState(-1); // cursor position where @ was typed
  const textareaRef = useRef<TextAreaRef>(null);

  // KB reference state
  const [kbVisible, setKbVisible] = useState(false);
  const [kbQuery, setKbQuery] = useState('');
  const [kbIndex, setKbIndex] = useState(0);
  const [kbStart, setKbStart] = useState(-1);
  const [knowledgeBases, setKnowledgeBases] = useState<GroupKnowledgeBase[]>([]);
  const [kbLoaded, setKbLoaded] = useState(false);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbLoadError, setKbLoadError] = useState<string | null>(null);
  const [selectedKnowledgeBases, setSelectedKnowledgeBases] = useState<KBTarget[]>([]);
  const activeConversationIdRef = useRef(conversationId);
  const knowledgeRequestEpochRef = useRef(0);

  const conversation = useConversationStore((s) =>
    s.conversations.find((c) => c.id === conversationId),
  );
  const boundAgentId = useConversationStore((s) => s.directAgentChats[conversationId]);
  const bindDirectAgentChat = useConversationStore((s) => s.bindDirectAgentChat);
  const unbindDirectAgentChat = useConversationStore((s) => s.unbindDirectAgentChat);
  const directAgentId = conversation?.type === 'agent' ? conversation.peer_id : boundAgentId;
  const isGroup = conversation?.type === 'group';
  const globalAgents = useAgentStore((s) => s.agents);
  const currentUsername = useAuthStore((s) => s.user?.username ?? '');
  const runtimeAgent = useMemo(() => {
    if (!directAgentId) return undefined;
    return globalAgents.find((agent) => agent.id === directAgentId)
      ?? agentMembers.find((agent) => agent.agent_id === directAgentId);
  }, [agentMembers, directAgentId, globalAgents]);
  const supportsModelSelection = conversation?.type === 'agent' && ['codex', 'claude'].includes(runtimeAgent?.cli_tool ?? '');
  const supportsCodexControls = conversation?.type === 'agent' && runtimeAgent?.cli_tool === 'codex';
  const runtimePreferenceIdentity = directAgentId ? `${conversationId}:${directAgentId}` : '';
  const [runtimePreferenceState, setRuntimePreferenceState] = useState<{
    identity: string;
    value: AgentRuntimeConfig;
  }>(() => ({
    identity: runtimePreferenceIdentity,
    value: directAgentId
      ? readRuntimePreference(conversationId, directAgentId)
      : { ...DEFAULT_AGENT_RUNTIME_CONFIG },
  }));
  // Derive the selected conversation's policy synchronously. Using an effect
  // leaves one render where an immediate Enter can submit the previous
  // conversation's full-access setting to the new Agent.
  const runtimeConfig = resolveRuntimePreference(
    runtimePreferenceState,
    conversationId,
    directAgentId,
  ).value;

  const handleRuntimeChange = useCallback((next: AgentRuntimeConfig) => {
    setRuntimePreferenceState({ identity: runtimePreferenceIdentity, value: next });
    if (directAgentId) writeRuntimePreference(conversationId, directAgentId, next);
  }, [conversationId, directAgentId, runtimePreferenceIdentity]);

  const fetchMentionTargets = useCallback(async () => {
    if (!isGroup) return { members, agentMembers, current: true };
    const requestEpoch = ++mentionRequestEpochRef.current;
    const [nextMembers, nextAgents] = await Promise.all([
      getGroupMembers(conversationId),
      getConversationAgents(conversationId),
    ]);
    const safeMembers = nextMembers ?? [];
    const safeAgents = nextAgents ?? [];
    const current = activeConversationIdRef.current === conversationId && mentionRequestEpochRef.current === requestEpoch;
    if (current) {
      setMembers(safeMembers);
      setAgentMembers(safeAgents);
      latestAgentMembersRef.current = safeAgents;
      setMentionTargetsLoaded(true);
      setMentionLoadError(false);
      const selected = useConversationStore.getState().directAgentChats[conversationId];
      if (selected && !safeAgents.some(agent => agent.agent_id === selected)) {
        recipientRevisionRef.current += 1;
        unbindDirectAgentChat(conversationId);
      }
    }
    return { members: safeMembers, agentMembers: safeAgents, current };
  }, [agentMembers, conversationId, isGroup, members, unbindDirectAgentChat]);

  const loadMentionTargets = useCallback(() => {
    if (!isGroup || mentionTargetsLoaded) return;
    fetchMentionTargets().catch((err) => console.error('Failed to load mention targets:', err));
  }, [fetchMentionTargets, isGroup, mentionTargetsLoaded]);

  const fetchKnowledgeBases = useCallback(async () => {
    const requestConversationId = conversationId;
    const requestEpoch = ++knowledgeRequestEpochRef.current;
    setKbLoading(true);
    setKbLoadError(null);
    try {
      const kbs = isGroup
        ? await getGroupKnowledgeBases(conversationId)
        : (await getKnowledgeBases()).map((kb) => ({
            id: kb.id,
            name: kb.name,
            description: kb.description,
            visibility: kb.visibility,
            username: currentUsername,
            file_count: kb.file_count,
            created_at: kb.created_at,
            updated_at: kb.updated_at,
          }));
      if (
        activeConversationIdRef.current !== requestConversationId ||
        knowledgeRequestEpochRef.current !== requestEpoch
      ) return;
      setKnowledgeBases(kbs ?? []);
      setKbLoaded(true);
      setKbLoading(false);
    } catch (err) {
      if (
        activeConversationIdRef.current !== requestConversationId ||
        knowledgeRequestEpochRef.current !== requestEpoch
      ) return;
      console.error('Failed to load knowledge bases:', err);
      setKbLoading(false);
      setKbLoadError('知识库加载失败');
      message.error('知识库加载失败，请重试');
    }
  }, [conversationId, currentUsername, isGroup]);

  const loadKnowledgeBases = useCallback(() => {
    if (kbLoaded || kbLoading) return;
    void fetchKnowledgeBases();
  }, [fetchKnowledgeBases, kbLoaded, kbLoading]);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
    attachmentEpochRef.current += 1;
    attachmentInputsRef.current = [];
    setPendingFiles([]);
    setAttachmentError(null);
    knowledgeRequestEpochRef.current += 1;
    mentionRequestEpochRef.current += 1;
    recipientRevisionRef.current += 1;
    setRecipientOpen(false);
    setMentionVisible(false);
    setMentionLoadError(false);
    setValue('');
    setMembers([]);
    setAgentMembers([]);
    latestAgentMembersRef.current = [];
    setMentionTargetsLoaded(false);
    setKnowledgeBases([]);
    setKbLoaded(false);
    setKbLoading(false);
    setKbLoadError(null);
    setKbVisible(false);
    setSelectedKnowledgeBases([]);
    setSendError(null);
    return () => {
      attachmentEpochRef.current += 1;
      mentionRequestEpochRef.current += 1;
      recipientRevisionRef.current += 1;
    };
  }, [conversationId]);

  // 群成员是路由和角色的权威来源，进入会话和角色变化时刷新。
  useEffect(() => {
    if (!isGroup) return;
    const refresh = () => { void fetchMentionTargets().catch(() => {
      if (activeConversationIdRef.current === conversationId) setMentionLoadError(true);
    }); };
    refresh();
    return onConversationRoleChanged(payload => {
      if (payload.conversationId === conversationId) refresh();
    });
    // 只随会话身份重订阅，成员结果不能反向触发重新请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isGroup]);

  // Resolve the display name for the currently targeted agent
  const targetAgentName = useMemo(() => {
    if (!directAgentId) return null;
    // Group chat: check loaded group agents first, then fall back to global list
    const fromGroup = agentMembers.find((a) => a.agent_id === directAgentId)?.name;
    if (fromGroup) return fromGroup;
    const fromGlobal = globalAgents.find((a) => a.id === directAgentId)?.name;
    if (fromGlobal) return fromGlobal;
    // Direct agent chat: peer_name is always available
    if (!isGroup) return conversation?.peer_name ?? null;
    return null;
  }, [directAgentId, agentMembers, globalAgents, isGroup, conversation]);

  // Typing broadcast state
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const lastTypingSentRef = useRef(0);

  const sendTypingStart = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 300) return;
    lastTypingSentRef.current = now;
    wsClient?.send(JSON.stringify({
      type: 'user.typing_start',
      data: { conversation_id: conversationId },
    }));
    isTypingRef.current = true;
  }, [wsClient, conversationId]);

  const sendTypingStop = useCallback(() => {
    if (!isTypingRef.current) return;
    wsClient?.send(JSON.stringify({
      type: 'user.typing_stop',
      data: { conversation_id: conversationId },
    }));
    isTypingRef.current = false;
  }, [wsClient, conversationId]);

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      sendTypingStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setValue(val);
    if (sendError) setSendError(null);
    sendTypingStart();
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      sendTypingStop();
    }, 2000);

    const el = e.target as HTMLTextAreaElement;
    const cursorPos = el.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);

    if (isGroup) {
      // @ takes priority
      const atMatch = textBeforeCursor.match(/@(\S*)$/);
      if (atMatch) {
        const query = atMatch[1] ?? '';
        setMentionQuery(query);
        setMentionStart(cursorPos - query.length - 1); // position of @
        setMentionIndex(0);
        if (!mentionVisible) {
          setKbVisible(false);
          setMentionVisible(true);
          loadMentionTargets();
        }
        return;
      }
    }

    // 单聊和群聊都支持 # 快捷选择知识库。
    const hashMatch = textBeforeCursor.match(/#(\S*)$/);
    if (hashMatch) {
      const query = hashMatch[1] ?? '';
      setKbQuery(query);
      setKbStart(cursorPos - query.length - 1);
      setKbIndex(0);
      if (!kbVisible) {
        setMentionVisible(false);
        setKbVisible(true);
        loadKnowledgeBases();
      }
      return;
    }

    if (mentionVisible) setMentionVisible(false);
    if (kbVisible) setKbVisible(false);
  }, [sendTypingStart, sendTypingStop, isGroup, mentionVisible, kbVisible, loadMentionTargets, loadKnowledgeBases, sendError]);

  // 文件入库通用逻辑：校验大小 → 入 pendingFiles → 逐个上传。
  // 文件选择、拖拽和粘贴共用同一套校验和上传。
  const processFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const inputError = imageInputError([...attachmentInputsRef.current.map((item) => item.file), ...list]);
    if (inputError) {
      setAttachmentError(inputError);
      return;
    }
    setAttachmentError(null);

    const newItems: PendingAttachment[] = [];
    list.forEach((f) => {
      if (f.size > MAX_FILE_SIZE) {
        message.error(`${f.name} 超过 50MB 限制`);
        return;
      }
      newItems.push({ uid: `attachment_${++attachmentSequenceRef.current}`, file: f, status: 'uploading' });
    });
    if (newItems.length === 0) return;
    attachmentInputsRef.current = [...attachmentInputsRef.current, ...newItems];
    setPendingFiles((prev) => [...prev, ...newItems]);
    const epoch = attachmentEpochRef.current;

    // Upload each file
    newItems.forEach(async (item) => {
      try {
        const payload = await uploadFile(item.file);
        if (epoch !== attachmentEpochRef.current) return;
        setPendingFiles((prev) =>
          prev.map((p) => (p.uid === item.uid ? { ...p, status: 'done', payload } : p)),
        );
      } catch {
        if (epoch !== attachmentEpochRef.current) return;
        setPendingFiles((prev) =>
          prev.map((p) => (p.uid === item.uid ? { ...p, status: 'error', error: '上传失败' } : p)),
        );
      }
    });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    processFiles(files);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFiles]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // 粘贴事件在内网 HTTP 页面同样可用，不依赖安全上下文的 Clipboard API。
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      for (const item of Array.from(event.clipboardData.items)) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return; // 普通文本粘贴保留浏览器默认行为。
    event.preventDefault();
    processFiles(files);
  }, [processFiles]);

  // 把 processFiles 注册给父级（ChatWindow），让整个聊天窗口的拖放复用同一上传逻辑。
  useEffect(() => {
    onRegisterProcessFiles?.(processFiles);
    return () => onRegisterProcessFiles?.(null);
  }, [onRegisterProcessFiles, processFiles]);

  const handleRemoveFile = useCallback((uid: string) => {
    attachmentInputsRef.current = attachmentInputsRef.current.filter((p) => p.uid !== uid);
    setPendingFiles((prev) => prev.filter((p) => p.uid !== uid));
  }, []);

  const mentionTargets: MentionTarget[] = [
    ...members
      .filter((m) => !!m.username)
      .map((m) => {
        const label = m.username ?? 'unknown';
        return { id: m.user_id, label, mentionLabel: toMentionLabel(label), kind: 'user' as const, user: m };
      }),
    ...agentMembers.map((agent) => ({
      id: agent.agent_id,
      label: agent.name,
      mentionLabel: toMentionLabel(agent.name),
      kind: 'agent' as const,
      agent,
    })),
  ];

  const filteredTargets = mentionTargets.filter(
    (target) => (
      target.label.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      target.mentionLabel.toLowerCase().includes(mentionQuery.toLowerCase())
    ),
  );

  const insertMention = useCallback((target: MentionTarget) => {
    const before = value.slice(0, mentionStart);
    const after = value.slice(mentionStart + mentionQuery.length + 1); // +1 for @
    // 直接插入 @提及 + 尾随空格：不再自动追加 "#"（曾用于联动知识库选择，
    // 但对绝大多数场景是多余字符，知识库可经输入框的 KB 入口手动选择）。
    const newValue = `${before}@${target.mentionLabel} ${after}`;
    setValue(newValue);
    setMentionVisible(false);

    // Focus back on textarea
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [value, mentionStart, mentionQuery]);

  const hasMention = useCallback((content: string, label: string) => {
    // 与后端 ParseMentions / normalizeMentionName 完全一致，避免追加第二个目标。
    return Array.from(content.matchAll(/@([\p{L}\p{N}_\-.]+)/gu))
      .some(match => match[1]?.toLowerCase() === label.toLowerCase());
  }, []);

  // KB targets with dedup
  const kbTargets = useMemo(() => {
    const seen = new Set<string>();
    return knowledgeBases.filter((kb) => {
      const key = `${kb.username}/${kb.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [knowledgeBases]);

  const filteredKBTargets = useMemo(() => {
    return kbTargets.filter((kb) =>
      kb.name.toLowerCase().includes(kbQuery.toLowerCase()) ||
      kb.username.toLowerCase().includes(kbQuery.toLowerCase())
    );
  }, [kbTargets, kbQuery]);

  const handleRemoveKnowledgeRef = useCallback((key: string) => {
    setSelectedKnowledgeBases((current) => current.filter(
      (kb) => `${kb.username}/${kb.kbName}` !== key,
    ));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const insertKB = useCallback((target: KBTarget | null) => {
    const nextValue = kbStart >= 0
      ? `${value.slice(0, kbStart)}${value.slice(kbStart + kbQuery.length + 1)}`
      : value;
    setValue(nextValue);
    if (target === null) {
      setSelectedKnowledgeBases([]);
    } else {
      setSelectedKnowledgeBases((current) => {
        const key = `${target.username}/${target.kbName}`;
        return current.some((kb) => `${kb.username}/${kb.kbName}` === key)
          ? current
          : [...current, target];
      });
    }
    setKbVisible(false);
    setKbStart(-1);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [value, kbStart, kbQuery]);

  const handleKnowledgeButtonClick = useCallback(() => {
    setMentionVisible(false);
    setKbQuery('');
    setKbIndex(0);
    setKbStart(-1);
    setKbVisible((visible) => !visible);
    loadKnowledgeBases();
  }, [loadKnowledgeBases]);

  const handleSubmit = useCallback(async () => {
    if (sendingRef.current || pendingImageError || pendingFiles.some((file) => file.status !== 'done' || !file.payload)) return;
    const submitConversationId = conversationId;
    const submitRecipientRevision = recipientRevisionRef.current;
    const trimmed = value.trim();
    const knowledgeBasesForSend = selectedKnowledgeBases;
    const pendingFilesForSend = pendingFiles;
    let persistedContent = appendKnowledgeRefs(trimmed, knowledgeBasesForSend);
    const attachments: AttachmentPayload[] = pendingFiles
      .filter((p) => p.status === 'done' && p.payload)
      .map((p) => p.payload!);

    if (!persistedContent && !attachments.length) return;

    // 同步占位，避免 React 下一次渲染前双击造成重复发送。
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    sendTypingStop();

    // 立即清空输入框，给用户即时反馈
    setValue('');
    attachmentInputsRef.current = [];
    setPendingFiles([]);
    setSelectedKnowledgeBases([]);
    onCancelReply?.();

    try {
      let mentions: string[] | undefined;
      let mentionedAgentId: string | undefined;
      let clearRecipient = false;
      if (isGroup) {
        const targetLists = (trimmed.includes('@') || boundAgentId)
          ? await fetchMentionTargets()
          : { members, agentMembers, current: true };
        if (!targetLists.current) throw new RecipientRoutingError('群成员已更新，请重新发送。草稿已保留。');
        const userMentions = targetLists.members
          .filter((member) => member.username && hasMention(trimmed, toMentionLabel(member.username)))
          .map((member) => member.user_id);
        mentions = userMentions.length > 0 ? userMentions : undefined;
        const mentionedAgents = targetLists.agentMembers.filter((agent) => hasMention(trimmed, toMentionLabel(agent.name)));
        mentionedAgentId = mentionedAgents.length === 1 ? mentionedAgents[0]?.agent_id : undefined;
        clearRecipient = mentionedAgents.length > 1;
        const selected = targetLists.agentMembers.find((agent) => agent.agent_id === boundAgentId);
        const hasExplicitMention = mentionedAgents.length > 0 || userMentions.length > 0 || /(^|[^\p{L}\p{N}_@])@\S+/u.test(trimmed);
        if (boundAgentId && !selected && !hasExplicitMention) {
          throw new RecipientRoutingError('对话对象已不在群中，请重新选择。草稿已保留。');
        }
        // 群聊仍走服务端 @ 路由，不能用直聊 agent_id 绕过 Orcha 和引导队列。
        if (selected && !hasExplicitMention) {
          const label = toMentionLabel(selected.name);
          if (!/^[\p{L}\p{N}_\-.]+$/u.test(label)) {
            throw new RecipientRoutingError('Agent 名称包含暂不支持的字符，请先修改名称。草稿已保留。');
          }
          if (targetLists.agentMembers.filter(agent => toMentionLabel(agent.name).toLowerCase() === label.toLowerCase()).length !== 1) {
            throw new RecipientRoutingError('群内存在同名 Agent，请先区分名称。草稿已保留。');
          }
          persistedContent = `@${label} ${persistedContent}`;
        }
      }
      const replyPreview: ReplyToPreview | undefined = replyTo
        ? {
            id: replyTo.id,
            content: replyTo.content ?? '',
            sender_id: replyTo.sender_id,
            username: replyTo.username,
            deleted_at: null,
          }
        : undefined;
      // Group chats: don't pass agentId — routing handled by backend mention parsing.
      // Agent/single chats: pass the resolved agentId for direct dispatch.
      const targetAgentId = isGroup ? undefined : (mentionedAgentId ?? directAgentId);
      const selectedAgentId = mentionedAgentId ?? directAgentId;
      const selectedAgent = selectedAgentId
        ? (globalAgents.find((agent) => agent.id === selectedAgentId)
          ?? agentMembers.find((agent) => agent.agent_id === selectedAgentId))
        : undefined;
      await send(
        persistedContent,
        attachments.length ? attachments : undefined,
        replyTo?.id,
        replyPreview,
        mentions,
        targetAgentId,
        !isGroup && selectedAgent?.cli_tool === 'codex' ? runtimeConfig
          : !isGroup && selectedAgent?.cli_tool === 'claude' ? { ...DEFAULT_AGENT_RUNTIME_CONFIG, model: runtimeConfig.model } : undefined,
      );
      // Persist the @mentioned agent as sticky target for subsequent messages
      if (isGroup && activeConversationIdRef.current === submitConversationId && recipientRevisionRef.current === submitRecipientRevision) {
        if (mentionedAgentId && latestAgentMembersRef.current.some(agent => agent.agent_id === mentionedAgentId)) bindDirectAgentChat(conversationId, mentionedAgentId);
        else if (clearRecipient) unbindDirectAgentChat(conversationId);
      }
    } catch (error) {
      // 发送失败时恢复输入内容，方便用户重试
      if (activeConversationIdRef.current === submitConversationId) {
        // 请求等待期间仍可编辑下一条草稿；恢复失败内容时合并，不能覆盖新输入。
        setValue((draft) => [trimmed, draft].filter(Boolean).join('\n\n'));
        setSelectedKnowledgeBases((draft) => [...knowledgeBasesForSend, ...draft.filter(
          (kb) => !knowledgeBasesForSend.some((previous) => previous.kbId === kb.kbId),
        )]);
        attachmentInputsRef.current = [...pendingFilesForSend, ...attachmentInputsRef.current];
        setPendingFiles((draft) => [...pendingFilesForSend, ...draft]);
        setSendError(error instanceof RecipientRoutingError ? error.message : '发送失败，草稿和附件已保留。');
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [value, selectedKnowledgeBases, pendingFiles, pendingImageError, send, sendTypingStop, replyTo, onCancelReply, isGroup, fetchMentionTargets, members, agentMembers, hasMention, directAgentId, boundAgentId, bindDirectAgentChat, unbindDirectAgentChat, conversationId, globalAgents, runtimeConfig]);

  const lastSendAtRef = useRef(0);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME 组合态守卫：中文输入法选词/上屏的 Enter（isComposing 或 keyCode 229）
      // 只作用于输入法，绝不能触发发送——否则"输入 html 按回车确认"会直接把
      // 消息发出去，且组合中的残片还可能被第二次 Enter 单独发出。
      const native = e.nativeEvent;
      const composing = (native as KeyboardEvent & { isComposing?: boolean }).isComposing
        || native.keyCode === 229;
      if (composing) {
        return;
      }
      // KB dropdown navigation (takes priority when visible)
      if (kbVisible) {
        const total = filteredKBTargets.length + 1; // +1 for "不使用知识库"
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setKbIndex((i) => (i + 1) % total);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setKbIndex((i) => (i - 1 + total) % total);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (kbIndex === 0) {
            insertKB(null);
          } else {
            const target = filteredKBTargets[kbIndex - 1];
            if (target) insertKB({ username: target.username, kbName: target.name, kbId: target.id, visibility: target.visibility });
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setKbVisible(false);
          return;
        }
      }

      // Mention dropdown navigation
      if (mentionVisible && filteredTargets.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % filteredTargets.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + filteredTargets.length) % filteredTargets.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertMention(filteredTargets[mentionIndex]!);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionVisible(false);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // 防连发：上一次发送后极短时间内的 Enter（双击习惯）不再重复发送。
        const now = Date.now();
        if (now - lastSendAtRef.current < 120) {
          return;
        }
        lastSendAtRef.current = now;
        handleSubmit();
      }
    },
    [handleSubmit, mentionVisible, kbVisible, filteredTargets, filteredKBTargets, mentionIndex, kbIndex, insertMention, insertKB],
  );

  const canSend = Boolean(
    value.trim() || selectedKnowledgeBases.length > 0 || pendingFiles.some((p) => p.status === 'done'),
  ) && !pendingImageError && !pendingFiles.some((file) => file.status !== 'done' || !file.payload) && !sending;

  // 点击下拉列表外部关闭 mention 和 KB 下拉
  useEffect(() => {
    if (!mentionVisible && !kbVisible) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.mentionDropdown}`)) {
        setMentionVisible(false);
        setKbVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mentionVisible, kbVisible]);

  return (
    <div className={styles.container} data-chat-composer>
      {(isStreaming || agentTyping) && (
        <div className={styles.typingIndicator}>
          <Spin size="small" />
          <span>{targetAgentName ?? (conversation?.peer_name ?? 'Agent')} 正在思考...</span>
        </div>
      )}
      {replyTo && (
        <div className={styles.replyBar}>
          <div className={styles.replyBarContent}>
            <div className={styles.replyBarLabel}>
              回复 {replyTo.username || (replyTo.role === 'user' ? '用户' : '助手')}
            </div>
            <div className={styles.replyBarText}>{truncatePreview(replyTo.content)}</div>
          </div>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onCancelReply}
          />
        </div>
      )}
      <AgentApprovalPrompt
        conversationId={conversationId}
        onResolved={() => textareaRef.current?.focus()}
      />
      {selectedKnowledgeBases.length > 0 && (
        <div className={styles.kbReferenceBar}>
          <DatabaseOutlined className={styles.kbReferenceBarIcon} />
          <span className={styles.kbReferenceBarLabel}>已引用知识库</span>
          <div className={styles.kbReferencePills}>
            {selectedKnowledgeBases.map((kb) => {
              const key = `${kb.username}/${kb.kbName}`;
              return (
              <button
                key={key}
                type="button"
                className={styles.kbReferencePill}
                title={`移除 ${key}`}
                onClick={() => handleRemoveKnowledgeRef(key)}
              >
                <span className={styles.kbReferenceName}>{kb.kbName}</span>
                <CloseOutlined className={styles.kbReferenceRemove} />
              </button>
              );
            })}
          </div>
        </div>
      )}
      <AttachmentPreview items={pendingFiles} onRemove={handleRemoveFile} />
      {(pendingImageError || attachmentError) && (
        <div className={styles.sendError} role="alert">
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>{pendingImageError || attachmentError}</span>
          <button type="button" className={styles.sendErrorDismiss} onClick={() => setAttachmentError(null)} aria-label="关闭附件错误提示">
            <CloseOutlined />
          </button>
        </div>
      )}
      {sendError && (
        <div id="composer-send-error" className={styles.sendError} role="alert">
          <ExclamationCircleOutlined aria-hidden="true" />
          <span>{sendError}</span>
          <button type="button" onClick={() => void handleSubmit()}>重试</button>
          <button type="button" className={styles.sendErrorDismiss} onClick={() => setSendError(null)} aria-label="关闭发送错误提示">
            <CloseOutlined />
          </button>
        </div>
      )}
      {isGroup && (
        <div className={styles.recipientArea} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRecipientOpen(false);
        }}>
          <div className={styles.targetBar}>
            <Button type="text" size="small" aria-label="选择对话 Agent" aria-expanded={recipientOpen}
              aria-haspopup="listbox" title={targetAgentName ?? '选择对话 Agent'} icon={<RobotOutlined />} onClick={() => {
                setRecipientOpen(open => !open);
                void fetchMentionTargets().catch(() => {
                  if (activeConversationIdRef.current === conversationId) setMentionLoadError(true);
                });
              }}>
              <span className={styles.targetBarName}>{boundAgentId && targetAgentName ? `正在和 ${targetAgentName} 对话` : '选择对话 Agent'}</span>
              {agentMembers.find(agent => agent.agent_id === boundAgentId)?.role === 'orchestrator' && <span className={styles.orchaBadge}><CrownOutlined /> Orcha</span>}
              <DownOutlined />
            </Button>
            {boundAgentId && <Button type="text" size="small" aria-label="取消对话对象" icon={<CloseOutlined />}
              onClick={() => { recipientRevisionRef.current += 1; unbindDirectAgentChat(conversationId); setRecipientOpen(false); }} />}
          </div>
          {recipientOpen && <div className={styles.recipientMenu} role="listbox" aria-label="对话 Agent" onKeyDown={event => {
            if (event.key === 'Escape') {
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[aria-label="选择对话 Agent"]')?.focus();
              setRecipientOpen(false);
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
            }
          }}>
            {agentMembers.map(agent => <button type="button" role="option" data-agent-id={agent.agent_id}
              aria-selected={agent.agent_id === boundAgentId} className={styles.mentionItem} key={agent.agent_id}
              onClick={() => { recipientRevisionRef.current += 1; bindDirectAgentChat(conversationId, agent.agent_id); setRecipientOpen(false); textareaRef.current?.focus(); }}>
              <RobotOutlined /> <span className={styles.recipientName} title={agent.name}>{agent.name}</span>
              {agent.role === 'orchestrator' && <span className={styles.orchaBadge}><CrownOutlined /> Orcha</span>}
            </button>)}
            {!agentMembers.length && <span className={styles.recipientEmpty}>{mentionLoadError ? '成员加载失败，请重试' : mentionTargetsLoaded ? '暂无 Agent' : '加载中…'}</span>}
          </div>}
        </div>
      )}
      <div className={styles.inputRow}>
        <TextArea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="发送至当前对话"
          autoSize={{ minRows: expanded ? 8 : 1, maxRows: expanded ? 20 : 4 }}
          className={styles.textarea}
          aria-invalid={Boolean(sendError)}
          aria-describedby={sendError ? 'composer-send-error' : undefined}
        />
        <div className={styles.composerFooter}>
          <div className={styles.footerLeft} aria-label="添加内容与授权">
            <ComposerAddMenu
              onAddAttachment={() => fileInputRef.current?.click()}
              onAddKnowledge={handleKnowledgeButtonClick}
              knowledgeCount={selectedKnowledgeBases.length}
              onReturnFocus={() => textareaRef.current?.focus()}
            />
            {supportsCodexControls && (
              <ComposerApprovalControl value={runtimeConfig} onChange={handleRuntimeChange} />
            )}
          </div>
          <div className={styles.footerRight} aria-label="运行与发送">
            <div className={styles.footerSecondaryActions}>
              <Tooltip title={expanded ? '收起输入框' : '展开输入框'}>
                <Button
                  type="text"
                  icon={expanded ? <DownOutlined /> : <UpOutlined />}
                  className={styles.expandBtn}
                  aria-label={expanded ? '收起输入框' : '展开输入框'}
                  onClick={() => setExpanded(!expanded)}
                />
              </Tooltip>
            </div>
            {conversation?.type === 'agent' && (supportsModelSelection
              ? <ComposerRuntimeControls key={directAgentId} agentId={directAgentId} modelOnly={!supportsCodexControls} value={runtimeConfig} onChange={handleRuntimeChange} />
              : <ComposerRuntimeFallback />)}
            <Button
              type="primary"
              shape="circle"
              icon={<ArrowUpOutlined />}
              aria-label="发送消息"
              onClick={handleSubmit}
              loading={sending}
              disabled={!canSend}
              className={styles.sendBtn}
            />
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          onChange={handleFileSelect}
          className={styles.fileInput}
        />
      </div>
      {onOpenContext && (
        <ContextUsageFooter key={conversationId} conversationId={conversationId} agentId={directAgentId} onOpen={onOpenContext} />
      )}
      {mentionVisible && filteredTargets.length > 0 && (
        <div className={styles.mentionDropdown}>
          {filteredTargets.map((target, i) => (
            <button
              key={`${target.kind}-${target.id}`}
              className={`${styles.mentionItem} ${i === mentionIndex ? styles.mentionItemActive : ''}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(target);
              }}
            >
              @{target.mentionLabel}
              {target.kind === 'agent' && (target.agent.role === 'orchestrator'
                ? <span className={styles.orchaBadge}><CrownOutlined /> Orcha</span> : ' · Agent')}
            </button>
          ))}
        </div>
      )}
      {kbVisible && (
        <div className={`${styles.mentionDropdown} ${styles.kbDropdown}`}>
          <button
            className={`${styles.mentionItem} ${styles.kbClearItem} ${0 === kbIndex ? styles.mentionItemActive : ''}`}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              insertKB(null);
            }}
          >
            清空知识库附件
          </button>
          {filteredKBTargets.length > 0 ? (
            filteredKBTargets.map((kb, i) => {
              const idx = i + 1;
              return (
                <button
                  key={`${kb.username}/${kb.name}`}
                  className={`${styles.mentionItem} ${styles.kbMentionItem} ${idx === kbIndex ? styles.mentionItemActive : ''}`}
                  type="button"
                  aria-pressed={selectedKnowledgeBases.some((selected) => selected.kbId === kb.id)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertKB({ username: kb.username, kbName: kb.name, kbId: kb.id, visibility: kb.visibility });
                  }}
                >
                  <DatabaseOutlined className={styles.kbMentionIcon} />
                  <span className={styles.kbMentionMain}>
                    <span className={styles.kbMentionName}>{kb.name}</span>
                    <span className={styles.kbMentionMeta}>{kb.file_count} 个文件</span>
                  </span>
                  <span className={styles.kbMentionVisibility}>
                    {kb.visibility === 'public' ? <GlobalOutlined /> : <LockOutlined />}
                    {kb.visibility === 'public' ? '公开' : '私有'}
                  </span>
                </button>
              );
            })
          ) : kbLoadError ? (
            <button
              type="button"
              className={`${styles.kbEmptyItem} ${styles.kbRetryItem}`}
              onMouseDown={(event) => {
                event.preventDefault();
                void fetchKnowledgeBases();
              }}
            >
              {kbLoadError}，点击重试
            </button>
          ) : (
            <div className={styles.kbEmptyItem}>
              {kbLoaded ? '没有可用的知识库' : kbLoading ? '加载知识库中...' : '准备加载知识库...'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
