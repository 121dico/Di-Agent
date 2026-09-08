import React, { useMemo, useState } from 'react';
import { Alert, Button, Drawer, Empty, Input } from 'antd';
import { SearchOutlined, FolderOpenOutlined } from '@ant-design/icons';
import type { Skill } from './agentPresentation';
import { useAgentStore } from '@/store/agentStore';
import { message } from '@/utils/message';
import styles from './LocalSkillsPanel.module.css';

interface LocalSkillsPanelProps {
  agentId: string;
  skills: Skill[];
  onImport: (skill: Skill) => Promise<void>;
}

export function localSkillIndex(skill: Skill): Skill {
  // 即便旧服务仍返回 detail，入库也只复制索引。
  return { name: skill.name, category: skill.category, description: skill.description, trigger: skill.usage || skill.trigger, source_path: skill.source_path };
}

export const LocalSkillsPanel: React.FC<LocalSkillsPanelProps> = ({ agentId, skills, onImport }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Skill | null>(null);
  const [opening, setOpening] = useState(false);
  const [importing, setImporting] = useState(false);
  const openLocation = useAgentStore((s) => s.openSkillLocation);
  const filtered = useMemo(() => skills.filter((skill) => [skill.name, skill.description, skill.usage, skill.source_path].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase()))), [skills, query]);
  const openFolder = async () => {
    if (!selected?.source_path) return;
    setOpening(true);
    try { await openLocation(agentId, selected.source_path); message.success('已打开所在文件夹'); }
    catch (error) { message.error(error instanceof Error ? error.message : '打开失败，请确认本地 daemon 在线'); }
    finally { setOpening(false); }
  };
  return (
    <section className={styles.container}>
      <Alert type="info" title="本地 Skills 已识别" description="服务端只同步功能、用法和位置索引；完整技能与资源留在本机，由 Agent 按需加载。这里展示最近上报记录，实际加载结果可在回复的执行链路中查看。" />
      <Input prefix={<SearchOutlined />} aria-label="搜索本地 Skills" placeholder="搜索本地 Skill 名称、功能、用法或路径" value={query} onChange={(e) => setQuery(e.target.value)} allowClear />
      {!filtered.length && <Empty description={skills.length ? '没有匹配的本地 Skill' : '当前 Agent 尚未上报本地 Skill 文件'} />}
      <div className={styles.grid}>
        {filtered.map((skill, index) => <button type="button" className={styles.card} key={`${skill.source_path}-${skill.name}-${index}`} onClick={() => setSelected(skill)}>
          <strong>{skill.name}</strong><span>{skill.description || '暂无功能描述'}</span><small>{skill.source_path}</small>
        </button>)}
      </div>
      <Drawer title={selected?.name || '本地 Skill'} open={!!selected} onClose={() => setSelected(null)} size="large">
        {selected && <div className={styles.detail}>
          <h3>功能</h3><p>{selected.description || '未上报功能描述'}</p>
          <h3>如何使用</h3><p>{selected.usage || selected.trigger || '由本地 Agent 按此路径加载 SKILL.md，并遵循其中的使用说明。'}</p>
          <h3>本地位置</h3><code>{selected.source_path || '未上报路径'}</code>
          <Button icon={<FolderOpenOutlined />} disabled={!selected.source_path} loading={opening} onClick={() => void openFolder()}>在 Agent 电脑打开位置</Button>
          <Alert type="info" title="入库只创建索引副本" description="复制功能与用法到平台库，不上传 SKILL.md 正文或配套资源。本地使用无需先入库。" />
          <Button loading={importing} onClick={async () => { setImporting(true); try { await onImport(localSkillIndex(selected)); } finally { setImporting(false); } }}>入库（索引副本）</Button>
        </div>}
      </Drawer>
    </section>
  );
};
