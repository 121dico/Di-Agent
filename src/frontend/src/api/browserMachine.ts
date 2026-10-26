import { getAuthHeaders } from './client';

const localOrigin = 'http://127.0.0.1:28683';
const unavailable = '未能识别本机。请在本机更新并运行连接程序，检查浏览器是否允许本机连接，再重试。';
interface IdentityProof { nonce: string; issued_at: number; proof: string }

function proofFrom(value: unknown, nonce: string): IdentityProof {
  if (!value || typeof value !== 'object') throw new Error(unavailable);
  const data = value as Partial<IdentityProof>;
  const now = Math.floor(Date.now() / 1000);
  if (data.nonce !== nonce || typeof data.proof !== 'string' || !/^[a-f0-9]{64}$/.test(data.proof)
    || !Number.isSafeInteger(data.issued_at) || data.issued_at! < now - 60 || data.issued_at! > now + 5) throw new Error(unavailable);
  return { nonce, issued_at: data.issued_at!, proof: data.proof };
}

async function jsonRequest(url: string, init: RequestInit, signal: AbortSignal, timeout: number): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error(unavailable);
    return await response.json();
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

function popupProof(nonce: string, signal: AbortSignal): Promise<IdentityProof> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error(unavailable)); return; }
    // 仅由点击事件同步打开；保留 opener 用于精确来源验证，不传平台凭据。
    const popup = window.open(`${localOrigin}/identity-window?nonce=${nonce}&origin=${encodeURIComponent(window.location.origin)}`, '_blank', 'popup,width=480,height=300');
    if (!popup) { reject(new Error('验证窗口未打开，请允许本次弹窗后重试。')); return; }
    const clean = () => {
      clearTimeout(timer); clearInterval(closedTimer);
      window.removeEventListener('message', receive); signal.removeEventListener('abort', cancel);
      popup.close();
    };
    const cancel = () => { clean(); reject(new Error(unavailable)); };
    const receive = (event: MessageEvent<unknown>) => {
      if (event.origin !== localOrigin || event.source !== popup || !event.data || typeof event.data !== 'object') return;
      const data = event.data as Partial<IdentityProof> & { type?: string };
      if (data.type !== 'di-agent-browser-identity' || data.nonce !== nonce) return;
      try { const proof = proofFrom(data, nonce); clean(); resolve(proof); }
      catch { cancel(); }
    };
    const timer = setTimeout(cancel, 30000);
    const closedTimer = setInterval(() => { if (popup.closed) cancel(); }, 500);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/** 本机仅提供一次性签名；平台验证其所属用户，任何一步失败都不能标记“外部”。 */
export async function identifyBrowserMachine(mode: 'direct' | 'popup', signal: AbortSignal): Promise<string> {
  try {
    if (!globalThis.crypto?.getRandomValues) throw new Error(unavailable);
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const proof = mode === 'popup' ? await popupProof(nonce, signal) : proofFrom(await jsonRequest(`${localOrigin}/identity`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce }),
    }, signal, 4000), nonce);
    if (signal.aborted) throw new Error(unavailable);
    const response = await jsonRequest('/api/daemon/local-identity/verify', {
      method: 'POST', credentials: 'same-origin', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(proof),
    }, signal, 10000) as { code?: number; data?: { machine_id?: unknown } };
    const id = response?.data?.machine_id;
    if (response?.code !== 0 || typeof id !== 'string' || !id || id.length > 128) throw new Error(unavailable);
    return id;
  } catch (error) {
    if (error instanceof Error && error.message === '验证窗口未打开，请允许本次弹窗后重试。') throw error;
    throw new Error(unavailable);
  }
}
