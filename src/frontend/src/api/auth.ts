import type { AuthProviders, AuthResponse, LoginRequest, RegisterRequest } from '@/types/auth';

// 登录配置与网关验证失败属于登录页状态，不是工作区会话过期；
// 这里不能调用通用客户端的全局 401 跳转。
async function authBootstrap(path: string, method = 'GET', body?: LoginRequest | RegisterRequest, failureMessage?: string): Promise<unknown> {
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(failureMessage ?? (response.status === 404 ? '公司登录暂未接通' : '公司登录验证失败，请重新登录或联系管理员'));
  const envelope: unknown = await response.json();
  if (!isRecord(envelope) || envelope.code !== 0) throw new Error('登录服务返回异常，请稍后重试');
  return envelope.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function safeCompanyLoginUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash || /[\s\\]/.test(value)) return null;
    return url.href;
  } catch { return null; }
}

export async function getAuthProviders(): Promise<AuthProviders> {
  const value = await authBootstrap('/api/auth/providers');
  if (!isRecord(value) || !['local', 'hybrid', 'boss'].includes(String(value.mode)) ||
    typeof value.login_url !== 'string' || typeof value.local_login_enabled !== 'boolean' ||
    typeof value.boss_enabled !== 'boolean' || typeof value.boss_ready !== 'boolean') {
    throw new Error('登录配置暂不可用，请重试');
  }
  const providers = value as unknown as AuthProviders;
  const consistent = providers.mode === 'local'
    ? !providers.boss_enabled && providers.local_login_enabled && !providers.boss_ready
    : providers.boss_enabled && providers.local_login_enabled === (providers.mode === 'hybrid');
  if (!consistent || (providers.boss_ready && !safeCompanyLoginUrl(providers.login_url))) throw new Error('登录配置暂不可用，请重试');
  return providers;
}

export async function loginBoss(): Promise<AuthResponse> {
  const value = await authBootstrap('/api/auth/boss/session', 'POST');
  return parseSession(value);
}

function parseSession(value: unknown): AuthResponse {
  if (!isRecord(value) || typeof value.token !== 'string' || !value.token.trim() || !isRecord(value.user) ||
    typeof value.user.id !== 'string' || !value.user.id || typeof value.user.username !== 'string' ||
    typeof value.user.is_admin !== 'boolean' || typeof value.user.created_at !== 'string') {
    throw new Error('登录会话无效，请联系管理员');
  }
  return value as unknown as AuthResponse;
}

export async function login(
  username: string,
  password: string,
): Promise<AuthResponse> {
  const body: LoginRequest = { username, password };
  const data = parseSession(await authBootstrap('/api/auth/login', 'POST', body, '用户名或密码错误，或本地登录暂不可用'));
  return data;
}

export async function register(
  username: string,
  password: string,
): Promise<AuthResponse> {
  const body: RegisterRequest = { username, password };
  const data = parseSession(await authBootstrap('/api/auth/register', 'POST', body, '注册失败，用户名可能已存在或本地注册已关闭'));
  return data;
}
