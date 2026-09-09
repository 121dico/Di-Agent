import React from 'react';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Empty, Progress, Tooltip } from 'antd';
import type { ContextUsage } from '@/types/context';
import { clampUsageRatio, formatTokenCount, getUsageStatusLabel } from './contextPresentation';
import { TokenUsageSummary } from './TokenUsageSummary';
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

  const known = usage.status !== 'unknown' && usage.context_window_tokens > 0;
  const ratio = clampUsageRatio(usage.usage_ratio);
  const percentage = Math.round(ratio * 100);

  return (
    <section className={styles.usagePanel} aria-label="Context 用量">
      <div className={styles.usageHeading}>
        <div>
          <span className={styles.usageTitle}>实际模型上下文</span>
          <span className={styles.generation}>第 {usage.generation} 代</span>
        </div>
        <div className={styles.usageStatusRow}>
          {usage.source === 'estimated' && (
            <Tooltip title="尚未接收到原生上下文统计，字符估算仅代表平台提交的内容">
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
        <strong>{usage.native_usage?.context_tokens != null || known ? formatTokenCount(usage.active_context_tokens) : '未上报'}</strong>
        <span>/ {usage.context_window_tokens > 0 ? `${formatTokenCount(usage.context_window_tokens)} tokens` : '容量未上报'}</span>
        {known && <b>{percentage}%</b>}
      </div>
      {known && <Progress
        className={`${styles.usageProgress} ${meterClass(usage.status)}`}
        percent={percentage}
        showInfo={false}
        status={usage.status === 'critical' ? 'exception' : 'normal'}
        aria-label={`Context 已使用 ${percentage}%`}
      />}

      <p>包含系统指令、Skill 和工具内容。上下文取最近一次模型请求的输入（含缓存），不等于会话累计消耗。</p>
      {!usage.native_usage && usage.estimated_submitted_tokens != null && <p>最近平台提交内容估算：{formatTokenCount(usage.estimated_submitted_tokens)} tokens，未包含完整本地上下文。</p>}
      {usage.my_messages && <p>聊天内容：我的输入 {(usage.my_messages.input_tokens ?? usage.my_messages.estimated_tokens).toLocaleString()} / 公开回复 {(usage.my_messages.output_tokens ?? 0).toLocaleString()} tokens（{usage.my_messages.source === 'tokenizer' ? '官方词表文本分词' : '估算'}）。不含附件正文、工具和推理；历史文字不会因压缩清零。按当前确认模型 {usage.my_messages.model || '未知'} 统计；输入 {usage.my_messages.input_characters ?? '未知'} / 回复 {usage.my_messages.output_characters ?? '未知'} 个 Unicode 字符。{usage.my_messages.tokenizer && `词表：${usage.my_messages.tokenizer}。文本分词量不等于接口计费量。`}</p>}
      <TokenUsageSummary title="会话累计已记录用量" usage={usage.native_totals} />
      <p>已记录 {usage.measured_turns ?? 0} 次派发；不含接入前未记录的用量，子代理和后台调用可能未包含。</p>
      <div className={styles.usageFooter}>
        <span>检查点换代 {usage.compaction_count} 次</span>
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
