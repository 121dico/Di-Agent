import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Popconfirm, Tag, Tooltip } from 'antd';
import { message } from '@/utils/message';
import { copyText } from '@/utils/clipboard';
import {
  AppleOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DesktopOutlined,
  PlusOutlined,
  ReloadOutlined,
  WindowsOutlined,
} from '@ant-design/icons';
import { parseCapabilities } from './agentPresentation';
import type {
  Agent,
  AddCandidateAgentRequest,
  AgentCandidate,
  CreateDaemonMachineResponse,
  DaemonMachine,
} from '@/types/agent';
import { AgentCreateModal } from './AgentCreateModal';
import { DAEMON_VERSION } from '@/utils/connectCommand';
import { downloadMachineLauncher, getMachineConnectCommand } from '@/api/agent';
import styles from './ConnectComputerModal.module.css';

interface ConnectComputerModalProps {
  open: boolean;
  machines: DaemonMachine[];
  candidates: AgentCandidate[];
  loading: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<CreateDaemonMachineResponse>;
  onAddCandidate: (id: string, body: AddCandidateAgentRequest) => Promise<Agent>;
  onDeleteMachine: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

function defaultComputerName(): string {
  const timestamp = new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `computer-${timestamp.replace(':', '')}`;
}

function getStatusTag(machine: DaemonMachine): React.ReactNode {
  if (machine.status === 'connected') {
    return <Tag color="success">Connected</Tag>;
  }
  return <Tag color="warning">Waiting</Tag>;
}

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface CommandRowProps {
  tag: string;
  tagColor?: string;
  hint: string;
  command: string;
  label: string;
}

// 命令展示行：点复制按钮写入剪贴板（HTTPS 安全上下文下原生 clipboard API 可用）。
const CommandRow: React.FC<CommandRowProps> = ({ tag, tagColor, hint, command, label }) => {
  const handleCopy = async () => {
    try {
      await copyText(command);
      message.success(`${label} 命令已复制`);
    } catch {
      message.error('复制失败，请手动选中文本复制');
    }
  };

  return (
    <div className={styles.commandRow}>
      <div className={styles.commandLabel}>
        <Tag color={tagColor}>{tag}</Tag>
        <span className={styles.commandHint}>{hint}</span>
      </div>
      <pre className={styles.command}>{command}</pre>
      <Button icon={<CopyOutlined />} onClick={handleCopy} />
    </div>
  );
};

export const ConnectComputerModal: React.FC<ConnectComputerModalProps> = ({
  open,
  machines,
  candidates,
  loading,
  onClose,
  onCreate,
  onAddCandidate,
  onDeleteMachine,
  onRefresh,
}) => {
  const [name, setName] = useState(defaultComputerName());
  const [creating, setCreating] = useState(false);
  const [addingID, setAddingID] = useState<string | null>(null);
  const [deletingMachineID, setDeletingMachineID] = useState<string | null>(null);
  const [createCandidate, setCreateCandidate] = useState<AgentCandidate | null>(null);
  const [created, setCreated] = useState<CreateDaemonMachineResponse | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [launcherBusy, setLauncherBusy] = useState<string | null>(null);
  const safeMachines = machines ?? [];
  const safeCandidates = candidates ?? [];
  const hasConnectedMachine = safeMachines.some((machine) => machine.status === 'connected');
  const machinePanelTitle = hasConnectedMachine
    ? 'Connected computers'
    : 'Waiting for computer to connect...';

  const refreshQuietly = async () => {
    try {
      await onRefresh();
      setRefreshError(null);
    } catch (err) {
      setRefreshError(getErrorMessage(err, '刷新电脑连接失败'));
    }
  };

  const handleRefresh = async () => {
    try {
      await onRefresh();
      setRefreshError(null);
    } catch (err) {
      const errorMessage = getErrorMessage(err, '刷新电脑连接失败');
      setRefreshError(errorMessage);
      message.error(errorMessage);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    void refreshQuietly();
    const timer = window.setInterval(() => {
      void refreshQuietly();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [open]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const result = await onCreate(name.trim());
      setCreated(result);
      await handleRefresh();
      message.success('连接命令已生成');
    } catch (err) {
      message.error(getErrorMessage(err, '创建连接失败'));
    } finally {
      setCreating(false);
    }
  };

  const handleDownloadLauncher = async (machineId: string, os: 'mac' | 'win') => {
    const busyKey = `${machineId}:${os}`;
    setLauncherBusy(busyKey);
    try {
      await downloadMachineLauncher(machineId, os);
      message.success('启动器已下载，双击运行即可完成接入');
    } catch (err) {
      message.error(getErrorMessage(err, '下载启动器失败'));
    } finally {
      setLauncherBusy(null);
    }
  };

  // Mac 一键安装：复制 curl|bash 安装命令到剪贴板（绕开 Gatekeeper 对下载脚本的拦截）。
  // 已有 installCommand 时直接用（创建连接后的面板）；否则先调 connect 接口获取。
  // 无论复制成败，都会把下方 Install 命令框高亮选中作为 ⌘C 兜底。
  const handleMacInstall = async (machineId: string, installCommand?: string) => {
    const busyKey = `${machineId}:mac`;
    setLauncherBusy(busyKey);
    try {
      let command = installCommand;
      if (!command) {
        const connect = await getMachineConnectCommand(machineId);
        command = connect.install_command;
      }
      await copyText(command);
      message.success('安装命令已复制：打开「终端」粘贴并回车即可', 5);
    } catch (err) {
      message.error(getErrorMessage(err, '复制安装命令失败'));
    } finally {
      setLauncherBusy(null);
    }
  };

  const launcherRow = (machineId: string, installCommand?: string) => (
    <div className={styles.commandRow}>
      <div className={styles.commandLabel}>
        <Tag color="green">一键安装</Tag>
        <span className={styles.commandHint}>推荐 · 自动完成安装并注册开机自启</span>
      </div>
      <div className={styles.launcherButtons}>
        <Button
          icon={<AppleOutlined />}
          loading={launcherBusy === `${machineId}:mac`}
          type="primary"
          onClick={() => handleMacInstall(machineId, installCommand)}
        >
          Mac · 复制安装命令
        </Button>
        <Button
          icon={<WindowsOutlined />}
          loading={launcherBusy === `${machineId}:win`}
          type="primary"
          onClick={() => handleDownloadLauncher(machineId, 'win')}
        >
          Windows · 下载安装器
        </Button>
      </div>
      <div className={styles.launcherNote}>
        Mac：点按钮复制安装命令 → 打开「终端」(Terminal) → 粘贴 (⌘V) → 回车，之后全自动；
        Windows：双击下载的 Di-Agent-Setup.bat 运行，若弹出蓝色 SmartScreen 提示：点「更多信息」→「仍要运行」。
        安装是幂等的，重复运行只会更新密钥并重启服务。
      </div>    </div>
  );

  const handleCreateAgent = async (candidateId: string, displayName: string, systemPrompt: string, toolsConfig: string, customSkills: string) => {
    const candidate = safeCandidates.find((item) => item.id === candidateId);
    if (!candidate) {
      message.error('Agent 底座不存在，请刷新后重试');
      return;
    }
    setAddingID(candidate.id);
    try {
      await onAddCandidate(candidate.id, {
        name: displayName,
        cli_tool: candidate.cli_tool,
        system_prompt: systemPrompt,
        tools_config: toolsConfig,
        custom_skills: customSkills,
      });
      await handleRefresh();
      message.success(`${displayName} 已添加`);
    } catch (err) {
      message.error(getErrorMessage(err, '添加 Agent 失败'));
    } finally {
      setAddingID(null);
    }
  };

  const handleDeleteMachine = async (machine: DaemonMachine) => {
    setDeletingMachineID(machine.id);
    try {
      await onDeleteMachine(machine.id);
      await handleRefresh();
      message.success(`${machine.name} 已删除`);
    } catch (err) {
      message.error(getErrorMessage(err, '删除电脑连接失败'));
    } finally {
      setDeletingMachineID(null);
    }
  };

  return (
    <>
    <Modal
      centered
      footer={null}
      onCancel={onClose}
      open={open}
      title="CONNECT COMPUTER"
      width={640}
    >
      <div className={styles.content}>
        <div className={styles.nameRow}>
          <Input
            maxLength={100}
            prefix={<DesktopOutlined />}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            icon={<PlusOutlined />}
            loading={creating}
            type="primary"
            onClick={handleCreate}
          >
            创建连接
          </Button>
        </div>

        <div className={styles.commandPanel}>
          <div className={styles.commandHeader}>
            <span>CONNECT COMMAND</span>
            <Tag color="blue" className={styles.versionTag}>Daemon v{DAEMON_VERSION}</Tag>
          </div>
          {created ? (
            <div className={styles.commandList}>
              {launcherRow(created.machine.id, created.install_command)}
              <CommandRow
                command={created.install_command}
                hint="Mac 一键安装命令（终端粘贴运行）"
                label="一键安装"
                tag="Install"
                tagColor="green"
              />
            </div>
          ) : (
            <div className={styles.commandEmpty}>
              点击“创建连接”生成接入命令。支持 Mac 一键安装命令与 Windows 安装器两种方式，已创建连接的 machine key 不会再次显示。
            </div>
          )}
        </div>

        <div className={styles.waitingPanel}>
          <div className={styles.waitingTitle}>
            <span className={hasConnectedMachine ? styles.connectedDot : styles.waitingDot} />
            {machinePanelTitle}
            <Button
              icon={<ReloadOutlined />}
              loading={loading}
              size="small"
              type="text"
              onClick={handleRefresh}
            />
          </div>
          <div className={styles.machineList}>
            {refreshError ? (
              <div className={styles.errorMessage}>{refreshError}</div>
            ) : null}
            {safeMachines.length === 0 ? (
              <span className={styles.empty}>暂无电脑连接</span>
            ) : (
              safeMachines.map((machine) => (
                <div className={styles.machineItem} key={machine.id}>
                  <div>
                    <strong>{machine.name}</strong>
                    <span className={styles.machineMeta}>
                      {machine.machine_id || '等待 daemon 上报主机名'}
                    </span>
                  </div>
                  {machine.status !== 'connected' ? (
                    <div className={styles.machineLauncherButtons}>
                      <Tooltip title="Mac：复制一键安装命令">
                        <Button
                          icon={<AppleOutlined />}
                          loading={launcherBusy === `${machine.id}:mac`}
                          size="small"
                          type="text"
                          onClick={() => handleMacInstall(machine.id)}
                        />
                      </Tooltip>
                      <Tooltip title="Windows：下载一键安装器">
                        <Button
                          icon={<WindowsOutlined />}
                          loading={launcherBusy === `${machine.id}:win`}
                          size="small"
                          type="text"
                          onClick={() => handleDownloadLauncher(machine.id, 'win')}
                        />
                      </Tooltip>
                    </div>
                  ) : null}
                  {machine.status === 'connected' ? (
                    <CheckCircleOutlined className={styles.connectedIcon} />
                  ) : null}
                  {getStatusTag(machine)}
                  <Tag color={machine.is_local ? 'blue' : undefined}>
                    {machine.is_local ? '本地' : '远程'}
                  </Tag>
                  <Popconfirm
                    cancelText="取消"
                    okText="删除"
                    title="删除这台电脑连接？"
                    onConfirm={() => handleDeleteMachine(machine)}
                  >
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      loading={deletingMachineID === machine.id}
                      size="small"
                      type="text"
                    />
                  </Popconfirm>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.candidatePanel}>
          <div className={styles.candidateTitle}>
            <span>DETECTED CLI TOOLS</span>
            <span>{safeCandidates.length} Agents</span>
          </div>
          <div className={styles.candidateList}>
            {safeCandidates.length === 0 ? (
              <div className={styles.candidateEmpty}>
                {hasConnectedMachine
                  ? '电脑已连接，暂无可用 CLI。请重新运行上方安装命令扫描 Claude、Codex、OpenClaw。'
                  : '电脑连接成功后，会在这里显示可用 CLI。你可以基于同一个 CLI 添加多个 Agent。'}
              </div>
            ) : (
              safeCandidates.map((candidate) => {
                      const capabilities = parseCapabilities(candidate.capabilities_json);
                      return (
                  <div className={styles.candidateItem} key={candidate.id}>
                    <div className={styles.candidateMeta}>
                      <strong>{candidate.name}</strong>
                      <span>
                        {candidate.cli_tool} · {candidate.machine_name}
                        {candidate.version ? ` · ${candidate.version}` : ''}
                      </span>
                      {capabilities.length > 0 && (
                        <div className={styles.candidateTags}>
                          {capabilities.slice(0, 3).map((item) => (
                            <Tag key={item}>{item.length > 16 ? item.slice(0, 16) + '...' : item}</Tag>
                          ))}
                          {capabilities.length > 3 && <Tag>+{capabilities.length - 3}</Tag>}
                        </div>
                      )}
                    </div>
                    <Button
                      icon={<PlusOutlined />}
                      loading={addingID === candidate.id}
                      disabled={addingID !== null && addingID !== candidate.id}
                      type="primary"
                      onClick={() => setCreateCandidate(candidate)}
                    >
                      添加 Agent
                    </Button>
                  </div>
              );
              })
            )}
          </div>
        </div>
      </div>
    </Modal>
    <AgentCreateModal
      open={createCandidate !== null}
      machineName={createCandidate?.machine_name ?? ''}
      candidates={createCandidate ? [createCandidate] : []}
      onClose={() => setCreateCandidate(null)}
      onCreate={async (candidateId, displayName, systemPrompt, toolsConfig, customSkills) => {
        await handleCreateAgent(candidateId, displayName, systemPrompt, toolsConfig, customSkills);
        setCreateCandidate(null);
      }}
    />
    </>
  );
};
