import React from 'react';
import { Button, Dropdown } from 'antd';
import { DatabaseOutlined, PaperClipOutlined, PlusOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import styles from './ComposerControls.module.css';

interface ComposerAddMenuProps {
  onAddAttachment: () => void;
  onAddKnowledge: () => void;
  knowledgeCount?: number;
  onReturnFocus?: () => void;
}

export const ComposerAddMenu: React.FC<ComposerAddMenuProps> = ({
  onAddAttachment,
  onAddKnowledge,
  knowledgeCount = 0,
  onReturnFocus,
}) => {
  const items: MenuProps['items'] = [
    {
      key: 'attachment',
      icon: <PaperClipOutlined />,
      label: '添加附件',
      onClick: onAddAttachment,
    },
    {
      key: 'knowledge',
      icon: <DatabaseOutlined />,
      label: knowledgeCount > 0 ? `知识库（已选 ${knowledgeCount}）` : '添加知识库',
      onClick: onAddKnowledge,
    },
  ];
  return (
    <Dropdown
      menu={{ items }}
      trigger={['click']}
      placement="topLeft"
      onOpenChange={(open) => { if (!open) window.setTimeout(() => onReturnFocus?.(), 0); }}
    >
      <Button
        type="text"
        icon={<PlusOutlined />}
        className={styles.squareButton}
        aria-label="添加内容"
      />
    </Dropdown>
  );
};
