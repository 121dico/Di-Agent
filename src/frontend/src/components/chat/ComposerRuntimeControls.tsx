import React from 'react';
import { useAgentModels } from '@/hooks/useAgentModels';
import { Button, Dropdown, Tooltip } from 'antd';
import {
  CheckOutlined,
  ReloadOutlined,
  LoadingOutlined,
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
} from './agentRuntime';
import styles from './ComposerControls.module.css';

const EFFORTS: Array<{ value: AgentReasoningEffort; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'minimal', label: '极低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '更高' },
  { value: 'max', label: '最高' },
  { value: 'ultra', label: 'Ultra' },
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
  agentId?: string;
  modelOnly?: boolean;
  value: AgentRuntimeConfig;
  onChange: (value: AgentRuntimeConfig) => void;
}

export const ComposerRuntimeControls: React.FC<ComposerRuntimeControlsProps> = ({ value, onChange, agentId, modelOnly = false }) => {
  const { catalog, loading, error, scan } = useAgentModels(agentId);
  const selectedModel = catalog?.models.find(item => item.id === (value.model || catalog.default_model));
  const modelLabel = value.model
    ? (selectedModel?.label ?? CODEX_MODEL_OPTIONS.find(item => item.value === value.model)?.label ?? value.model)
    : 'Default';
  const effortLabel = EFFORTS.find(item => item.value === value.reasoning_effort)?.label ?? '中';
  const prioritySupported = selectedModel ? selectedModel.supports_priority : supportsPriorityServiceTier(value.model);
  const priorityEnabled = prioritySupported && value.service_tier === 'priority';
  const available = catalog?.models.filter(item => item.id !== '') ?? [];
  const modelItems: MenuProps['items'] = [
    { key: 'model:default', label: `Default · ${catalog?.default_model || '本地默认模型'}`,
      icon: !value.model ? <CheckOutlined /> : null,
      onClick: () => onChange({ ...value, model: '' }) },
    ...available.map(option => ({
      key: `model:${option.id}`,
      label: <span className={styles.menuOption}><span>{option.label}</span><span>{option.id}</span></span>,
      icon: value.model === option.id ? <CheckOutlined /> : null,
      onClick: () => onChange({
        ...value, model: option.id,
        reasoning_effort: option.reasoning_efforts.length && !option.reasoning_efforts.includes(value.reasoning_effort)
          ? option.default_reasoning_effort ?? option.reasoning_efforts[0]! : value.reasoning_effort,
        service_tier: option.supports_priority ? value.service_tier : 'default',
      }),
    })),
    ...(value.model && !available.some(item => item.id === value.model)
      ? [{ key: 'model:current', label: `${modelLabel} · 当前选择，待扫描确认`, disabled: true }] : []),
    { type: 'divider' },
    ...(error || catalog?.warning ? [{ key: 'scan:error', disabled: true, label: <span className={styles.modelScanStatus}>{error || catalog?.warning}</span> }] : []),
    { key: 'scan', icon: loading ? <LoadingOutlined /> : <ReloadOutlined />, disabled: loading || !agentId,
      label: loading ? '正在扫描本地模型…' : '重新扫描本地模型', onClick: () => { void scan(); } },
  ];
  const efforts = selectedModel?.reasoning_efforts.length
    ? EFFORTS.filter(item => selectedModel.reasoning_efforts.includes(item.value))
    : EFFORTS.filter(item => ['low', 'medium', 'high'].includes(item.value));
  const effortItems: MenuProps['items'] = efforts.map(option => ({
    key: `effort:${option.value}`, label: option.label,
    icon: value.reasoning_effort === option.value ? <CheckOutlined /> : null,
    onClick: () => onChange({ ...value, reasoning_effort: option.value }),
  }));

  return (
    <div
      className={styles.runtimeControls}
      aria-label={`当前运行设置：${modelLabel}，推理强度${effortLabel}，极速${priorityEnabled ? '开启' : '关闭'}`}
    >
      <Dropdown
        onOpenChange={open => { if (open) void scan(); }}
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
      {!modelOnly && <><Dropdown
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
      </Tooltip></>}
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
