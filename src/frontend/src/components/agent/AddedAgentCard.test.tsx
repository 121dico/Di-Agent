// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Agent } from '@/types/agent';
import { AddedAgentCard } from './AddedAgentCard';
import { AgentProfile } from './AgentProfile';

const desktopCodex: Agent = {
  id: 'agent-desktop-codex',
  name: 'Codex',
  type: 'custom',
  cli_tool: 'codex',
  runtime_variant: 'desktop',
  source: 'daemon',
  status: 'online',
  version: 'codex-cli 0.153.0-alpha.5',
  created_at: '2026-09-03T09:00:00Z',
  updated_at: '2026-09-03T09:00:00Z',
};

describe('AddedAgentCard runtime identity', () => {
  it('presents a Desktop Agent as Desktop instead of echoing the bundled CLI name', () => {
    const markup = renderToStaticMarkup(<AddedAgentCard agent={desktopCodex} />);

    expect(markup).toContain('@codex · Desktop 桌面端 · 0.153.0-alpha.5');
    expect(markup).not.toContain('codex-cli');
  });

  it('uses the same Desktop identity in the Agent profile header', () => {
    const markup = renderToStaticMarkup(<AgentProfile agent={desktopCodex} />);

    expect(markup).toContain('@codex · Desktop 桌面端 · 0.153.0-alpha.5');
    expect(markup).not.toContain('codex-cli');
  });
});
