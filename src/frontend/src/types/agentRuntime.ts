export const CODEX_MODEL_OPTIONS = [
  { value: '', label: 'Default', description: '推荐模型组合' },
  { value: 'gpt-5.6-sol', label: '5.6 Sol' },
  { value: 'gpt-5.6-terra', label: '5.6 Terra' },
  { value: 'gpt-5.6-luna', label: '5.6 Luna' },
  { value: 'gpt-5.5', label: '5.5' },
  { value: 'gpt-5.4', label: '5.4' },
  { value: 'gpt-5.4-mini', label: '5.4 Mini' },
  { value: 'gpt-5.3-codex-spark', label: '5.3 Codex Spark' },
] as const;

export type AgentRuntimeModel = typeof CODEX_MODEL_OPTIONS[number]['value'];
export type AgentReasoningEffort = 'low' | 'medium' | 'high';
export type AgentApprovalMode = 'request' | 'auto' | 'full';
export type AgentServiceTier = 'default' | 'priority';

export interface AgentRuntimeConfig {
  version: 2;
  model: AgentRuntimeModel;
  reasoning_effort: AgentReasoningEffort;
  approval_mode: AgentApprovalMode;
  service_tier: AgentServiceTier;
}

export const DEFAULT_AGENT_RUNTIME_CONFIG: AgentRuntimeConfig = {
  version: 2,
  model: '',
  reasoning_effort: 'medium',
  approval_mode: 'auto',
  service_tier: 'default',
};

const MODELS = new Set(CODEX_MODEL_OPTIONS.map((option) => option.value));
const EFFORTS = new Set<AgentReasoningEffort>(['low', 'medium', 'high']);
const APPROVALS = new Set<AgentApprovalMode>(['request', 'auto', 'full']);
const SERVICE_TIERS = new Set<AgentServiceTier>(['default', 'priority']);
const PRIORITY_UNSUPPORTED_MODELS = new Set<AgentRuntimeModel>([
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark',
]);

export function supportsPriorityServiceTier(model: AgentRuntimeModel): boolean {
  return !PRIORITY_UNSUPPORTED_MODELS.has(model);
}

export function normalizeAgentRuntimeConfig(value: unknown): AgentRuntimeConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AGENT_RUNTIME_CONFIG };
  const candidate = value as {
    version?: unknown;
    model?: unknown;
    reasoning_effort?: unknown;
    approval_mode?: unknown;
    service_tier?: unknown;
  };
  if (
    (candidate.version !== 1 && candidate.version !== 2)
    || !MODELS.has(candidate.model as AgentRuntimeModel)
    || !EFFORTS.has(candidate.reasoning_effort as AgentReasoningEffort)
    || !APPROVALS.has(candidate.approval_mode as AgentApprovalMode)
  ) return { ...DEFAULT_AGENT_RUNTIME_CONFIG };
  const model = candidate.model as AgentRuntimeModel;
  const requestedServiceTier: unknown = candidate.version === 1
    ? 'default'
    : candidate.service_tier;
  if (!SERVICE_TIERS.has(requestedServiceTier as AgentServiceTier)) {
    return { ...DEFAULT_AGENT_RUNTIME_CONFIG };
  }
  const serviceTier: AgentServiceTier = requestedServiceTier === 'priority' && supportsPriorityServiceTier(model)
    ? 'priority'
    : 'default';
  return {
    version: 2,
    model,
    reasoning_effort: candidate.reasoning_effort as AgentReasoningEffort,
    approval_mode: candidate.approval_mode as AgentApprovalMode,
    service_tier: serviceTier,
  };
}
