import { get } from './client';
import type { AgentReasoningEffort } from '@/types/agentRuntime';

export interface RuntimeModelOption {
  id: string;
  label: string;
  resolved_model?: string;
  is_default: boolean;
  reasoning_efforts: AgentReasoningEffort[];
  default_reasoning_effort?: AgentReasoningEffort;
  supports_priority: boolean;
}
export interface RuntimeModelCatalog {
  models: RuntimeModelOption[];
  default_model: string;
  source: 'runtime' | 'unsupported';
  scanned_at?: string;
  warning?: string;
}
export async function getAgentModels(agentId: string): Promise<RuntimeModelCatalog> {
  const data = await get<RuntimeModelCatalog>(`/api/agents/${encodeURIComponent(agentId)}/models`);
  if (!data || !Array.isArray(data.models)) throw new Error('运行器未返回模型目录，请重新扫描');
  return data;
}
