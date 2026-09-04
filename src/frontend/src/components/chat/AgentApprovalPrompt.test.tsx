// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchWsEvent } from '@/store/wsStore';
import { useWsStore } from '@/store/wsStore';
import { useAgentApprovalStore } from '@/store/agentApprovalStore';
import { AgentApprovalPrompt } from './AgentApprovalPrompt';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  mounted.splice(0).forEach(({ container, unmount }) => {
    act(() => unmount());
    container.remove();
  });
  useAgentApprovalStore.getState().clear();
  useWsStore.setState({ status: 'disconnected', wsClient: null, currentToken: null });
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

  it('requests pending approvals again whenever the same websocket client reconnects', () => {
    const sent: string[] = [];
    const wsClient = { send: (payload: string) => sent.push(payload) };
    useWsStore.setState({
      status: 'disconnected',
      wsClient: wsClient as never,
      currentToken: 'token',
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<AgentApprovalPrompt conversationId="conversation-1" />));
    expect(sent).toHaveLength(0);

    act(() => useWsStore.setState({ status: 'connected' }));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({
      type: 'agent.approval_list',
      data: { conversation_id: 'conversation-1' },
    });

    act(() => useWsStore.setState({ status: 'disconnected' }));
    act(() => useWsStore.setState({ status: 'connected' }));
    expect(sent).toHaveLength(2);
  });

  it('reconciles an authoritative empty snapshot after a missed resolution', () => {
    useAgentApprovalStore.getState().upsert({
      approval_id: 'approval-stale', conversation_id: 'conversation-1',
      task_id: 'task-1', agent_id: 'agent-1', kind: 'command', method: 'command',
      details: { command: 'pwd' },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<AgentApprovalPrompt conversationId="conversation-1" />));
    expect(container.textContent).toContain('pwd');

    act(() => dispatchWsEvent('agent.approval_snapshot', {
      conversation_id: 'conversation-1', approvals: [],
    }));
    expect(container.querySelector('[aria-label="Agent 审批请求"]')).toBeNull();
  });

  it('ignores a stale empty snapshot delivered after a newer required event', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<AgentApprovalPrompt conversationId="conversation-1" />));

    const approval = {
      approval_id: 'approval-new', conversation_id: 'conversation-1',
      task_id: 'task-new', agent_id: 'agent-1', kind: 'command', method: 'command',
      details: { command: 'pwd' },
    };
    act(() => dispatchWsEvent('agent.approval_required', {
      ...approval, approvals: [approval], revision: 2,
    }));
    act(() => dispatchWsEvent('agent.approval_snapshot', {
      conversation_id: 'conversation-1', approvals: [], revision: 1,
    }));

    expect(container.textContent).toContain('pwd');
  });

  it('ignores a stale non-empty snapshot delivered after a newer resolution', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<AgentApprovalPrompt conversationId="conversation-1" />));

    const approval = {
      approval_id: 'approval-old', conversation_id: 'conversation-1',
      task_id: 'task-old', agent_id: 'agent-1', kind: 'command', method: 'command',
      details: { command: 'pwd' },
    };
    act(() => dispatchWsEvent('agent.approval_required', {
      ...approval, approvals: [approval], revision: 1,
    }));
    act(() => dispatchWsEvent('agent.approval_resolved', {
      approval_id: 'approval-old', conversation_id: 'conversation-1', approvals: [], revision: 2,
    }));
    act(() => dispatchWsEvent('agent.approval_snapshot', {
      conversation_id: 'conversation-1', approvals: [approval], revision: 1,
    }));

    expect(container.querySelector('[aria-label="Agent 审批请求"]')).toBeNull();
  });

  it('shows the concrete file root and permission profile before approval', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<AgentApprovalPrompt conversationId="conversation-1" />));

    act(() => dispatchWsEvent('agent.approval_required', {
      approval_id: 'approval-file', conversation_id: 'conversation-1',
      task_id: 'task-file', agent_id: 'agent-1', kind: 'file_change', method: 'file-change',
      details: { grantRoot: '/workspace/project', reason: 'write output' },
    }));
    expect(container.textContent).toContain('范围：/workspace/project');

    act(() => dispatchWsEvent('agent.approval_resolved', {
      approval_id: 'approval-file', conversation_id: 'conversation-1',
    }));
    act(() => dispatchWsEvent('agent.approval_required', {
      approval_id: 'approval-permission', conversation_id: 'conversation-1',
      task_id: 'task-permission', agent_id: 'agent-1', kind: 'permissions', method: 'permissions',
      details: { cwd: '/workspace/project', permissions: { network: { enabled: true } } },
    }));
    expect(container.textContent).toContain('"network"');
    expect(container.textContent).toContain('目录：/workspace/project');
    expect(container.textContent).toContain('查看授权详情');
  });
});
