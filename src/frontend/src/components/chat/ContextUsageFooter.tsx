import React, { useEffect, useState } from 'react';
import { getConversationContextUsage } from '@/api/context';
import { useMessageStore } from '@/store/messageStore';
import { onTaskChanged, useWsStore } from '@/store/wsStore';
import type { ContextUsage } from '@/types/context';
import { formatTokenCount } from './contextPresentation';
import styles from './ContextUsageFooter.module.css';

interface FooterViewProps {
  usages: ContextUsage[];
  loading?: boolean;
  failed?: boolean;
  onOpen: () => void;
}

export const ContextUsageFooterView: React.FC<FooterViewProps> = ({ usages, loading, failed, onOpen }) => {
  const readings = usages.length ? usages : [undefined];
  return (
    <footer className={styles.footer} aria-label="聊天内容用量">
      <div className={styles.readings}>
        {readings.map((usage) => { const mine = usage?.my_messages; return <div key={usage?.agent_id ?? 'empty'} className={styles.reading} title="当前对话中你的输入与该 Agent 的公开回复；不含附件正文、系统指令、工具和推理内容。按每条完整消息分词后相加，真实请求用量请查看详情。">
          <span>聊天内容{usages.length > 1 ? ` · ${usage?.agent_name || usage?.agent_id}` : ''}</span>
          <span className={styles.numbers}>{mine
            ? `${formatTokenCount((mine.input_tokens ?? mine.estimated_tokens) + (mine.output_tokens ?? 0))} tokens（${mine.source === 'tokenizer' ? '文本分词' : '估算'}） · 我的 ${formatTokenCount(mine.input_tokens ?? mine.estimated_tokens)} / 回复 ${formatTokenCount(mine.output_tokens ?? 0)}`
            : loading ? '加载中…' : failed ? '暂时无法获取' : '暂无用量记录'}</span>
        </div>; })}
      </div>
      <button type="button" className={styles.details} onClick={onOpen}>检查点与详情</button>
    </footer>
  );
};

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
    return messages?.map((m) => `${m.id}:${m.status}:${m.status === 'streaming' ? '' : m.content}`).join('|') ?? '';
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
