import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  normalizeAgentRuntimeConfig,
  runtimePreferenceKey,
} from './agentRuntime';

describe('agent runtime preferences', () => {
  it('defaults to safe automatic review without forcing a model', () => {
    expect(DEFAULT_AGENT_RUNTIME_CONFIG).toEqual({
      version: 1,
      model: '',
      reasoning_effort: 'medium',
      approval_mode: 'auto',
    });
  });

  it('accepts supported Codex controls and rejects unknown values', () => {
    expect(normalizeAgentRuntimeConfig({
      version: 1,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      approval_mode: 'request',
    })).toEqual({
      version: 1,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      approval_mode: 'request',
    });
    expect(normalizeAgentRuntimeConfig({
      model: '--dangerously-bypass-approvals-and-sandbox',
      reasoning_effort: 'ultra',
      approval_mode: 'anything',
    })).toEqual(DEFAULT_AGENT_RUNTIME_CONFIG);
  });

  it('isolates saved choices by conversation and agent', () => {
    expect(runtimePreferenceKey('conversation-1', 'agent-2'))
      .toBe('di-agent:runtime:v1:conversation-1:agent-2');
  });
});
