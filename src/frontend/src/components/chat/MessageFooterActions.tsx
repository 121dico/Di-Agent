import React from 'react';
import { Button, Tooltip } from 'antd';
import { BranchesOutlined, CopyOutlined } from '@ant-design/icons';
import styles from './MessageFooterActions.module.css';

interface MessageFooterActionsProps {
  onCopy: () => void;
  onFork: () => void;
  forkDisabled?: boolean;
  forking?: boolean;
}

export const MessageFooterActions: React.FC<MessageFooterActionsProps> = ({
  onCopy,
  onFork,
  forkDisabled = false,
  forking = false,
}) => (
  <div className={styles.actions} aria-label="Agent 回复操作">
    <Tooltip title="复制回复">
      <Button
        type="text"
        size="small"
        icon={<CopyOutlined />}
        aria-label="复制此回复"
        onClick={onCopy}
      />
    </Tooltip>
    <Tooltip title={forkDisabled ? '回复完成后才可 Fork' : '从此回复 Fork 新对话'}>
      <Button
        type="text"
        size="small"
        icon={<BranchesOutlined />}
        aria-label="从此回复 Fork"
        disabled={forkDisabled || forking}
        loading={forking}
        onClick={onFork}
      />
    </Tooltip>
  </div>
);
