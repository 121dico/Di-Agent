import { describe, expect, it } from 'vitest';
import type { Message } from '@/types/message';
import { htmlFilePath, resolveHtmlFileTarget } from './htmlFileReference';

function msg(agent: string, dir = '/tmp/task', file = 'index.html', conversation = 'chat'): Message {
  return {
    id: agent, role: 'assistant', conversation_id: conversation, created_at: '', content: '',
    artifacts_json: JSON.stringify({ agent_id: agent }),
    cards_json: JSON.stringify([{ type: 'diff', workDir: dir, files: [file] }]),
  };
}
describe('HTML reference resolution', () => {
  it('does not turn an extension or an unrelated comparison filename into a file link', () => {
    expect(htmlFilePath('.html')).toBeUndefined();
    expect(htmlFilePath('/tmp/.htm')).toBeUndefined();
    expect(resolveHtmlFileTarget('other.html', msg('claude'))).toBeUndefined();
  });
  it.each(['https://x.test/a.html', '//x.test/a.html', 'javascript:a.html', 'data:text/html,a.html',
    '/api/uploads/a.html', '/assets/a.html', '../a.html', '/tmp/%2e%2e/a.html', 'file://other/tmp/a.html', '/tmp/a%00.html'])('rejects non-local/unsafe reference %s', value => {
    expect(htmlFilePath(value)).toBeUndefined();
  });
  it.each([['file:///tmp/a%20b.HTML', '/tmp/a b.HTML'], ['C:\\work\\a.htm', 'C:/work/a.htm'], ['./a.html', 'a.html']])('normalizes %s', (value, expected) => {
    expect(htmlFilePath(value)).toBe(expected);
  });
  it('routes relative file names only within the current message workspace', () => {
    expect(resolveHtmlFileTarget('index.html', msg('claude'))).toEqual({ agentId: 'claude', workDir: '/tmp/task', path: '/tmp/task/index.html' });
  });
  it('does not pick one of two different agent machines with identical paths', () => {
    expect(resolveHtmlFileTarget('/tmp/task/index.html', msg('summary', '/tmp/other'), [msg('a'), msg('b')])).toBeUndefined();
  });
  it('ignores other conversations and same filenames at different paths', () => {
    expect(resolveHtmlFileTarget('/tmp/new/index.html', msg('current'), [msg('other', '/tmp/new', 'index.html', 'elsewhere')])?.agentId).toBe('current');
  });
  it('requires assistant identity and does not guess from human text', () => {
    expect(resolveHtmlFileTarget('/tmp/a.html', { ...msg('a'), role: 'user' })).toBeUndefined();
    expect(resolveHtmlFileTarget('/tmp/a.html', { ...msg('a'), artifacts_json: null })).toBeUndefined();
  });
  it('finds persistent and streaming card blocks without cards_json', () => {
    const source = { ...msg('claude'), cards_json: undefined, blocks_json: JSON.stringify([
      { kind: 'card', card: { type: 'diff', workDir: '/tmp/task', files: ['index.html'] } },
    ]) };
    expect(resolveHtmlFileTarget('/tmp/task/index.html', msg('summary', '/else'), [source])?.agentId).toBe('claude');
  });
});
