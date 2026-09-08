import React, { useState } from 'react';
import { Button, Drawer, Empty, Tag } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import type { MessageBlock, MessageStatus } from '@/types/message';
import { executionTrace } from './executionTrace';
import styles from './ExecutionTraceButton.module.css';
interface ExecutionTraceButtonProps { blocks: MessageBlock[]; status?: MessageStatus }
const STATE_LABELS = { running: '进行中', success: '成功', error: '失败', unconfirmed: '未收到结果' };
export const ExecutionTraceButton: React.FC<ExecutionTraceButtonProps> = ({ blocks, status }) => {
  const [open, setOpen] = useState(false);
  const entries = executionTrace(blocks, status);
  return <>
    <Button type="text" size="small" icon={<BranchesOutlined />} onClick={() => setOpen(true)}>查看执行链路</Button>
    <Drawer title="执行链路" open={open} onClose={() => setOpen(false)} size="large">
      <p className={styles.note}>按实际工具事件的发生顺序展示。Skill 成功表示加载成功；任务是否完成请结合回复与后续工具结果判断。</p>
      {!entries.length && <Empty description="此回复没有记录到工具调用事件；不能据此判断是否使用了 Skill 或 MCP。" />}
      <ol className={styles.timeline}>
        {entries.map(({ call, result, state }, index) => <li className={styles.entry} key={`${call.index}-${index}`}>
          <div className={styles.heading}>
            <Tag>{call.tool_kind === 'skill' ? 'Skill' : call.tool_kind === 'mcp' ? 'MCP' : '工具'}</Tag>
            <strong>{call.skill_name || call.tool_name || '未关联的工具结果'}</strong>
            <Tag color={state === 'success' ? 'success' : state === 'error' ? 'error' : 'default'}>{STATE_LABELS[state]}</Tag>
          </div>
          {call.server_name && <p>服务：{call.server_name}</p>}
          {call.source_path && <p>来源：<code>{call.source_path}</code></p>}
          {call.tool_use_id && <p className={styles.note}>调用 ID：{call.tool_use_id}</p>}
          <details><summary>输入与结果</summary>
            {call.kind === 'tool_use' && <><h4>输入</h4><pre>{call.text || '未记录输入'}</pre></>}
            <h4>结果</h4><pre>{result ? result.text || '已返回结果（无文本输出）' : '尚未收到工具结果'}</pre>
          </details>
        </li>)}
      </ol>
    </Drawer>
  </>;
};
