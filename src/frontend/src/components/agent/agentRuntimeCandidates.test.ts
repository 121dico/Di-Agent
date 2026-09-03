import { describe, expect, it } from 'vitest';
import type { AgentCandidate } from '@/types/agent';
import {
  groupAgentRuntimeCandidates,
  runtimeCandidateLabel,
} from './agentRuntimeCandidates';

function candidate(overrides: Partial<AgentCandidate>): AgentCandidate {
  return {
    id: 'candidate',
    machine_id: 'machine-1',
    machine_name: 'My Mac',
    name: 'Codex',
    cli_tool: 'codex',
    created_at: '2026-09-03T00:00:00Z',
    updated_at: '2026-09-03T00:00:00Z',
    ...overrides,
  };
}

describe('agent runtime candidate grouping', () => {
  it('groups CLI and Desktop into one product and defaults to CLI', () => {
    const groups = groupAgentRuntimeCandidates([
      candidate({ id: 'desktop', variant: 'desktop', version: '2.0.0' }),
      candidate({ id: 'cli', variant: 'cli', version: '1.0.0' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.candidates.map((item) => item.id)).toEqual(['cli', 'desktop']);
    expect(groups[0]!.defaultCandidate.id).toBe('cli');
  });

  it('keeps identical products on different machines separate and deduplicates a variant', () => {
    const groups = groupAgentRuntimeCandidates([
      candidate({ id: 'cli-old', variant: 'cli' }),
      candidate({ id: 'cli-duplicate', variant: 'cli' }),
      candidate({ id: 'remote-cli', machine_id: 'machine-2', variant: 'cli' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.candidates).toHaveLength(1);
  });

  it('formats runtime option labels with their version', () => {
    expect(runtimeCandidateLabel(candidate({ variant: 'cli', version: 'codex-cli 1.0.0' })))
      .toBe('CLI 命令行 · codex-cli 1.0.0');
    expect(runtimeCandidateLabel(candidate({ variant: 'desktop', version: 'Codex 2.0.0' })))
      .toBe('Desktop 桌面端 · Codex 2.0.0');
  });
});
