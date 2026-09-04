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
  const grantRoot = typeof details.grantRoot === 'string'
    ? details.grantRoot
    : typeof details.grant_root === 'string'
      ? details.grant_root
      : '';
  const cwd = typeof details.cwd === 'string' ? details.cwd : '';
  const permissions = details.permissions && typeof details.permissions === 'object'
    ? JSON.stringify(details.permissions)
    : '';
  if (request.kind === 'command') {
    return { title: 'Agent 请求执行命令', detail: [command, cwd && `目录：${cwd}`, reason].filter(Boolean).join(' · ') || '未提供命令详情，请谨慎确认。' };
  }
  if (request.kind === 'file_change') {
    return { title: 'Agent 请求修改文件', detail: [grantRoot && `范围：${grantRoot}`, cwd && `目录：${cwd}`, reason].filter(Boolean).join(' · ') || '未提供文件范围，请谨慎确认。' };
  }
  return { title: 'Agent 请求额外权限', detail: [permissions && `权限：${permissions}`, cwd && `目录：${cwd}`, reason].filter(Boolean).join(' · ') || '未提供权限范围，请谨慎确认。' };
}

export const AgentApprovalPrompt: React.FC<{
  conversationId: string;
  onResolved?: () => void;
}> = ({ conversationId, onResolved }) => {
  const wsClient = useWsStore((state) => state.wsClient);
  const wsStatus = useWsStore((state) => state.status);
  const pending = useAgentApprovalStore((state) => state.pending);
  const upsert = useAgentApprovalStore((state) => state.upsert);
  const remove = useAgentApprovalStore((state) => state.remove);
  const replaceConversation = useAgentApprovalStore((state) => state.replaceConversation);
  const reconcileConversation = useAgentApprovalStore((state) => state.reconcileConversation);
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
      if (!value || typeof value !== 'object') return;
      const event = value as Record<string, unknown>;
      if (typeof event.conversation_id === 'string' && Array.isArray(event.approvals) && typeof event.revision === 'number') {
        reconcileConversation(event.conversation_id, event.approvals.filter(isAgentApprovalRequest), event.revision);
      } else if (isAgentApprovalRequest(value)) {
        upsert(value);
      }
    });
    const unsubscribeResolved = onWsEvent('agent.approval_resolved', (value) => {
      const approvalId = value && typeof value === 'object'
        ? String((value as Record<string, unknown>).approval_id ?? '')
        : '';
      if (approvalId) {
        const resolvedConversationId = value && typeof value === 'object'
          ? String((value as Record<string, unknown>).conversation_id ?? '')
          : '';
        const event = value as Record<string, unknown>;
        let applied = true;
        if (Array.isArray(event.approvals) && typeof event.revision === 'number') {
          applied = reconcileConversation(resolvedConversationId, event.approvals.filter(isAgentApprovalRequest), event.revision);
        } else {
          remove(approvalId);
        }
        setDecidingId((current) => current === approvalId ? null : current);
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        if (applied && resolvedConversationId === conversationIdRef.current) onResolvedRef.current?.();
      }
    });
    const unsubscribeSnapshot = onWsEvent('agent.approval_snapshot', (value) => {
      if (!value || typeof value !== 'object') return;
      const snapshot = value as { conversation_id?: unknown; approvals?: unknown; revision?: unknown };
      if (typeof snapshot.conversation_id !== 'string' || !Array.isArray(snapshot.approvals)) return;
      if (typeof snapshot.revision === 'number') {
        reconcileConversation(snapshot.conversation_id, snapshot.approvals.filter(isAgentApprovalRequest), snapshot.revision);
      } else {
        replaceConversation(snapshot.conversation_id, snapshot.approvals.filter(isAgentApprovalRequest));
      }
    });
    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
      unsubscribeRequired();
      unsubscribeResolved();
      unsubscribeSnapshot();
    };
  }, [reconcileConversation, remove, replaceConversation, upsert]);

  useEffect(() => {
    if (!wsClient || wsStatus !== 'connected') return;
    wsClient.send(JSON.stringify({
      type: 'agent.approval_list',
      data: { conversation_id: conversationId },
    }));
  }, [conversationId, wsClient, wsStatus]);

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
        {active.details && Object.keys(active.details).length > 0 && (
          <details className={styles.rawDetails}>
            <summary>查看授权详情</summary>
            <pre>{JSON.stringify(active.details, null, 2)}</pre>
          </details>
        )}
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
