import type { AgentCandidate } from '@/types/agent';

export interface AgentRuntimeCandidateGroup {
  key: string;
  machineId: string;
  cliTool: string;
  name: string;
  candidates: AgentCandidate[];
  defaultCandidate: AgentCandidate;
}

export function runtimeVariant(candidate: AgentCandidate): 'cli' | 'desktop' {
  return candidate.variant === 'desktop' ? 'desktop' : 'cli';
}

export function runtimeCandidateLabel(candidate: AgentCandidate): string {
  const label = runtimeVariant(candidate) === 'desktop' ? 'Desktop 桌面端' : 'CLI 命令行';
  return candidate.version ? `${label} · ${candidate.version}` : label;
}

export function groupAgentRuntimeCandidates(candidates: AgentCandidate[]): AgentRuntimeCandidateGroup[] {
  const groups = new Map<string, AgentCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.machine_id}:${candidate.cli_tool}`;
    const group = groups.get(key) ?? [];
    if (!group.some((item) => runtimeVariant(item) === runtimeVariant(candidate))) {
      group.push(candidate);
    }
    groups.set(key, group);
  }

  return [...groups.entries()].flatMap(([key, group]) => {
    group.sort((left, right) => Number(runtimeVariant(left) === 'desktop') - Number(runtimeVariant(right) === 'desktop'));
    const defaultCandidate = group.find((candidate) => runtimeVariant(candidate) === 'cli') ?? group[0];
    if (!defaultCandidate) return [];
    return [{
      key,
      machineId: defaultCandidate.machine_id,
      cliTool: defaultCandidate.cli_tool,
      name: defaultCandidate.name,
      candidates: group,
      defaultCandidate,
    }];
  });
}
