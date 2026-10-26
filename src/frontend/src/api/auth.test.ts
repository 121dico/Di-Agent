// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuthProviders, login, loginBoss, safeCompanyLoginUrl } from './auth';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
const providers = { mode: 'hybrid', login_url: 'https://boss.example.test/login', local_login_enabled: true, boss_enabled: true, boss_ready: true };
function respond(data: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data }), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
describe('company auth API', () => {
  it('reads provider metadata without sending old bearer tokens', async () => {
    const fetchMock = respond(providers);
    expect(await getAuthProviders()).toEqual(providers);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/providers', expect.objectContaining({ credentials: 'same-origin', redirect: 'error' }));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });
  it.each(['javascript:alert(1)', 'http://boss.example.test', 'https://user:pass@boss.example.test', 'https://boss.example.test/#x', '//boss.example.test', 'https:\\boss.example.test'])('rejects unsafe company entry %s', (url) => {
    expect(safeCompanyLoginUrl(url)).toBeNull();
  });
  it.each([{ ...providers, mode: 'unknown' }, { ...providers, boss_enabled: false }, { ...providers, login_url: 'javascript:alert(1)' }, {}])('fails closed for invalid providers', async (data) => {
    respond(data);
    await expect(getAuthProviders()).rejects.toThrow();
  });
  it.each([401, 404, 503])('does not clear existing sessions on bootstrap %s', async (status) => {
    localStorage.setItem('keep-session', 'existing');
    respond(null, status);
    await expect(loginBoss()).rejects.toThrow();
    expect(localStorage.getItem('keep-session')).toBe('existing');
  });
  it('rejects malformed successful sessions', async () => {
    respond({ token: '', user: { username: 'fake' } });
    await expect(loginBoss()).rejects.toThrow('会话无效');
  });
  it('keeps wrong local credentials on the login page without expired-session handling', async () => {
    respond(null, 401);
    const before = window.location.href;
    await expect(login('test', 'wrong')).rejects.toThrow('用户名或密码错误');
    expect(window.location.href).toBe(before);
  });
});
