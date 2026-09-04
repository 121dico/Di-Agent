export const CODEX_MODEL_OPTIONS = [
  { value: '', label: '默认模型' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
] as const;

export type AgentRuntimeModel = typeof CODEX_MODEL_OPTIONS[number]['value'];
export type AgentReasoningEffort = 'low' | 'medium' | 'high';
export type AgentApprovalMode = 'request' | 'auto' | 'full';

export interface AgentRuntimeConfig {
  version: 1;
  model: AgentRuntimeModel;
  reasoning_effort: AgentReasoningEffort;
  approval_mode: AgentApprovalMode;
}

export const DEFAULT_AGENT_RUNTIME_CONFIG: AgentRuntimeConfig = {
  version: 1,
  model: '',
  reasoning_effort: 'medium',
  approval_mode: 'auto',
};

const MODELS = new Set(CODEX_MODEL_OPTIONS.map((option) => option.value));
const EFFORTS = new Set<AgentReasoningEffort>(['low', 'medium', 'high']);
const APPROVALS = new Set<AgentApprovalMode>(['request', 'auto', 'full']);

export function normalizeAgentRuntimeConfig(value: unknown): AgentRuntimeConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AGENT_RUNTIME_CONFIG };
  const candidate = value as Partial<AgentRuntimeConfig>;
  if (
    !MODELS.has(candidate.model as AgentRuntimeModel)
    || !EFFORTS.has(candidate.reasoning_effort as AgentReasoningEffort)
    || !APPROVALS.has(candidate.approval_mode as AgentApprovalMode)
  ) return { ...DEFAULT_AGENT_RUNTIME_CONFIG };
  return {
    version: 1,
    model: candidate.model as AgentRuntimeModel,
    reasoning_effort: candidate.reasoning_effort as AgentReasoningEffort,
    approval_mode: candidate.approval_mode as AgentApprovalMode,
  };
}
