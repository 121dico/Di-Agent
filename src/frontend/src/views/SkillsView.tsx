import React, { useEffect, useState } from 'react';
import { Alert, Button, Empty, Select, Spin } from 'antd';
import { AgentSkillsPanel } from '@/components/agent/AgentSkillsPanel';
import { getAgentRuntimeIdentity } from '@/components/agent/agentPresentation';
import { useUIStore } from '@/store/uiStore';
import { useAgentStore } from '@/store/agentStore';
import styles from './SkillsView.module.css';

const SkillsView: React.FC = () => {
  const selectedAgentId = useUIStore((s) => s.selectedAgentId);
  const setSelectedAgent = useUIStore((s) => s.setSelectedAgent);
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const refresh = async () => {
    setLoading(true);
    setError(false);
    try { await fetchAgents(true); } catch { setError(true); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [fetchAgents]);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? agents[0];
  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1>Skills</h1>
        <Select
          aria-label="选择 Agent"
          className={styles.selector}
          showSearch
          optionFilterProp="label"
          value={selectedAgent?.id}
          onChange={setSelectedAgent}
          placeholder="选择 Agent"
          options={agents.map((a) => ({ value: a.id, label: `${a.name} · ${getAgentRuntimeIdentity(a).shortVariantLabel}` }))}
        />
        {selectedAgent && <span className={styles.identity}>{getAgentRuntimeIdentity(selectedAgent).subtitle} · {selectedAgent.machine_name || '未上报机器'} · 最近连接 {selectedAgent.last_seen_at ? new Date(selectedAgent.last_seen_at).toLocaleString() : '未知'}</span>}
        <Button loading={loading} onClick={() => void refresh()}>刷新索引</Button>
      </header>
      {error && <Alert type="error" title="读取 Agent 失败" action={<Button onClick={() => void refresh()}>重试</Button>} />}
      <section className={styles.content}>
        {selectedAgent ? <AgentSkillsPanel key={selectedAgent.id} agent={selectedAgent} /> : loading ? <Spin /> : <Empty description="暂无 Agent，请先连接本地 Agent" />}
      </section>
    </main>
  );
};
export default SkillsView;
