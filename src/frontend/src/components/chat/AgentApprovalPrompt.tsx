import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { onWsEvent, useWsStore } from '@/store/wsStore';
import {
  isAgentApprovalRequest,
  useAgentApprovalStore,
  type AgentApprovalRequest,
} from '@/store/agentApprovalStore';
import { message } from '@/utils/message';
import styles from './AgentApprovalPrompt.module.css';

function approvalSummary(request: AgentApprovalRequest): { title: string; detail: string } {
  const details = request.details ?? {};
  const command = Array.isArray(details.command)
    ? details.command.join(' ')
    : typeof details.command === 'string'
      ? details.command
      : '';
  const reason = typeof details.reason === 'string'
    ? details.reason
    : typeof details.description === 'string'
      ? details.description
      : '';
  if (request.kind === 'command') {
    return { title: 'Agent 请求执行命令', detail: command || reason || '请确认是否允许本次操作。' };
  }
  if (request.kind === 'file_change') {
    return { title: 'Agent 请求修改文件', detail: reason || '请确认是否允许本次文件变更。' };
  }
  return { title: 'Agent 请求额外权限', detail: reason || '请确认是否授予本次权限。' };
}

export const AgentApprovalPrompt: React.FC<{
  conversationId: string;
  onResolved?: () => void;
}> = ({ conversationId, onResolved }) => {
  const wsClient = useWsStore((state) => state.wsClient);
  const pending = useAgentApprovalStore((state) => state.pending);
  const upsert = useAgentApprovalStore((state) => state.upsert);
  const remove = useAgentApprovalStore((state) => state.remove);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const conversationIdRef = useRef(conversationId);
  const onResolvedRef = useRef(onResolved);
  useEffect(() => {
    conversationIdRef.current = conversationId;
    onResolvedRef.current = onResolved;
  }, [conversationId, onResolved]);
  const requests = useMemo(() => Object.values(pending)
    .filter((request) => request.conversation_id === conversationId)
    .sort((left, right) => (left.expires_at ?? '').localeCompare(right.expires_at ?? '')),
  [conversationId, pending]);

  useEffect(() => {
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    const unsubscribeRequired = onWsEvent('agent.approval_required', (value) => {
      if (isAgentApprovalRequest(value)) upsert(value);
    });
    const unsubscribeResolved = onWsEvent('agent.approval_resolved', (value) => {
      const approvalId = value && typeof value === 'object'
        ? String((value as Record<string, unknown>).approval_id ?? '')
        : '';
      if (approvalId) {
        const resolvedConversationId = value && typeof value === 'object'
          ? String((value as Record<string, unknown>).conversation_id ?? '')
          : '';
        remove(approvalId);
        setDecidingId((current) => current === approvalId ? null : current);
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        if (resolvedConversationId === conversationIdRef.current) onResolvedRef.current?.();
      }
    });
    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      unsubscribeRequired();
      unsubscribeResolved();
    };
  }, [remove, upsert]);

  useEffect(() => {
    if (!wsClient) return;
    wsClient.send(JSON.stringify({
      type: 'agent.approval_list',
      data: { conversation_id: conversationId },
    }));
  }, [conversationId, wsClient]);

  const active = requests[0];
  const summary = useMemo(() => active ? approvalSummary(active) : null, [active]);
  useEffect(() => {
    if (!active?.expires_at) return;
    const remaining = new Date(active.expires_at).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    if (remaining <= 0) {
      remove(active.approval_id);
      return;
    }
    const timer = window.setTimeout(() => remove(active.approval_id), remaining);
    return () => window.clearTimeout(timer);
  }, [active, remove]);
  if (!active || !summary) return null;

  const decide = (decision: 'accept' | 'decline') => {
    if (!wsClient) {
      message.error('连接已断开，请稍后重试');
      return;
    }
    setDecidingId(active.approval_id);
    wsClient.send(JSON.stringify({
      type: 'agent.approval_decision',
      data: {
        approval_id: active.approval_id,
        conversation_id: active.conversation_id,
        decision,
      },
    }));
    // Keep the request visible until the authenticated server confirms it was resolved.
    // If confirmation is lost, re-enable the buttons so the user can safely retry.
    if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = window.setTimeout(() => setDecidingId(null), 5000);
  };

  return (
    <section className={styles.prompt} role="alert" aria-label="Agent 审批请求">
      <div className={styles.icon}><SafetyCertificateOutlined /></div>
      <div className={styles.body}>
        <div className={styles.title}>{summary.title}</div>
        <div className={styles.detail} title={summary.detail}>{summary.detail}</div>
      </div>
      {requests.length > 1 && <span className={styles.count}>+{requests.length - 1}</span>}
      <Button disabled={decidingId === active.approval_id} onClick={() => decide('decline')}>拒绝</Button>
      <Button
        type="primary"
        loading={decidingId === active.approval_id}
        onClick={() => decide('accept')}
      >
        允许一次
      </Button>
    </section>
  );
};
