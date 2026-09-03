import { describe, expect, it } from 'vitest';
import type { Agent } from '@/types/agent';
import { getAgentDescription, getAgentRuntimeIdentity } from './agentPresentation';

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-codex',
    name: 'Codex',
    type: 'custom',
    cli_tool: 'codex',
    runtime_variant: 'cli',
    source: 'daemon',
    status: 'online',
    created_at: '2026-09-03T09:00:00Z',
    updated_at: '2026-09-03T09:00:00Z',
    ...overrides,
  };
}

describe('getAgentRuntimeIdentity', () => {
  it('uses the persisted Desktop variant instead of the bundled CLI version prefix', () => {
    const identity = getAgentRuntimeIdentity(createAgent({
      runtime_variant: 'desktop',
      version: 'codex-cli 0.153.0-alpha.5',
    }));

    expect(identity).toEqual({
      variant: 'desktop',
      variantLabel: 'Desktop 桌面端',
      shortVariantLabel: 'Desktop',
      productLabel: 'Codex',
      version: '0.153.0-alpha.5',
      subtitle: '@codex · Desktop 桌面端 · 0.153.0-alpha.5',
    });
  });

  it('labels a CLI runtime explicitly and normalizes a leading v', () => {
    expect(getAgentRuntimeIdentity(createAgent({ version: 'codex-cli v0.145.0' })).subtitle)
      .toBe('@codex · CLI 命令行 · 0.145.0');
  });

  it('keeps legacy agents compatible by defaulting a missing variant to CLI', () => {
    expect(getAgentRuntimeIdentity(createAgent({ runtime_variant: undefined })).variantLabel)
      .toBe('CLI 命令行');
  });

  it('does not repeat a placeholder variant as a version', () => {
    expect(getAgentRuntimeIdentity(createAgent({
      runtime_variant: 'desktop',
      version: 'desktop',
    })).subtitle).toBe('@codex · Desktop 桌面端');
  });

  it('describes Desktop Codex without calling it a local CLI Agent', () => {
    const description = getAgentDescription(createAgent({ runtime_variant: 'desktop' }));
    expect(description).toContain('Codex 桌面端 Agent');
    expect(description).not.toContain('本地 CLI Agent');
  });
});
