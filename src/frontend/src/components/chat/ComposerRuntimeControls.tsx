import React from 'react';
import { Button, Dropdown, Tooltip } from 'antd';
import {
  CheckOutlined,
  DownOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import {
  CODEX_MODEL_OPTIONS,
  supportsPriorityServiceTier,
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
  const prioritySupported = supportsPriorityServiceTier(value.model);
  const priorityEnabled = prioritySupported && value.service_tier === 'priority';

  const modelItems: MenuProps['items'] = CODEX_MODEL_OPTIONS.map((option) => ({
    key: `model:${option.value || 'default'}`,
    label: (
      <span className={styles.menuOption}>
        <span>{option.label}</span>
        {'description' in option && <span>{option.description}</span>}
      </span>
    ),
    icon: value.model === option.value ? <CheckOutlined /> : null,
    onClick: () => {
      const model = option.value as AgentRuntimeModel;
      onChange({
        ...value,
        model,
        service_tier: supportsPriorityServiceTier(model) ? value.service_tier : 'default',
      });
    },
  }));
  const effortItems: MenuProps['items'] = EFFORTS.map((option) => ({
    key: `effort:${option.value}`,
    label: option.label,
    icon: value.reasoning_effort === option.value ? <CheckOutlined /> : null,
    onClick: () => onChange({ ...value, reasoning_effort: option.value }),
  }));

  return (
    <div
      className={styles.runtimeControls}
      aria-label={`当前运行设置：${modelLabel}，推理强度${effortLabel}，极速${priorityEnabled ? '开启' : '关闭'}`}
    >
      <Dropdown
        menu={{
          className: styles.checkMenu,
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
          className: styles.checkMenu,
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
      <Tooltip title={prioritySupported ? '极速模式' : '当前模型不支持极速模式'}>
        <span className={styles.fastToggleWrap}>
          <Button
            type="text"
            className={`${styles.runtimeSegment} ${styles.fastSegment} ${priorityEnabled ? styles.fastSegmentActive : ''}`}
            aria-label={prioritySupported
              ? `极速模式，当前${priorityEnabled ? '开启' : '关闭'}`
              : '极速模式不可用：当前模型不支持'}
            aria-pressed={priorityEnabled}
            disabled={!prioritySupported}
            onClick={() => onChange({
              ...value,
              service_tier: priorityEnabled ? 'default' : 'priority',
            })}
          >
            <ThunderboltOutlined />
            <span className={styles.fastLabel}>极速</span>
          </Button>
        </span>
      </Tooltip>
    </div>
  );
};

export const ComposerApprovalControl: React.FC<ComposerRuntimeControlsProps> = ({ value, onChange }) => {
  const approval = APPROVALS.find((item) => item.value === value.approval_mode) ?? APPROVALS[1]!;
  const approvalItems: MenuProps['items'] = APPROVALS.map((option) => ({
    key: option.value,
    className: option.value === 'full' ? styles.dangerMenuItem : undefined,
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
        className: styles.checkMenu,
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
