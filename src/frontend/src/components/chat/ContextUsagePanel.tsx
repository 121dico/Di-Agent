import React from 'react';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Empty, Progress, Tooltip } from 'antd';
import type { ContextUsage } from '@/types/context';
import { clampUsageRatio, formatTokenCount, getUsageStatusLabel } from './contextPresentation';
import styles from './ConversationContextDrawer.module.css';

interface ContextUsagePanelProps {
  usage?: ContextUsage;
}

function meterClass(status: ContextUsage['status']): string {
  if (status === 'critical') return styles.meterCritical ?? '';
  if (status === 'warning') return styles.meterWarning ?? '';
  return styles.meterNormal ?? '';
}

export const ContextUsagePanel: React.FC<ContextUsagePanelProps> = ({ usage }) => {
  if (!usage) {
    return (
      <div className={styles.emptyUsage}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该 Agent 还没有 Context 用量记录" />
      </div>
    );
  }

  const ratio = clampUsageRatio(usage.usage_ratio);
  const percentage = Math.round(ratio * 100);

  return (
    <section className={styles.usagePanel} aria-label="Context 用量">
      <div className={styles.usageHeading}>
        <div>
          <span className={styles.usageTitle}>当前 Session</span>
          <span className={styles.generation}>第 {usage.generation} 代</span>
        </div>
        <div className={styles.usageStatusRow}>
          {usage.source === 'estimated' && (
            <Tooltip title="当前 CLI 尚未上报真实 Token，用量由系统根据已组装的上下文估算">
              <span className={styles.estimatedBadge}>
                估算 <InfoCircleOutlined />
              </span>
            </Tooltip>
          )}
          <span className={`${styles.usageStatus} ${meterClass(usage.status)}`}>
            {getUsageStatusLabel(usage.status)}
          </span>
        </div>
      </div>

      <div className={styles.usageNumbers}>
        <strong>{formatTokenCount(usage.active_context_tokens)}</strong>
        <span>/ {formatTokenCount(usage.context_window_tokens)} tokens</span>
        <b>{percentage}%</b>
      </div>
      <Progress
        className={`${styles.usageProgress} ${meterClass(usage.status)}`}
        percent={percentage}
        showInfo={false}
        status={usage.status === 'critical' ? 'exception' : 'normal'}
        aria-label={`Context 已使用 ${percentage}%`}
      />

      <div className={styles.usageFooter}>
        <span>已压缩 {usage.compaction_count} 次</span>
        <span>{usage.updated_at ? `更新于 ${new Date(usage.updated_at).toLocaleString()}` : '等待首次更新'}</span>
      </div>
      {usage.checkpoint_id && (
        <div className={styles.attachedCheckpoint}>
          已引入检查点 {usage.checkpoint_id.slice(0, 8)}…，下一条消息会自动携带
        </div>
      )}
    </section>
  );
};
