import { ApiError, del, get, getAuthHeaders, post, put } from './client';
import type {
  Agent,
  AgentCandidate,
  AgentRequest,
  AgentToolsConfigRequest,
  AddCandidateAgentRequest,
  CreateDaemonMachineRequest,
  CreateDaemonMachineResponse,
  DaemonMachine,
  AgentRuntimeOverview,
  InstallGitHubSkillRequest,
  InstalledGitHubSkill,
  OpenSkillLocationRequest,
} from '@/types/agent';

export async function getAgents(): Promise<Agent[]> {
  const agents = await get<Agent[] | null>('/api/agents');
  return agents ?? [];
}

export async function getAgentRuntimeOverview(id: string, days = 7): Promise<AgentRuntimeOverview> {
  return get<AgentRuntimeOverview>(`/api/agents/${id}/runtime-overview?days=${days}`);
}

export async function createAgent(body: AgentRequest): Promise<Agent> {
  return post<Agent>('/api/agents', body);
}

export async function updateAgent(id: string, body: AgentRequest): Promise<Agent> {
  return put<Agent>(`/api/agents/${id}`, body);
}

export async function updateAgentToolsConfig(id: string, body: AgentToolsConfigRequest): Promise<Agent> {
  return put<Agent>(`/api/agents/${id}/tools-config`, body);
}

export async function updateAgentAvatar(id: string, avatar: string): Promise<Agent> {
  return put<Agent>(`/api/agents/${id}/avatar`, { avatar });
}

export async function deleteAgent(id: string): Promise<void> {
  return del<void>(`/api/agents/${id}`);
}

export async function getDaemonMachines(): Promise<DaemonMachine[]> {
  const machines = await get<DaemonMachine[] | null>('/api/daemon/machines');
  return machines ?? [];
}

export async function createDaemonMachine(
  body: CreateDaemonMachineRequest,
): Promise<CreateDaemonMachineResponse> {
  const created = await post<Omit<CreateDaemonMachineResponse, 'command' | 'install_command'>>('/api/daemon/machines', body);
  const connect = await getMachineConnectCommand(created.machine.id);
  return {
    ...created,
    command: connect.command,
    install_command: connect.install_command,
    api_key: connect.api_key,
    daemon_npm_path: connect.daemon_npm_path,
  };
}

export async function deleteDaemonMachine(id: string): Promise<void> {
  return del<void>(`/api/daemon/machines/${id}`);
}

export async function getAgentCandidates(): Promise<AgentCandidate[]> {
  const candidates = await get<AgentCandidate[] | null>('/api/daemon/agent-candidates');
  return candidates ?? [];
}

export async function addAgentCandidate(
  id: string,
  body: AddCandidateAgentRequest,
): Promise<Agent> {
  return post<Agent>(`/api/daemon/agent-candidates/${id}/add`, body);
}

export interface MachineConnectResponse {
  command: string;
  install_command: string;
  api_key: string;
  daemon_npm_path: string;
  machine: DaemonMachine;
}

export async function getMachineConnectCommand(id: string): Promise<MachineConnectResponse> {
  return get<MachineConnectResponse>(`/api/daemon/machines/${id}/connect`);
}

/**
 * 下载一键安装启动器（.command / .bat，内嵌本机 API Key）。
 * 每次下载后端会重新生成 Key，旧启动器自然失效。
 */
export async function downloadMachineLauncher(id: string, os: 'mac' | 'win'): Promise<void> {
  const res = await fetch(`/api/daemon/machines/${id}/launcher?os=${os}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    throw new ApiError(res.status, 0, `下载启动器失败 (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? (os === 'mac' ? 'AgentHub-Setup.command' : 'AgentHub-Setup.bat');
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function openSkillLocation(
  id: string,
  body: OpenSkillLocationRequest,
): Promise<void> {
  return post<void>(`/api/agents/${id}/skills/open-location`, body);
}

export async function installGitHubSkill(
  id: string,
  body: InstallGitHubSkillRequest,
): Promise<InstalledGitHubSkill> {
  return post<InstalledGitHubSkill>(`/api/agents/${id}/skills/install`, body);
}

export async function startAgent(id: string): Promise<void> {
  return post<void>(`/api/agents/${id}/start`);
}

export async function stopAgent(id: string): Promise<void> {
  return post<void>(`/api/agents/${id}/stop`);
}

export async function restartAgent(id: string): Promise<void> {
  return post<void>(`/api/agents/${id}/restart`);
}

export async function updateAgentTags(id: string, tags: string): Promise<Agent> {
  return put<Agent>(`/api/agents/${id}/tags`, { tags });
}

export async function updateCustomSkills(id: string, customSkills: string): Promise<Agent> {
  return put<Agent>(`/api/agents/${id}/custom-skills`, { custom_skills: customSkills });
}
