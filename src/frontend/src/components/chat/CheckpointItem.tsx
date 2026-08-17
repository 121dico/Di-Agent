import React from 'react';
import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { Button, Tag, Tooltip } from 'antd';
import type { ConversationCheckpoint } from '@/types/context';
import {
  canContinueCheckpoint,
  checkpointTagColor,
  CHECKPOINT_SCOPE_LABEL,
  CHECKPOINT_STATUS_LABEL,
  shortCheckpointId,
} from './checkpointPresentation';
import { formatTokenCount } from './contextPresentation';
import styles from './CheckpointItem.module.css';

interface CheckpointItemProps {
  checkpoint: ConversationCheckpoint;
  busy: boolean;
  onPreview: (checkpoint: ConversationCheckpoint) => void;
  onExport: (checkpoint: ConversationCheckpoint) => void;
  onContinue: (checkpoint: ConversationCheckpoint) => void;
  onDelete: (checkpoint: ConversationCheckpoint) => void;
}

export const CheckpointItem: React.FC<CheckpointItemProps> = ({
  checkpoint,
  busy,
  onPreview,
  onExport,
  onContinue,
  onDelete,
}) => (
  <article className={styles.checkpointItem}>
    <div className={styles.checkpointHeader}>
      <div className={styles.checkpointTitle}>
        <strong>检查点 #{checkpoint.version ?? checkpoint.generation}</strong>
        <Tag color={checkpointTagColor(checkpoint.status)}>
          {CHECKPOINT_STATUS_LABEL[checkpoint.status]}
        </Tag>
      </div>
      <span>{new Date(checkpoint.created_at).toLocaleString()}</span>
    </div>
    <div className={styles.checkpointMeta}>
      <span>
        范围 {shortCheckpointId(checkpoint.source_from_message_id)} →{' '}
        {shortCheckpointId(checkpoint.source_to_message_id)}
      </span>
      <span>{CHECKPOINT_SCOPE_LABEL[checkpoint.scope]}</span>
      {checkpoint.tokens_before != null && (
        <span>
          {formatTokenCount(checkpoint.tokens_before)} →{' '}
          {formatTokenCount(checkpoint.tokens_after ?? 0)} tokens
        </span>
      )}
    </div>
    {checkpoint.error_message && (
      <p className={styles.checkpointError}>{checkpoint.error_message}</p>
    )}
    <div className={styles.checkpointActions}>
      <Tooltip title="预览">
        <Button
          type="text"
          icon={<EyeOutlined />}
          aria-label="预览检查点"
          onClick={() => onPreview(checkpoint)}
          loading={busy}
        />
      </Tooltip>
      <Tooltip title="在新 Session 中继续">
        <Button
          type="text"
          icon={<SwapOutlined />}
          aria-label="创建新 Session"
          className={styles.continueButton}
          disabled={!canContinueCheckpoint(checkpoint.status)}
          onClick={() => onContinue(checkpoint)}
        >
          创建新 Session
        </Button>
      </Tooltip>
      <Tooltip title="导出 Markdown">
        <Button
          type="text"
          icon={<DownloadOutlined />}
          aria-label="导出检查点 Markdown"
          onClick={() => onExport(checkpoint)}
        />
      </Tooltip>
      <Tooltip title="删除">
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          aria-label="删除检查点"
          onClick={() => onDelete(checkpoint)}
        />
      </Tooltip>
    </div>
  </article>
);
