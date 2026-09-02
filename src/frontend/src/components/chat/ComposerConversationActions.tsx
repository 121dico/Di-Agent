import React from 'react';
import { Button, Tooltip } from 'antd';
import { BranchesOutlined, CopyOutlined } from '@ant-design/icons';
import styles from './ChatInput.module.css';

export interface ComposerConversationActionsProps {
  onCopy: () => void;
  onFork: () => void;
  copying: boolean;
  forking: boolean;
  forkDisabled: boolean;
  forkDisabledReason?: string;
}

export const ComposerConversationActions: React.FC<ComposerConversationActionsProps> = ({
  onCopy,
  onFork,
  copying,
  forking,
  forkDisabled,
  forkDisabledReason,
}) => (
  <>
    <Tooltip title={copying ? '正在复制对话' : '复制对话'}>
      <Button
        type="text"
        icon={<CopyOutlined />}
        className={styles.conversationActionBtn}
        aria-label="复制对话"
        loading={copying}
        disabled={copying || forking}
        onClick={onCopy}
      />
    </Tooltip>
    <Tooltip title={forkDisabled ? (forkDisabledReason ?? '当前对话暂时不能 Fork') : forking ? '正在创建 Fork' : 'Fork 对话'}>
      <Button
        type="text"
        icon={<BranchesOutlined />}
        className={styles.conversationActionBtn}
        aria-label="Fork 对话"
        loading={forking}
        disabled={forkDisabled || copying || forking}
        onClick={onFork}
      />
    </Tooltip>
  </>
);
