import { getAuthHeaders } from './client';
import type { DaemonMachine } from '@/types/agent';
import nacl from 'tweetnacl';

export interface ManagedMcpCheck {
  id: 'daemon' | 'proxy' | 'identity' | 'credential' | 'project';
  status: 'passed' | 'failed' | 'unverified';
  code: string;
}
export interface ManagedMcpInspection {
  status: 'setup_required' | 'configured_unverified' | 'connected' | 'failed';
  checked_at: string;
  configuration_changed: boolean;
  key_configured: boolean;
  project_code: string;
  credential_source: 'environment' | 'keychain' | 'file' | 'missing';
  project_source: 'environment' | 'file' | 'default' | 'missing';
  checks: ManagedMcpCheck[];
  opened: boolean;
  error_code?: string;
  saved?: boolean;
  setup_session?: ManagedMcpSetupSession;
}
export interface ManagedMcpSetupSession {
  id: string;
  public_key: string;
  expires_at: string;
  supported: boolean;
  reason: '' | 'environment_override' | 'unsupported_platform';
}

const errorMessages: Record<string, string> = {
  machine_offline: '这台电脑已离线，请先打开连接程序，再刷新电脑列表。',
  upgrade_required: '这台电脑的连接程序版本较旧，请前往“智能体 → 连接电脑”更新，再检查连接。',
  busy: '这台电脑正在处理另一次检测，请稍后重试。',
  timeout: '检测超时，请确认电脑在线和公司网络正常后重试。',
  invalid_result: '连接程序返回了无法验证的结果，请升级后重试。',
  machine_not_found: '电脑不存在，或不属于当前登录用户，请刷新电脑列表。',
  setup_unavailable: '配置服务暂不可用，请稍后重试。',
  session_expired: '安全配置会话已过期，请重新准备配置并填写。',
  invalid_envelope: '安全配置会话不可用，请重新准备配置。',
  invalid_configuration: '请填写有效的 API Key 和项目 Code（不是数字 projectId）。',
  environment_override: '当前配置由环境变量覆盖，请在连接程序启动环境修改后重启。',
  unsupported_platform: '此电脑暂不支持页面保存，请在连接程序启动环境配置。',
  save_failed: '未能保存到所选电脑，请重新准备配置后重试。',
};
export class ManagedMcpError extends Error {
  constructor(public code: string) { super(errorMessages[code] ?? '请求未完成，请刷新电脑列表后重试。'); }
}
export function managedMcpErrorMessage(code?: string): string { return errorMessages[code ?? ''] ?? '配置未完成，请重新准备配置后重试。'; }

/** 此通路只传诊断和加密信封；一次性保存不可自动重试。 */
async function request<T>(path: string, signal: AbortSignal, method: 'GET' | 'POST', timeout = 55000, body = '{}'): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(path, {
      method, signal: controller.signal, cache: 'no-store',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body } : {}),
    });
    const result = await response.json() as { code?: number; message?: string; data: T };
    if (!response.ok || result.code !== 0) {
      if (response.status === 401) throw new Error('登录已过期，请重新登录 Di Agent。');
      throw new ManagedMcpError(result.message ?? '');
    }
    return result.data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal.aborted ? '请求已取消' : errorMessages.timeout);
    if (error instanceof ManagedMcpError) throw error;
    // 不把代理或认证服务的原始响应展示到平台。
    if (error instanceof Error && Object.values(errorMessages).includes(error.message)) throw error;
    if (error instanceof Error && ['登录已过期，请重新登录 Di Agent。', '请求未完成，请刷新电脑列表后重试。'].includes(error.message)) throw error;
    throw new Error('网络连接失败，请检查网络后重试。');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export async function listManagedMcpMachines(signal: AbortSignal): Promise<DaemonMachine[]> {
  return (await request<DaemonMachine[] | null>('/api/daemon/machines', signal, 'GET', 15000)) ?? [];
}
export function inspectManagedMcp(machineId: string, signal: AbortSignal): Promise<ManagedMcpInspection> {
  return request(`/api/daemon/machines/${encodeURIComponent(machineId)}/managed-mcp/inspect`, signal, 'POST');
}
export function configureManagedMcp(machineId: string, signal: AbortSignal): Promise<ManagedMcpInspection> {
  return request(`/api/daemon/machines/${encodeURIComponent(machineId)}/managed-mcp/configure`, signal, 'POST');
}
export function createManagedMcpSetupSession(machineId: string, signal: AbortSignal): Promise<ManagedMcpInspection> {
  return request(`/api/daemon/machines/${encodeURIComponent(machineId)}/managed-mcp/setup-session`, signal, 'POST');
}

function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function decode(value: string): Uint8Array { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }

/** 仅密文进入平台请求；随机数必须由浏览器安全随机源生成，HTTP 不等于可信页面。 */
export function saveManagedMcpConfiguration(machineId: string, userId: string, session: ManagedMcpSetupSession, apiKey: string, projectCode: string, signal: AbortSignal): Promise<ManagedMcpInspection> {
  if (!session.supported || !session.id || Date.parse(session.expires_at) <= Date.now() || !Number.isFinite(Date.parse(session.expires_at))) throw new ManagedMcpError('session_expired');
  if (!globalThis.crypto?.getRandomValues) throw new Error('浏览器缺少安全随机数支持，不能提交凭据。');
  const key = apiKey.trim().replace(/^Bearer\s+/i, '');
  const project = projectCode.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(project) || /^\d+$/.test(project) || (key !== '' && (key.length < 16 || key.length > 4096 || !/^[A-Za-z0-9._~+/=-]+$/.test(key)))) throw new ManagedMcpError('invalid_configuration');
  let publicKey: Uint8Array;
  try { publicKey = decode(session.public_key); } catch { throw new ManagedMcpError('invalid_envelope'); }
  if (publicKey.length !== nacl.box.publicKeyLength) throw new ManagedMcpError('invalid_envelope');
  const secret = crypto.getRandomValues(new Uint8Array(nacl.box.secretKeyLength));
  const pair = nacl.box.keyPair.fromSecretKey(secret);
  const nonce = crypto.getRandomValues(new Uint8Array(nacl.box.nonceLength));
  const payload = new Uint8Array(new TextEncoder().encode(JSON.stringify({ session_id: session.id, user_id: userId, machine_id: machineId, api_key: key, project_code: project })));
  try {
    const ciphertext = nacl.box(payload, nonce, publicKey, pair.secretKey);
    if (ciphertext.length > 12 * 1024) throw new ManagedMcpError('invalid_configuration');
    const body = JSON.stringify({ session_id: session.id, client_public_key: encode(pair.publicKey), nonce: encode(nonce), ciphertext: encode(ciphertext) });
    return request(`/api/daemon/machines/${encodeURIComponent(machineId)}/managed-mcp/save`, signal, 'POST', 55000, body);
  } finally { secret.fill(0); pair.secretKey.fill(0); payload.fill(0); }
}
