export type AgentType = 'system' | 'custom';
export type AgentStatus = 'online' | 'offline' | 'busy' | 'error' | 'stopped';

export interface Agent {
  id: string;
  user_id?: string;
  name: string;
  type: AgentType;
  cli_tool: string;
  system_prompt?: string;
  tools_config?: string;
  avatar?: string;
  capabilities_json?: string;
  custom_skills?: string;
  tags?: string;
  source: string;
  status: AgentStatus;
  version?: string;
  machine_id?: string;
  machine_name?: string;
  enable_management_tools?: boolean;
  last_seen_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PlatformSkill {
  id: string;
  user_id: string;
  name: string;
  category?: string;
  description?: string;
  trigger?: string;
  detail?: string;
  created_at: string;
  updated_at: string;
}

export interface PlatformSkillRequest {
  name: string;
  category?: string;
  description?: string;
  trigger?: string;
  detail?: string;
}

export interface AgentPromptTemplate {
  id: string;
  user_id: string;
  name: string;
  category?: string;
  description?: string;
  system_prompt?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentPromptTemplateRequest {
  name: string;
  category?: string;
  description?: string;
  system_prompt?: string;
}

export interface AgentRequest {
  name: string;
  cli_tool: string;
  system_prompt?: string;
  tools_config?: string;
  avatar?: string;
  capabilities_json?: string;
  custom_skills?: string;
  enable_management_tools?: boolean;
}

export interface AgentToolsConfigRequest {
  tools_config: string;
  enable_management_tools?: boolean;
}

export interface DaemonMachine {
  id: string;
  user_id: string;
  name: string;
  machine_id: string;
  status: 'pending' | 'connected' | 'offline';
  /** 服务端计算：daemon 上报主机名与服务器主机名一致 = 与服务端同机 */
  is_local?: boolean;
  last_seen_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentCandidate {
  id: string;
  machine_id: string;
  machine_name: string;
  name: string;
  cli_tool: string;
  /** 底座类型：cli = 终端命令行（可自动执行）| desktop = 桌面端应用（暂不支持自动执行） */
  variant?: 'cli' | 'desktop';
  version?: string;
  capabilities_json?: string;
  last_seen_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateDaemonMachineRequest {
  name: string;
}

export interface CreateDaemonMachineResponse {
  machine: DaemonMachine;
  command: string;
  install_command: string;
  api_key: string;
  daemon_source_path: string;
  daemon_npm_path: string;
}

export interface AddCandidateAgentRequest {
  name: string;
  cli_tool: string;
  system_prompt?: string;
  tools_config?: string;
  custom_skills?: string;
  enable_management_tools?: boolean;
}

export interface OpenSkillLocationRequest {
  source_path: string;
}

export interface InstallGitHubSkillRequest {
  source_url: string;
  ref?: string;
  subpath?: string;
}

export interface InstalledGitHubSkill {
  name: string;
  installed_path: string;
}

export interface AgentRuntimeRecentRun {
  id: string;
  conversation_id: string;
  prompt: string;
  requester_name: string;
  status: string;
  created_at: string;
}

export interface AgentRuntimeOverview {
  period_days: number;
  conversation_count: number;
  execution_count: number;
  tool_call_count: number;
  total_tokens: number;
  recent_runs: AgentRuntimeRecentRun[];
}
