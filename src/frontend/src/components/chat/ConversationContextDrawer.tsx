import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  HistoryOutlined,
  ImportOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Empty, Input, Modal, Select, Spin, Tooltip } from 'antd';
import { getConversationAgents, getConversations } from '@/api/conversation';
import {
  continueFromConversationCheckpoint,
  createConversationCheckpoint,
  deleteConversationCheckpoint,
  getConversationCheckpoint,
  getConversationCheckpoints,
  getConversationContextUsage,
} from '@/api/context';
import { useConversationStore } from '@/store/conversationStore';
import type { Conversation, ConversationAgent } from '@/types/conversation';
import type {
  CheckpointScope,
  ContextUsage,
  ConversationCheckpoint,
} from '@/types/context';
import { message } from '@/utils/message';
import { modal } from '@/utils/modal';
import { CheckpointItem } from './CheckpointItem';
import { ContextUsagePanel } from './ContextUsagePanel';
import { canContinueCheckpoint, CHECKPOINT_SCOPE_OPTIONS } from './checkpointPresentation';
import {
  checkpointExportFilename,
  checkpointExportMarkdown,
  downloadMarkdown,
} from './checkpointExport';
import styles from './ConversationContextDrawer.module.css';

export interface ContextAgentOption {
  id: string;
  name: string;
}

interface ConversationContextDrawerProps {
  conversationId: string;
  open: boolean;
  agents: ContextAgentOption[];
  onClose: () => void;
}

export const ConversationContextDrawer: React.FC<ConversationContextDrawerProps> = ({
  conversationId,
  open,
  agents,
  onClose,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [scope, setScope] = useState<CheckpointScope>('conversation_shared');
  const [checkpoints, setCheckpoints] = useState<ConversationCheckpoint[]>([]);
  const [usages, setUsages] = useState<ContextUsage[]>([]);
  const [preview, setPreview] = useState<ConversationCheckpoint | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sourceConversations, setSourceConversations] = useState<Conversation[]>([]);
  const [sourceConversationId, setSourceConversationId] = useState('');
  const [sourceCheckpoints, setSourceCheckpoints] = useState<ConversationCheckpoint[]>([]);
  const [sourceCheckpointId, setSourceCheckpointId] = useState('');
  const [sourceAgents, setSourceAgents] = useState<ConversationAgent[]>([]);
  const [targetAgentId, setTargetAgentId] = useState('');
  const [forkTitle, setForkTitle] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const requestEpoch = useRef(0);
  const importEpoch = useRef(0);
  const forkConversation = useConversationStore((state) => state.forkConversation);

  useEffect(() => {
    if (agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agents[0]?.id ?? '');
  }, [agents, selectedAgentId]);

  const loadData = useCallback(async (silent = false) => {
    const epoch = ++requestEpoch.current;
    if (!silent) setLoading(true);
    try {
      const [nextCheckpoints, nextUsages] = await Promise.all([
        getConversationCheckpoints(conversationId),
        getConversationContextUsage(conversationId),
      ]);
      if (epoch !== requestEpoch.current) return;
      setCheckpoints(nextCheckpoints);
      setUsages(nextUsages);
    } catch {
      if (!silent) message.error('加载上下文记录失败');
    } finally {
      if (epoch === requestEpoch.current && !silent) setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open) return;
    void loadData();
    return () => {
      requestEpoch.current += 1;
    };
  }, [loadData, open]);

  const hasGeneratingCheckpoint = checkpoints.some(
    (item) => item.status === 'draft' || item.status === 'generating',
  );

  useEffect(() => {
    if (!open || !hasGeneratingCheckpoint) return;
    const timer = window.setTimeout(() => void loadData(true), 2500);
    return () => window.clearTimeout(timer);
  }, [hasGeneratingCheckpoint, loadData, open, checkpoints]);

  const selectedUsage = useMemo(
    () => usages.find((item) => item.agent_id === selectedAgentId),
    [selectedAgentId, usages],
  );

  const selectedCheckpoints = useMemo(
    () => checkpoints.filter((item) => item.source_agent_id === selectedAgentId),
    [checkpoints, selectedAgentId],
  );

  const createCheckpoint = useCallback(async () => {
    if (!selectedAgentId) return;
    setActionId('create');
    try {
      const created = await createConversationCheckpoint(conversationId, {
        agent_id: selectedAgentId,
        scope,
      });
      setCheckpoints((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      message.success(created.status === 'ready' ? '检查点已创建' : '已开始生成检查点');
    } catch {
      message.error('创建检查点失败');
    } finally {
      setActionId(null);
    }
  }, [conversationId, scope, selectedAgentId]);

  const openPreview = useCallback(async (checkpoint: ConversationCheckpoint) => {
    setActionId(checkpoint.id);
    try {
      setPreview(await getConversationCheckpoint(conversationId, checkpoint.id));
    } catch {
      message.error('加载检查点详情失败');
    } finally {
      setActionId(null);
    }
  }, [conversationId]);

  const exportCheckpoint = useCallback(async (checkpoint: ConversationCheckpoint) => {
    setActionId(checkpoint.id);
    try {
      const detail = await getConversationCheckpoint(conversationId, checkpoint.id);
      downloadMarkdown(
        checkpointExportFilename(detail),
        checkpointExportMarkdown(detail),
      );
      message.success('检查点已导出');
    } catch {
      message.error('导出检查点失败');
    } finally {
      setActionId(null);
    }
  }, [conversationId]);

  const removeCheckpoint = useCallback((checkpoint: ConversationCheckpoint) => {
    modal.confirm({
      title: '删除检查点',
      content: '原始消息不会删除，但之后不能再从这个检查点继续。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteConversationCheckpoint(conversationId, checkpoint.id);
          setCheckpoints((items) => items.filter((item) => item.id !== checkpoint.id));
          if (preview?.id === checkpoint.id) setPreview(null);
          message.success('检查点已删除');
        } catch (error) {
          message.error('删除检查点失败');
          throw error;
        }
      },
    });
  }, [conversationId, preview?.id]);

  const continueCheckpoint = useCallback((checkpoint: ConversationCheckpoint) => {
    if (!selectedAgentId) return;
    modal.confirm({
      title: '在新 Session 中继续',
      content: 'Conversation 和原始消息保持不变，系统会创建干净 Session 并注入这个检查点。',
      okText: '创建新 Session',
      cancelText: '取消',
      onOk: async () => {
        setActionId(checkpoint.id);
        try {
          const result = await continueFromConversationCheckpoint(conversationId, checkpoint.id, {
            agent_id: selectedAgentId,
          });
          message.success(`已切换到第 ${result.generation} 代 Session`);
          await loadData(true);
        } catch (error) {
          message.error('创建新 Session 失败');
          throw error;
        } finally {
          setActionId(null);
        }
      },
    });
  }, [conversationId, loadData, selectedAgentId]);

  const loadSourceCheckpoints = useCallback(async (sourceId: string) => {
    const epoch = ++importEpoch.current;
    setSourceLoading(true);
    setSourceCheckpointId('');
    setSourceCheckpoints([]);
    setSourceAgents([]);
    setTargetAgentId('');
    try {
      const [items, nextAgents] = await Promise.all([
        getConversationCheckpoints(sourceId),
        getConversationAgents(sourceId),
      ]);
      if (epoch !== importEpoch.current) return;
      const available = items.filter((item) => canContinueCheckpoint(item.status));
      const initialCheckpoint = available[0];
      setSourceCheckpoints(available);
      setSourceAgents(nextAgents);
      setSourceCheckpointId(initialCheckpoint?.id ?? '');
      setTargetAgentId(
        nextAgents.some((agent) => agent.agent_id === initialCheckpoint?.source_agent_id)
          ? (initialCheckpoint?.source_agent_id ?? '')
          : (nextAgents[0]?.agent_id ?? ''),
      );
    } catch {
      if (epoch === importEpoch.current) message.error('加载来源对话的检查点失败');
    } finally {
      if (epoch === importEpoch.current) setSourceLoading(false);
    }
  }, []);

  const openImport = useCallback(async () => {
    setImportOpen(true);
    setForkTitle('');
    setSourceLoading(true);
    setSourceConversationId('');
    setSourceCheckpointId('');
    setSourceCheckpoints([]);
    setSourceAgents([]);
    setTargetAgentId('');
    setForkTitle('');
    const epoch = ++importEpoch.current;
    try {
      const items = await getConversations();
      if (epoch !== importEpoch.current) return;
      setSourceConversations(items);
      const firstId = items.some((item) => item.id === conversationId)
        ? conversationId
        : (items[0]?.id ?? '');
      setSourceConversationId(firstId);
      if (firstId) await loadSourceCheckpoints(firstId);
    } catch {
      if (epoch === importEpoch.current) message.error('加载可引入的对话失败');
    } finally {
      if (epoch === importEpoch.current) setSourceLoading(false);
    }
  }, [conversationId, loadSourceCheckpoints]);

  const closeImport = useCallback(() => {
    importEpoch.current += 1;
    setImportOpen(false);
    setSourceLoading(false);
  }, []);

  const importCheckpoint = useCallback(async () => {
    if (!sourceConversationId || !sourceCheckpointId || !targetAgentId) return;
    const checkpoint = sourceCheckpoints.find((item) => item.id === sourceCheckpointId);
    if (!checkpoint) return;
    setImporting(true);
    try {
      await forkConversation(sourceConversationId, {
        checkpoint_id: sourceCheckpointId,
        agent_id: targetAgentId,
        title: forkTitle.trim() || undefined,
      });
      setImportOpen(false);
      onClose();
      message.success('Fork 已创建，正在打开独立对话');
    } catch {
      message.error('创建 Fork 失败，请检查检查点范围和 Agent 权限');
    } finally {
      setImporting(false);
    }
  }, [forkConversation, forkTitle, onClose, sourceCheckpointId, sourceCheckpoints, sourceConversationId, targetAgentId]);

  const sourceConversationOptions = useMemo(
    () => sourceConversations.map((item) => ({ value: item.id, label: item.title })),
    [sourceConversations],
  );

  const sourceCheckpointOptions = useMemo(
    () => sourceCheckpoints.map((item) => ({
      value: item.id,
      label: `检查点 #${item.version ?? item.generation} · ${item.source_agent_name ?? 'Agent'} · ${new Date(item.created_at).toLocaleString()}`,
    })),
    [sourceCheckpoints],
  );

  const selectedSourceCheckpoint = useMemo(
    () => sourceCheckpoints.find((item) => item.id === sourceCheckpointId),
    [sourceCheckpointId, sourceCheckpoints],
  );

  const targetAgentOptions = useMemo(() => {
    const lockedToSource = selectedSourceCheckpoint?.scope === 'private_agent'
      || selectedSourceCheckpoint?.scope === 'orchestrator_only';
    return sourceAgents
      .filter((agent) => !lockedToSource || agent.agent_id === selectedSourceCheckpoint?.source_agent_id)
      .map((agent) => ({ value: agent.agent_id, label: agent.name }));
  }, [selectedSourceCheckpoint, sourceAgents]);

  return (
    <>
      <Drawer
        className={styles.drawer}
        title={<span className={styles.drawerTitle}><HistoryOutlined /> 上下文与检查点</span>}
        open={open}
        onClose={onClose}
        width={520}
        destroyOnHidden
        extra={(
          <Tooltip title="刷新">
            <Button type="text" icon={<ReloadOutlined />} onClick={() => void loadData()} />
          </Tooltip>
        )}
      >
        <div className={styles.drawerBody}>
          <div className={styles.agentPicker}>
            <span>Agent</span>
            <Select
              value={selectedAgentId || undefined}
              options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
              onChange={setSelectedAgentId}
              placeholder="选择 Agent"
              disabled={agents.length === 0}
            />
          </div>

          {loading ? (
            <div className={styles.loading}><Spin /></div>
          ) : (
            <>
              <ContextUsagePanel usage={selectedUsage} />
              <div className={styles.sectionHeader}>
                <h3>会话检查点</h3>
                <Button
                  icon={<ImportOutlined />}
                  onClick={() => void openImport()}
                >
                  Fork 对话
                </Button>
              </div>
              <div className={styles.createActions}>
                <Select value={scope} options={CHECKPOINT_SCOPE_OPTIONS} onChange={setScope} />
                <Tooltip title="创建检查点">
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => void createCheckpoint()}
                    loading={actionId === 'create'}
                    disabled={!selectedAgentId}
                  >
                    保存检查点
                  </Button>
                </Tooltip>
              </div>

              {selectedCheckpoints.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有检查点" />
              ) : (
                <div className={styles.checkpointList}>
                  {selectedCheckpoints.map((checkpoint) => (
                    <CheckpointItem
                      key={checkpoint.id}
                      checkpoint={checkpoint}
                      busy={actionId === checkpoint.id}
                      onPreview={(item) => void openPreview(item)}
                      onExport={(item) => void exportCheckpoint(item)}
                      onContinue={continueCheckpoint}
                      onDelete={removeCheckpoint}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Drawer>

      <Modal
        title={preview ? `检查点 #${preview.version ?? preview.generation}` : '检查点'}
        open={preview !== null}
        footer={null}
        width={760}
        zIndex={1200}
        onCancel={() => setPreview(null)}
      >
        <div className={styles.markdownPreview}>
          {preview?.markdown_content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.markdown_content}</ReactMarkdown>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="摘要仍在生成" />
          )}
        </div>
      </Modal>

      <Modal
        title="Fork 对话"
        open={importOpen}
        zIndex={1200}
        okText="创建独立 Fork"
        cancelText="取消"
        confirmLoading={importing}
        okButtonProps={{
          disabled: sourceLoading || !sourceConversationId || !sourceCheckpointId || !targetAgentId,
        }}
        destroyOnHidden
        onOk={() => void importCheckpoint()}
        onCancel={closeImport}
      >
        <div className={styles.importForm}>
          <label className={styles.importField}>
            <span>来源对话</span>
            <Select
              value={sourceConversationId || undefined}
              options={sourceConversationOptions}
              placeholder="选择要接续的对话"
              loading={sourceLoading && sourceConversations.length === 0}
              notFoundContent="没有其他可用对话"
              onChange={(value) => {
                setSourceConversationId(value);
                void loadSourceCheckpoints(value);
              }}
            />
          </label>
          <label className={styles.importField}>
            <span>来源检查点</span>
            <Select
              value={sourceCheckpointId || undefined}
              options={sourceCheckpointOptions}
              placeholder="选择已完成的检查点"
              loading={sourceLoading}
              disabled={!sourceConversationId}
              notFoundContent={sourceLoading ? <Spin size="small" /> : '这个对话还没有可用检查点'}
              onChange={(value) => {
                setSourceCheckpointId(value);
                const checkpoint = sourceCheckpoints.find((item) => item.id === value);
                const lockedToSource = checkpoint?.scope === 'private_agent'
                  || checkpoint?.scope === 'orchestrator_only';
                if (lockedToSource || sourceAgents.some((agent) => agent.agent_id === checkpoint?.source_agent_id)) {
                  setTargetAgentId(checkpoint?.source_agent_id ?? '');
                } else {
                  setTargetAgentId(sourceAgents[0]?.agent_id ?? '');
                }
              }}
            />
          </label>
          <label className={styles.importField}>
            <span>分支标题</span>
            <Input
              value={forkTitle}
              maxLength={255}
              placeholder="留空时使用“来源标题 · Fork”"
              onChange={(event) => setForkTitle(event.target.value)}
            />
          </label>
          <label className={styles.importField}>
            <span>目标 Agent</span>
            <Select
              value={targetAgentId || undefined}
              options={targetAgentOptions}
              placeholder="选择新分支使用的 Agent"
              disabled={!sourceCheckpointId || targetAgentOptions.length === 0}
              onChange={setTargetAgentId}
            />
          </label>
          <p className={styles.importHint}>
            确认后会创建新的 Conversation 和独立 generation 1 Session，并从检查点恢复上下文。父对话、原始消息和原 Session 都不会被修改。
          </p>
        </div>
      </Modal>
    </>
  );
};
