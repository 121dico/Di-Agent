// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchWsEvent } from '@/store/wsStore';
import { useAgentApprovalStore } from '@/store/agentApprovalStore';
import { AgentApprovalPrompt } from './AgentApprovalPrompt';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  mounted.splice(0).forEach(({ container, unmount }) => {
    act(() => unmount());
    container.remove();
  });
  useAgentApprovalStore.getState().clear();
});

describe('AgentApprovalPrompt', () => {
  it('shows only requests for the active conversation and waits for server resolution', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<AgentApprovalPrompt conversationId="conversation-1" />));

    act(() => dispatchWsEvent('agent.approval_required', {
      approval_id: 'approval-other',
      conversation_id: 'conversation-2',
      task_id: 'task-other',
      agent_id: 'agent-1',
      kind: 'command',
      method: 'item/commandExecution/requestApproval',
      details: { command: ['echo', 'ignored'] },
    }));
    expect(container.querySelector('[aria-label="Agent 审批请求"]')).toBeNull();

    act(() => dispatchWsEvent('agent.approval_required', {
      approval_id: 'approval-1',
      conversation_id: 'conversation-1',
      task_id: 'task-1',
      agent_id: 'agent-1',
      kind: 'command',
      method: 'item/commandExecution/requestApproval',
      details: { command: ['npm', 'test'] },
    }));
    expect(container.textContent).toContain('Agent 请求执行命令');
    expect(container.textContent).toContain('npm test');

    act(() => dispatchWsEvent('agent.approval_resolved', {
      approval_id: 'approval-1',
      conversation_id: 'conversation-1',
      decision: 'accept',
    }));
    expect(container.querySelector('[aria-label="Agent 审批请求"]')).toBeNull();
  });

  it('keeps a background conversation request and restores it when switching back', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<AgentApprovalPrompt conversationId="conversation-1" />));

    act(() => dispatchWsEvent('agent.approval_required', {
      approval_id: 'approval-background', conversation_id: 'conversation-2',
      task_id: 'task-2', agent_id: 'agent-1', kind: 'file_change',
      method: 'item/fileChange/requestApproval', details: { description: '修改 app.ts' },
    }));
    expect(container.querySelector('[aria-label="Agent 审批请求"]')).toBeNull();

    act(() => root.render(<AgentApprovalPrompt conversationId="conversation-2" />));
    expect(container.textContent).toContain('Agent 请求修改文件');
    expect(container.textContent).toContain('允许一次');
  });
});
