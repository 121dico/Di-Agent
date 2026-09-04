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
  const modelLabel = CODEX_MODEL_OPTIONS.find((item) => item.value === value.model)?.label ?? '默认模型';
  const effortLabel = EFFORTS.find((item) => item.value === value.reasoning_effort)?.label ?? '中';
  const approval = APPROVALS.find((item) => item.value === value.approval_mode) ?? APPROVALS[1]!;

  const modelItems: MenuProps['items'] = [
    ...CODEX_MODEL_OPTIONS.map((option) => ({
      key: `model:${option.value || 'default'}`,
      label: option.label,
      icon: value.model === option.value ? <CheckOutlined /> : null,
      onClick: () => onChange({ ...value, model: option.value as AgentRuntimeModel }),
    })),
    { type: 'divider' as const },
    ...EFFORTS.map((option) => ({
      key: `effort:${option.value}`,
      label: `推理强度 · ${option.label}`,
      icon: value.reasoning_effort === option.value ? <CheckOutlined /> : null,
      onClick: () => onChange({ ...value, reasoning_effort: option.value }),
    })),
  ];
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
    <div className={styles.runtimeControls}>
      <Dropdown menu={{ items: modelItems }} trigger={['click']} placement="topLeft">
        <Button type="text" className={styles.pillButton} aria-label="选择模型和推理强度">
          <ThunderboltOutlined />
          <span>{modelLabel}</span>
          <span className={styles.effort}>{effortLabel}</span>
          <DownOutlined className={styles.chevron} />
        </Button>
      </Dropdown>
      <Dropdown menu={{ items: approvalItems }} trigger={['click']} placement="topLeft">
        <Button
          type="text"
          className={`${styles.pillButton} ${value.approval_mode === 'full' ? styles.dangerButton : ''}`}
          aria-label="选择审批模式"
        >
          <SafetyCertificateOutlined />
          <span>{approval.label}</span>
          <DownOutlined className={styles.chevron} />
        </Button>
      </Dropdown>
    </div>
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
