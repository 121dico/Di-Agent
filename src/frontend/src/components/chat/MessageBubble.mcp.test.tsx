// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { Message } from '@/types/message';
import { MessageBubble } from './MessageBubble';

const base: Message = {
  id: 'mcp-reply', conversation_id: 'conversation', role: 'assistant', content: '',
  artifacts_json: JSON.stringify({ agent_name: 'Codex', cli_tool: 'codex' }),
  created_at: '2026-10-20T08:00:00Z', status: 'complete',
};

it('highlights only actual MCP calls in the reply, without exposing parameters or results', () => {
  const html = renderToStaticMarkup(<MessageBubble message={{ ...base, blocks: [
    { index: 0, kind: 'text', text: '正在检索' },
    { index: 1, kind: 'tool_use', tool_kind: 'mcp', server_name: '内网页面检索', tool_name: 'search_page', tool_use_id: 'mcp-1', text: '{"secret":"do not show"}' },
    { index: 2, kind: 'tool_result', tool_use_id: 'mcp-1', text: 'private result' },
    { index: 3, kind: 'tool_use', tool_kind: 'tool', tool_name: 'shell', text: 'echo hidden' },
    { index: 4, kind: 'tool_use', tool_kind: 'skill', tool_name: 'mcp__skills__load', text: 'skill hidden' },
  ] }} />);
  const element = document.createElement('div');
  element.innerHTML = html;
  const call = element.querySelector('[data-mcp-call="true"]');
  expect(call?.textContent).toContain('MCP');
  expect(call?.textContent).toContain('内网页面检索');
  expect(call?.textContent).toContain('search_page');
  expect(element.querySelectorAll('[data-mcp-call="true"]')).toHaveLength(1);
  expect(element.textContent).not.toContain('do not show');
  expect(element.textContent).not.toContain('private result');
  expect(element.textContent).not.toContain('echo hidden');
});

it('uses a neutral service label when old MCP events lack the server name', () => {
  const html = renderToStaticMarkup(<MessageBubble message={{ ...base, blocks_json: JSON.stringify([
    { index: 0, kind: 'tool_use', tool_kind: 'mcp', tool_name: 'query', text: '{}' },
  ]) }} />);
  expect(html).toContain('MCP 服务');
  expect(html).toContain('query');
});
