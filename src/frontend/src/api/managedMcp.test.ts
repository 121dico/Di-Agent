// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';
import { configureManagedMcp, createManagedMcpSetupSession, inspectManagedMcp, saveManagedMcpConfiguration } from './managedMcp';
vi.mock('./client', () => ({ getAuthHeaders: () => ({ Authorization: 'Bearer platform-session' }) }));
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('sends only an empty fixed action with platform session, never personal credentials', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, data: { opened: true } }) });
  const controller = new AbortController();
  await configureManagedMcp('computer/a', controller.signal);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith('/api/daemon/machines/computer%2Fa/managed-mcp/configure', expect.objectContaining({
    method: 'POST', body: '{}', cache: 'no-store', headers: { Authorization: 'Bearer platform-session', 'Content-Type': 'application/json' },
  }));
});

it('does not retry a configure operation and maps old-daemon errors to guidance', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 40902, message: 'upgrade_required' }) });
  await expect(configureManagedMcp('a', new AbortController().signal)).rejects.toThrow('连接程序版本较旧');
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('never displays arbitrary proxy errors or credential-shaped raw payloads', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({ code: 502, message: 'Authorization: Bearer private-secret' }) });
  await expect(inspectManagedMcp('a', new AbortController().signal)).rejects.toThrow('请求未完成');
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('bounds the operation and propagates cancellation to the network', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation((_path: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = inspectManagedMcp('a', new AbortController().signal);
  const assertion = expect(pending).rejects.toThrow('检测超时');
  await vi.advanceTimersByTimeAsync(55000);
  await assertion;
  expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
});

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
function setupSession() {
  const pair = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(7));
  return { pair, session: { id: 'test-session', public_key: encode(pair.publicKey), supported: true, reason: '' as const, expires_at: new Date(Date.now() + 300000).toISOString() } };
}
it('requests a fresh local capability session using only an empty action', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: {} }) });
  await createManagedMcpSetupSession('a', new AbortController().signal);
  expect(fetchMock).toHaveBeenCalledWith('/api/daemon/machines/a/managed-mcp/setup-session', expect.objectContaining({ body: '{}' }));
});
it('sends only an encrypted envelope and roundtrips exact owner/machine binding', async () => {
  const { pair, session } = setupSession();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { saved: true } }) });
  const secret = 'test-private-key-not-real-12345';
  await saveManagedMcpConfiguration('a', 'owner', session, `Bearer ${secret}`, ' epower_platform ', new AbortController().signal);
  const body = (fetchMock.mock.calls[0]?.[1] as RequestInit).body as string;
  expect(body).not.toContain(secret); expect(body).not.toContain('epower_platform'); expect(body).not.toContain('owner');
  const envelope = JSON.parse(body) as Record<string, string>;
  expect(Object.keys(envelope).sort()).toEqual(['ciphertext', 'client_public_key', 'nonce', 'session_id']);
  const plaintext = nacl.box.open(decode(envelope.ciphertext!), decode(envelope.nonce!), decode(envelope.client_public_key!), pair.secretKey)!;
  expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual({ session_id: 'test-session', user_id: 'owner', machine_id: 'a', api_key: secret, project_code: 'epower_platform' });
});
it('encrypts an empty key for preserve and uses a different ephemeral key/nonce per call', async () => {
  const { pair, session } = setupSession();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: { saved: true } }) });
  await saveManagedMcpConfiguration('a', 'owner', session, '', 'epower_platform', new AbortController().signal);
  await saveManagedMcpConfiguration('a', 'owner', session, '', 'epower_platform', new AbortController().signal);
  const first = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
  const second = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
  expect(first.nonce).not.toBe(second.nonce); expect(first.client_public_key).not.toBe(second.client_public_key);
  expect(JSON.parse(new TextDecoder().decode(nacl.box.open(decode(first.ciphertext), decode(first.nonce), decode(first.client_public_key), pair.secretKey)!)).api_key).toBe('');
});
it('fails closed for expired sessions, invalid project and missing secure random', () => {
  const { session } = setupSession();
  expect(() => saveManagedMcpConfiguration('a', 'owner', { ...session, expires_at: '2020-01-01' }, '', 'epower_platform', new AbortController().signal)).toThrow('已过期');
  expect(() => saveManagedMcpConfiguration('a', 'owner', session, '', '839', new AbortController().signal)).toThrow('projectId');
  expect(fetchMock).not.toHaveBeenCalled();
  vi.stubGlobal('crypto', undefined);
  expect(() => saveManagedMcpConfiguration('a', 'owner', session, '', 'epower_platform', new AbortController().signal)).toThrow('安全随机数');
  expect(fetchMock).not.toHaveBeenCalled();
});
