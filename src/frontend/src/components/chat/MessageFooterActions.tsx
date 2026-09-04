import React from 'react';
import { Button, Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  BranchesOutlined,
  CopyOutlined,
  MessageOutlined,
  MoreOutlined,
  PushpinOutlined,
} from '@ant-design/icons';
import styles from './MessageFooterActions.module.css';

interface MessageFooterActionsProps {
  onCopy: () => void;
  onFork: () => void;
  forkDisabled?: boolean;
  forking?: boolean;
  onReply?: () => void;
  onTogglePin?: () => void;
  pinned?: boolean;
  menuItems?: MenuProps['items'];
}

export const MessageFooterActions: React.FC<MessageFooterActionsProps> = ({
  onCopy,
  onFork,
  forkDisabled = false,
  forking = false,
  onReply,
  onTogglePin,
  pinned = false,
  menuItems = [],
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
    {onReply && (
      <Tooltip title="回复">
        <Button type="text" size="small" icon={<MessageOutlined />} aria-label="回复此消息" onClick={onReply} />
      </Tooltip>
    )}
    {onTogglePin && (
      <Tooltip title={pinned ? '取消 Pin' : 'Pin 到上下文黑板'}>
        <Button
          type="text"
          size="small"
          icon={<PushpinOutlined />}
          aria-label={pinned ? '取消 Pin' : 'Pin 到上下文黑板'}
          aria-pressed={pinned}
          onClick={onTogglePin}
        />
      </Tooltip>
    )}
    <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
      <Tooltip title="更多操作">
        <Button type="text" size="small" icon={<MoreOutlined />} aria-label="更多消息操作" />
      </Tooltip>
    </Dropdown>
  </div>
);
