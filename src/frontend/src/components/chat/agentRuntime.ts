import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  normalizeAgentRuntimeConfig,
  type AgentRuntimeConfig,
} from '@/types/agentRuntime';

export {
  CODEX_MODEL_OPTIONS,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  normalizeAgentRuntimeConfig,
} from '@/types/agentRuntime';
export type {
  AgentApprovalMode,
  AgentReasoningEffort,
  AgentRuntimeConfig,
  AgentRuntimeModel,
} from '@/types/agentRuntime';

export function runtimePreferenceKey(conversationId: string, agentId: string): string {
  return `di-agent:runtime:v1:${conversationId}:${agentId}`;
}

export function readRuntimePreference(conversationId: string, agentId: string): AgentRuntimeConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_AGENT_RUNTIME_CONFIG };
  try {
    return normalizeAgentRuntimeConfig(JSON.parse(
      window.localStorage.getItem(runtimePreferenceKey(conversationId, agentId)) ?? 'null',
    ));
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
