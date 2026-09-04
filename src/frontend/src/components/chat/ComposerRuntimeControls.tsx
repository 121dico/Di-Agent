import React from 'react';
import { Button, Dropdown } from 'antd';
import {
  CheckOutlined,
  DownOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import {
  CODEX_MODEL_OPTIONS,
  type AgentApprovalMode,
  type AgentReasoningEffort,
  type AgentRuntimeConfig,
  type AgentRuntimeModel,
} from './agentRuntime';
import styles from './ComposerControls.module.css';

const EFFORTS: Array<{ value: AgentReasoningEffort; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const APPROVALS: Array<{
  value: AgentApprovalMode;
  label: string;
  description: string;
}> = [
  { value: 'request', label: '请求批准', description: '执行风险操作前始终询问' },
  { value: 'auto', label: '帮我批准', description: '安全操作自动继续，风险操作再询问' },
  { value: 'full', label: '完全访问', description: '可访问互联网和电脑上的文件' },
];

interface ComposerRuntimeControlsProps {
  value: AgentRuntimeConfig;
  onChange: (value: AgentRuntimeConfig) => void;
}

export const ComposerRuntimeControls: React.FC<ComposerRuntimeControlsProps> = ({ value, onChange }) => {
  const modelLabel = CODEX_MODEL_OPTIONS.find((item) => item.value === value.model)?.label ?? 'Default';
  const effortLabel = EFFORTS.find((item) => item.value === value.reasoning_effort)?.label ?? '中';

  const modelItems: MenuProps['items'] = CODEX_MODEL_OPTIONS.map((option) => ({
    key: `model:${option.value || 'default'}`,
    label: (
      <span className={styles.menuOption}>
        <span>{option.label}</span>
        {'description' in option && <span>{option.description}</span>}
      </span>
    ),
    icon: value.model === option.value ? <CheckOutlined /> : null,
    onClick: () => onChange({ ...value, model: option.value as AgentRuntimeModel }),
  }));
  const effortItems: MenuProps['items'] = EFFORTS.map((option) => ({
    key: `effort:${option.value}`,
    label: option.label,
    icon: value.reasoning_effort === option.value ? <CheckOutlined /> : null,
    onClick: () => onChange({ ...value, reasoning_effort: option.value }),
  }));

  return (
    <div className={styles.runtimeControls} aria-label={`当前运行设置：${modelLabel}，推理强度${effortLabel}`}>
      <Dropdown
        menu={{
          items: modelItems,
          selectable: true,
          selectedKeys: [`model:${value.model || 'default'}`],
        }}
        trigger={['click']}
        placement="topRight"
      >
        <Button
          type="text"
          className={`${styles.runtimeSegment} ${styles.modelSegment}`}
          aria-label={`选择模型，当前 ${modelLabel}`}
        >
          <ThunderboltOutlined />
          <span className={styles.modelLabel}>{modelLabel}</span>
        </Button>
      </Dropdown>
      <Dropdown
        menu={{
          items: effortItems,
          selectable: true,
          selectedKeys: [`effort:${value.reasoning_effort}`],
        }}
        trigger={['click']}
        placement="topRight"
      >
        <Button
          type="text"
          className={`${styles.runtimeSegment} ${styles.effortSegment}`}
          aria-label={`选择推理强度，当前 ${effortLabel}`}
        >
          <span>{effortLabel}</span>
          <DownOutlined className={styles.chevron} />
        </Button>
      </Dropdown>
    </div>
  );
};

export const ComposerApprovalControl: React.FC<ComposerRuntimeControlsProps> = ({ value, onChange }) => {
  const approval = APPROVALS.find((item) => item.value === value.approval_mode) ?? APPROVALS[1]!;
  const approvalItems: MenuProps['items'] = APPROVALS.map((option) => ({
    key: option.value,
    icon: value.approval_mode === option.value ? <CheckOutlined /> : null,
    label: (
      <span className={styles.menuOption}>
        <span className={option.value === 'full' ? styles.dangerText : undefined}>{option.label}</span>
        <span>{option.description}</span>
      </span>
    ),
    onClick: () => onChange({ ...value, approval_mode: option.value }),
  }));

  return (
    <Dropdown
      menu={{
        items: approvalItems,
        selectable: true,
        selectedKeys: [value.approval_mode],
      }}
      trigger={['click']}
      placement="topLeft"
    >
      <Button
        type="text"
        className={`${styles.approvalButton} ${value.approval_mode === 'full' ? styles.dangerButton : ''}`}
        aria-label={`选择审批模式，当前 ${approval.label}`}
      >
        <SafetyCertificateOutlined />
        <span className={styles.approvalLabel}>{approval.label}</span>
        <DownOutlined className={styles.chevron} />
      </Button>
    </Dropdown>
  );
};

export const ComposerRuntimeFallback: React.FC = () => (
  <div className={styles.runtimeControls} aria-label="运行设置跟随当前智能体">
    <Button type="text" className={styles.pillButton} disabled>
      <ThunderboltOutlined />
      <span>跟随运行时</span>
    </Button>
  </div>
);
