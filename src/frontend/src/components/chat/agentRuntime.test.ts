// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  normalizeAgentRuntimeConfig,
  readRuntimePreference,
  resolveRuntimePreference,
  runtimePreferenceKey,
  supportsPriorityServiceTier,
  writeRuntimePreference,
} from './agentRuntime';

afterEach(() => window.localStorage.clear());

describe('agent runtime preferences', () => {
  it('defaults to safe automatic review without forcing a model', () => {
    expect(DEFAULT_AGENT_RUNTIME_CONFIG).toEqual({
      version: 2,
      model: '',
      reasoning_effort: 'medium',
      approval_mode: 'auto',
      service_tier: 'default',
    });
  });

  it('migrates v1 preferences and accepts supported Codex v2 controls', () => {
    expect(normalizeAgentRuntimeConfig({
      version: 1,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      approval_mode: 'request',
    })).toEqual({
      version: 2,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      approval_mode: 'request',
      service_tier: 'default',
    });
    expect(normalizeAgentRuntimeConfig({
      version: 2,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      approval_mode: 'request',
      service_tier: 'priority',
    })).toEqual({
      version: 2,
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      approval_mode: 'request',
      service_tier: 'priority',
    });
    expect(normalizeAgentRuntimeConfig({
      model: '--dangerously-bypass-approvals-and-sandbox',
      reasoning_effort: 'ultra',
      approval_mode: 'anything',
    })).toEqual(DEFAULT_AGENT_RUNTIME_CONFIG);
  });

  it('resets priority when a model does not advertise the fast service tier', () => {
    expect(supportsPriorityServiceTier('gpt-5.4-mini')).toBe(false);
    expect(supportsPriorityServiceTier('gpt-5.3-codex-spark')).toBe(false);
    expect(supportsPriorityServiceTier('gpt-5.6-sol')).toBe(true);
    expect(normalizeAgentRuntimeConfig({
      version: 2,
      model: 'gpt-5.4-mini',
      reasoning_effort: 'medium',
      approval_mode: 'auto',
      service_tier: 'priority',
    })).toEqual({
      version: 2,
      model: 'gpt-5.4-mini',
      reasoning_effort: 'medium',
      approval_mode: 'auto',
      service_tier: 'default',
    });
  });

  it('isolates saved choices by conversation and agent', () => {
    expect(runtimePreferenceKey('conversation-1', 'agent-2'))
      .toBe('di-agent:runtime:v2:conversation-1:agent-2');
  });

  it('restores a legacy v1 preference into the v2 storage slot', () => {
    window.localStorage.setItem('di-agent:runtime:v1:conversation-1:agent-2', JSON.stringify({
      version: 1,
      model: 'gpt-5.6-terra',
      reasoning_effort: 'low',
      approval_mode: 'request',
    }));

    expect(readRuntimePreference('conversation-1', 'agent-2')).toEqual({
      version: 2,
      model: 'gpt-5.6-terra',
      reasoning_effort: 'low',
      approval_mode: 'request',
      service_tier: 'default',
    });
    expect(window.localStorage.getItem(runtimePreferenceKey('conversation-1', 'agent-2')))
      .toContain('"version":2');
  });

  it('persists and restores model, effort, approval, and priority for one conversation', () => {
    const selected = {
      ...DEFAULT_AGENT_RUNTIME_CONFIG,
      model: 'gpt-5.6-sol' as const,
      reasoning_effort: 'high' as const,
      approval_mode: 'full' as const,
      service_tier: 'priority' as const,
    };
    writeRuntimePreference('conversation-fast', 'agent-sol', selected);
    expect(readRuntimePreference('conversation-fast', 'agent-sol')).toEqual(selected);
  });

  it('never exposes the previous conversation full-access policy during a switch', () => {
    const selected = resolveRuntimePreference({
      identity: 'conversation-1:agent-1',
      value: { ...DEFAULT_AGENT_RUNTIME_CONFIG, approval_mode: 'full' },
    }, 'conversation-2', 'agent-2');

    expect(selected.identity).toBe('conversation-2:agent-2');
    expect(selected.value).toEqual(DEFAULT_AGENT_RUNTIME_CONFIG);
  });
});
