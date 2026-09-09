import React, { useEffect, useState } from 'react';
import { getConversationContextUsage } from '@/api/context';
import { useMessageStore } from '@/store/messageStore';
import { onTaskChanged, useWsStore } from '@/store/wsStore';
import type { ContextUsage } from '@/types/context';
import { clampUsageRatio, formatTokenCount } from './contextPresentation';
import styles from './ContextUsageFooter.module.css';

interface FooterViewProps {
  usages: ContextUsage[];
  loading?: boolean;
  failed?: boolean;
  onOpen: () => void;
}

export const ContextUsageFooterView: React.FC<FooterViewProps> = ({ usages, loading, failed, onOpen }) => (
  <footer className={styles.footer} aria-label="上下文用量">
    <div className={styles.readings}>
      {usages.length === 0 && (
        <div className={styles.reading}>
          <span>上下文 · {loading ? '加载中…' : failed ? '暂时无法获取' : '暂无用量记录'}</span>
          <progress className={styles.progress} value={0} max={100} aria-label="上下文用量暂无数据" />
        </div>
      )}
      {usages.map((usage) => {
        const known = usage.status !== 'unknown' && usage.context_window_tokens > 0;
        const percentage = Math.round(clampUsageRatio(usage.usage_ratio) * 100);
        return (
          <div className={styles.reading} key={usage.agent_id}>
            <span>上下文{usages.length > 1 && usage.agent_name ? ` · ${usage.agent_name}` : ''}</span>
            <span className={styles.numbers}>
              {known ? `${formatTokenCount(usage.active_context_tokens)} / ${formatTokenCount(usage.context_window_tokens)} · ${percentage}%` : usage.native_usage?.context_tokens != null ? `${formatTokenCount(usage.native_usage.context_tokens)} tokens · 容量未上报` : '暂无用量记录'}
              {known && usage.source === 'estimated' ? '（估算）' : ''}
            </span>
            <progress
              className={styles.progress}
              value={known ? percentage : 0}
              max={100}
              aria-label={known ? `上下文已使用 ${percentage}%` : '上下文用量暂无数据'}
            />
          </div>
        );
      })}
    </div>
    <button type="button" className={styles.details} onClick={onOpen}>检查点与详情</button>
  </footer>
);

export const ContextUsageFooter: React.FC<{
  conversationId: string;
  agentId?: string;
  onOpen: () => void;
}> = ({ conversationId, agentId, onOpen }) => {
  const [usages, setUsages] = useState<ContextUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const connection = useWsStore((s) => s.status);
  const messageRevision = useMessageStore((s) => {
    const messages = s.messages[conversationId];
    const last = messages?.[messages.length - 1];
    return `${last?.id ?? ''}:${last?.status ?? ''}`;
  });

  useEffect(() => {
    let disposed = false;
    let epoch = 0;
    const refresh = async () => {
      const request = ++epoch;
      try {
        const next = await getConversationContextUsage(conversationId);
        if (disposed || request !== epoch) return;
        setUsages(next);
        setFailed(false);
      } catch {
        if (disposed || request !== epoch) return;
        setUsages([]);
        setFailed(true);
      } finally {
        if (!disposed && request === epoch) setLoading(false);
      }
    };
    void refresh();
    const unsubscribe = onTaskChanged((id) => {
      if (id === conversationId) void refresh();
    });
    return () => { disposed = true; unsubscribe(); };
  }, [conversationId, messageRevision, connection]);

  return <ContextUsageFooterView
    usages={agentId ? usages.filter((usage) => usage.agent_id === agentId) : usages}
    loading={loading}
    failed={failed}
    onOpen={onOpen}
  />;
};
