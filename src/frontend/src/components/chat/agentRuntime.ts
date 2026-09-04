import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  normalizeAgentRuntimeConfig,
  type AgentRuntimeConfig,
} from '@/types/agentRuntime';

export {
  CODEX_MODEL_OPTIONS,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  normalizeAgentRuntimeConfig,
  supportsPriorityServiceTier,
} from '@/types/agentRuntime';
export type {
  AgentApprovalMode,
  AgentReasoningEffort,
  AgentRuntimeConfig,
  AgentRuntimeModel,
  AgentServiceTier,
} from '@/types/agentRuntime';

export function runtimePreferenceKey(conversationId: string, agentId: string): string {
  return `di-agent:runtime:v2:${conversationId}:${agentId}`;
}

function legacyRuntimePreferenceKey(conversationId: string, agentId: string): string {
  return `di-agent:runtime:v1:${conversationId}:${agentId}`;
}

export function readRuntimePreference(conversationId: string, agentId: string): AgentRuntimeConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_AGENT_RUNTIME_CONFIG };
  try {
    const currentKey = runtimePreferenceKey(conversationId, agentId);
    const persisted = window.localStorage.getItem(currentKey)
      ?? window.localStorage.getItem(legacyRuntimePreferenceKey(conversationId, agentId));
    const normalized = normalizeAgentRuntimeConfig(JSON.parse(persisted ?? 'null'));
    if (persisted !== null) window.localStorage.setItem(currentKey, JSON.stringify(normalized));
    return normalized;
  } catch {
    return { ...DEFAULT_AGENT_RUNTIME_CONFIG };
  }
}

export function writeRuntimePreference(
  conversationId: string,
  agentId: string,
  value: AgentRuntimeConfig,
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    runtimePreferenceKey(conversationId, agentId),
    JSON.stringify(normalizeAgentRuntimeConfig(value)),
  );
}

export interface RuntimePreferenceState {
  identity: string;
  value: AgentRuntimeConfig;
}

export function resolveRuntimePreference(
  state: RuntimePreferenceState,
  conversationId: string,
  agentId: string | undefined,
): RuntimePreferenceState {
  const identity = agentId ? `${conversationId}:${agentId}` : '';
  if (state.identity === identity) return state;
  return {
    identity,
    value: agentId
      ? readRuntimePreference(conversationId, agentId)
      : { ...DEFAULT_AGENT_RUNTIME_CONFIG },
  };
}
