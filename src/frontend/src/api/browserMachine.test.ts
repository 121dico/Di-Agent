// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { identifyBrowserMachine } from './browserMachine';
import { setToken } from './client';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
it('verifies a fresh loopback proof without forwarding the platform token or cookies', async () => {
  setToken('platform-test-token');
  const fetcher = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { nonce: string };
    return url.startsWith('http:')
      ? new Response(JSON.stringify({ nonce: body.nonce, issued_at: Math.floor(Date.now() / 1000), proof: 'a'.repeat(64) }))
      : new Response(JSON.stringify({ code: 0, data: { machine_id: 'owned-machine' } }));
  });
  vi.stubGlobal('fetch', fetcher);
  expect(await identifyBrowserMachine('direct', new AbortController().signal)).toBe('owned-machine');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' } });
  expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  expect(fetcher.mock.calls[1]?.[1]?.headers).toHaveProperty('Authorization', 'Bearer platform-test-token');
});

it('rejects mismatched and stale loopback proofs before contacting the platform', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ nonce: 'b'.repeat(64), issued_at: 1, proof: 'a'.repeat(64) })));
  vi.stubGlobal('fetch', fetcher);
  await expect(identifyBrowserMachine('direct', new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('accepts a popup proof only from the exact loopback origin, opened window and fresh nonce', async () => {
  const popup = { closed: false, close: vi.fn() } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { machine_id: 'owned-machine' } })));
  vi.stubGlobal('fetch', fetcher);
  const result = identifyBrowserMachine('popup', new AbortController().signal);
  const url = new URL(String(open.mock.calls[0]?.[0]));
  const nonce = url.searchParams.get('nonce');
  expect(url.searchParams.get('origin')).toBe(window.location.origin);
  const data = { type: 'di-agent-browser-identity', nonce, issued_at: Math.floor(Date.now() / 1000), proof: 'a'.repeat(64) };
  const send = (origin: string, source: Window, payload = data) => window.dispatchEvent(new MessageEvent('message', { origin, source, data: payload }));
  send('https://untrusted.example', popup);
  send('http://127.0.0.1:28683', window);
  send('http://127.0.0.1:28683', popup, { ...data, nonce: 'b'.repeat(64) });
  expect(fetcher).not.toHaveBeenCalled();
  send('http://127.0.0.1:28683', popup);
  expect(await result).toBe('owned-machine');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(popup.close).toHaveBeenCalled();
});

it('reports blocked popups and closes a stalled popup after the bounded deadline', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  await expect(identifyBrowserMachine('popup', new AbortController().signal)).rejects.toThrow('验证窗口未打开');
  vi.useFakeTimers();
  const popup = { closed: false, close: vi.fn() } as unknown as Window;
  vi.mocked(window.open).mockReturnValue(popup);
  const result = identifyBrowserMachine('popup', new AbortController().signal);
  const rejected = expect(result).rejects.toThrow('未能识别本机');
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  expect(popup.close).toHaveBeenCalled();
});

it.each([-61, 6])('rejects a timestamp outside the proof freshness window (%s seconds)', async (offset) => {
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({
    nonce: (JSON.parse(String(init.body)) as { nonce: string }).nonce,
    issued_at: Math.floor(Date.now() / 1000) + offset, proof: 'a'.repeat(64),
  })));
  vi.stubGlobal('fetch', fetcher);
  await expect(identifyBrowserMachine('direct', new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
