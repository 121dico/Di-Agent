import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Minus, Square } from 'lucide-react';
import { getOrCreateAgentChat } from '@/api/conversation';
import { ensureReportAgentSession, type ReportAgentSession } from '@/api/reportAgentSession';
import { cancelStreamingMessage, getConversationBlackboard, getMessages, updateConversationBlackboard } from '@/api/message';
import { useAuthStore } from '@/store/authStore';
import { useAgentStore } from '@/store/agentStore';
import { useMessageStore } from '@/store/messageStore';
import { useWsStore } from '@/store/wsStore';
import { primeMessagesCache, useMessages } from '@/hooks/useMessages';
import { PAGE_SIZE } from '@/config/constants';
import { MessageList } from '@/components/chat/MessageList';
import { AgentApprovalPrompt } from '@/components/chat/AgentApprovalPrompt';
import { replaceReportAgentContext, type ReportAgentContext } from './reportAgentContext';
import styles from './ReportAgentChat.module.css';

export type { ReportAgentContext } from './reportAgentContext';

interface Props { context: ReportAgentContext; onClose: () => void; active?: boolean }

export function ReportAgentChat({ context, onClose, active = true }: Props) {
  const userId = useAuthStore((state) => state.user?.id);
  const token = useAuthStore((state) => state.token);
  const [session, setSession] = useState<ReportAgentSession | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const sendLock = useRef(false);
  const composing = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const replyBaseline = useRef<string[]>([]);
  const conversationId = session?.conversation.id ?? null;
  const { messages, send } = useMessages(conversationId);
  const wsStatus = useWsStore((state) => state.status);
  const agentTyping = useWsStore((state) => conversationId ? state.agentTyping[conversationId] === true : false);
  const agents = useAgentStore((state) => state.agents);
  const selectableAgents = agents.filter((item) => item.machine_id && (!item.user_id || item.user_id === userId));
  const liveAgent = useAgentStore((state) => state.agents.find((agent) => agent.id === session?.agent.id));
  const agent = liveAgent ?? session?.agent;
  const online = agent?.status === 'online' || agent?.status === 'busy';
  const streaming = messages.find((item) => item.status === 'streaming');
  const busy = sending || awaitingReply || agentTyping || !!streaming;
  const connected = wsStatus === 'connected';
  const wasConnected = useRef(connected);
  const hasNewReply = awaitingReply && messages.some((item) => item.role === 'assistant' && !replyBaseline.current.includes(item.id));

  useEffect(() => { setDraft(''); }, [userId, token]);

  useEffect(() => { if (active && conversationId) inputRef.current?.focus(); }, [active, conversationId]);

  useEffect(() => {
    let disposed = false;
    setSession(null);
    setLoading(true);
    setError('');
    setAwaitingReply(false);
    const isCurrent = () => useAuthStore.getState().user?.id === userId && useAuthStore.getState().token === token;
    if (!userId || !token) { setLoading(false); setError('请先登录后使用报表agent'); return; }
    void (async () => {
      try {
        const next = await ensureReportAgentSession(userId, token, isCurrent);
        if (disposed || !isCurrent()) return;
        // 显式读取可呈现加载失败；通用消息 hook 会吞掉首次加载异常。
        const beforeRequest = useMessageStore.getState().messages[next.conversation.id] ?? [];
        const history = await getMessages(next.conversation.id, undefined, PAGE_SIZE);
        if (disposed || !isCurrent()) return;
        primeMessagesCache(next.conversation.id, history, beforeRequest);
        setSession(next);
        void useAgentStore.getState().fetchAgents(true).catch(() => {});
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : '连接报表agent失败');
      } finally { if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; };
  }, [userId, token, attempt]);

  useEffect(() => {
    if (hasNewReply) setAwaitingReply(false);
  }, [hasNewReply]);

  // 重连时补齐漏掉的完成消息，面板关闭后真实任务继续由全局 WS 管理。
  useEffect(() => {
    if (conversationId && connected && !wasConnected.current) void useMessageStore.getState().fetchMessages(conversationId);
    wasConnected.current = connected;
  }, [conversationId, connected]);

  const handleSend = async () => {
    const originalDraft = draft;
    const question = draft.trim();
    if (!session || !question || busy || sendLock.current || !online || !connected) return;
    const snapshot: ReportAgentContext = { ...context, cities: [...context.cities] };
    const id = session.conversation.id;
    const currentAgentId = session.agent.id;
    const isCurrent = () => useAuthStore.getState().user?.id === userId && useAuthStore.getState().token === token;
    const oldOptimisticIds = (useMessageStore.getState().optimisticMessages[id] ?? []).map((item) => item.id);
    sendLock.current = true;
    setSending(true);
    setError('');
    replyBaseline.current = messages.filter((item) => item.role === 'assistant').map((item) => item.id);
    try {
      const blackboard = await getConversationBlackboard(id);
      if (!isCurrent()) return;
      await updateConversationBlackboard(id, replaceReportAgentContext(blackboard.manual_context ?? '', snapshot));
      if (!isCurrent()) return;
      setAwaitingReply(true);
      await send(question, undefined, undefined, undefined, undefined, currentAgentId);
      if (isCurrent()) setDraft((current) => current === originalDraft ? '' : current);
    } catch (failure) {
      setAwaitingReply(false);
      // 保留输入框作为重试入口，避免通用消息气泡重试绕过当前报表上下文同步。
      if (isCurrent()) {
        const store = useMessageStore.getState();
        for (const item of store.optimisticMessages[id] ?? []) {
          if (!oldOptimisticIds.includes(item.id) && item.optimisticStatus === 'failed') store.removeOptimistic(id, item.id);
        }
        setError(failure instanceof Error ? failure.message : '发送失败，请重试');
      }
    } finally { sendLock.current = false; setSending(false); }
  };

  const selectAgent = async (agentId: string) => {
    if (busy || sendLock.current || !session) return;
    const selected = selectableAgents.find((item) => item.id === agentId);
    if (!selected) return;
    sendLock.current = true; setSending(true); setError('');
    try {
      const conversation = await getOrCreateAgentChat(agentId, 'report', true);
      if (useAuthStore.getState().user?.id !== userId || useAuthStore.getState().token !== token) return;
      setSession({ agent: selected, conversation });
    } catch (failure) { setError(failure instanceof Error ? failure.message : '切换 Agent 失败'); }
    finally { sendLock.current = false; setSending(false); }
  };

  const stop = async () => {
    if (!conversationId || !streaming) return;
    try {
      await cancelStreamingMessage(conversationId, streaming.id, useMessageStore.getState().streamingTaskIds[streaming.id]);
      useMessageStore.getState().cancelStreaming(conversationId, streaming.id);
      setAwaitingReply(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '停止失败，请重试'); }
  };

  return <section className={styles.panel} aria-label="报表agent对话">
    <header className={styles.header}>
      <span className={styles.avatar}><Bot size={19} /></span>
      <div className={styles.heading}><strong>报表agent</strong></div>
      <button className={styles.iconButton} onClick={onClose} aria-label="收起报表agent" title="收起"><Minus size={18} /></button>
    </header>
    <label className={styles.agentPicker}>执行 Agent
      <select aria-label="报表执行 Agent" value={session?.agent.id ?? ''} disabled={loading || busy || !session} onChange={(event) => void selectAgent(event.target.value)}>
        {!session && <option value="">正在加载本地 Agent…</option>}
        {session && !selectableAgents.some((item) => item.id === session.agent.id) && <option value={session.agent.id}>{session.agent.name}</option>}
        {selectableAgents.map((item) => <option key={item.id} value={item.id} disabled={item.status !== 'online' && item.status !== 'busy'}>{item.name} · {item.cli_tool === 'codex' ? 'GPT / Codex' : item.cli_tool === 'claude' ? 'Claude' : item.cli_tool} · {item.machine_name || '本地'}{item.status !== 'online' && item.status !== 'busy' ? '（离线）' : ''}</option>)}
      </select>
    </label>
    <div className={styles.context} title={[context.reportName, context.dateRange, context.dataDate, context.cities.join('、') || '全部城市'].filter(Boolean).join(' · ')}>
      <span>当前报表</span><strong>{context.reportName}</strong><small>{[context.dateRange, context.dataDate && `快照 ${context.dataDate}`, context.cities.join('、') || '全部城市'].filter(Boolean).join(' · ')}</small>
    </div>
    {loading ? <div className={styles.empty} role="status">正在连接报表agent…</div> : session ? <>
      {messages.length === 0 ? <div className={styles.empty}><Bot size={30} /><strong>一起看看这份报表</strong><p>可以问我指标口径、数据变化，或当前筛选下的趋势。</p></div> : null}
      <div className={messages.length === 0 ? styles.initialMessages : styles.messages}><MessageList conversationId={session.conversation.id} /></div>
      <AgentApprovalPrompt conversationId={session.conversation.id} />
    </> : <div className={styles.empty}><Bot size={30} /><p>连接后即可查看历史并继续对话</p></div>}
    {error && <div className={styles.notice} role="alert"><span>{error}</span><button onClick={() => streaming ? void stop() : session ? void handleSend() : setAttempt((value) => value + 1)} disabled={sending || (!!session && (!online || !connected))}>{streaming ? '重试停止' : session ? '重试发送' : '重新连接'}</button></div>}
    {session && (!online || !connected) && <div className={styles.notice} role="status"><span>{!connected ? '聊天连接已断开，正在重连…' : '报表agent暂时离线，请恢复运行环境后重试。'}</span>{!online && <button onClick={() => setAttempt((value) => value + 1)}>重新连接</button>}</div>}
    {session && <div className={styles.composer}>
      <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="问问报表agent…" aria-label="向报表agent提问" rows={2} maxLength={12000}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); void handleSend(); } }} />
      <div className={styles.composerBottom}><small>{busy ? '报表agent正在处理，请稍候' : 'Enter 发送 · Shift + Enter 换行'}</small>
        {streaming ? <button className={styles.sendButton} onClick={() => void stop()} aria-label="停止报表agent回复"><Square size={14} /></button>
          : <button className={styles.sendButton} onClick={() => void handleSend()} disabled={!draft.trim() || busy || !online || !connected} aria-label="发送给报表agent"><ArrowUp size={18} /></button>}
      </div>
    </div>}
  </section>;
}
