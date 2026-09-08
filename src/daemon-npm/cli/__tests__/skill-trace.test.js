const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolTrace } = require('../skill-trace');
test('local skill load keeps native ID and sends metadata instead of body', () => {
  const trace = createToolTrace([{ name: 'review', source_path: '/local/review/SKILL.md' }]);
  const start = trace({ type: 'tool_use', tool: 'mcp__di_agent__get_agent_skill', input: { name: 'review' }, toolUseID: 'a' });
  assert.equal(start.tool_kind, 'skill');
  const end = trace({ type: 'tool_result', tool: '', toolUseID: 'a', output: 'PRIVATE BODY', isError: false });
  assert.equal(end.skill_name, 'review');
  assert.equal(JSON.parse(end.output).status, 'loaded');
  assert.ok(!JSON.stringify(end).includes('PRIVATE BODY'));
});
test('known read is skill evidence; mention in prose or shell echo is not', () => {
  const trace = createToolTrace([{ name: 'review', source_path: '/local/review/SKILL.md' }]);
  assert.equal(trace({ type: 'tool_use', tool: 'Read', input: { file_path: '/local/review/SKILL.md' }, toolUseID: 'r' }).tool_kind, 'skill');
  assert.equal(trace({ type: 'tool_use', tool: 'shell', input: 'echo /local/review/SKILL.md' }).tool_kind, 'tool');
  assert.equal(trace({ type: 'text', content: 'used review' }).tool_kind, undefined);
});
test('MCP service and failed status survive redaction', () => {
  const trace = createToolTrace([]);
  assert.equal(trace({ type: 'tool_use', tool: 'mcp__github__search', toolUseID: 'g' }).server_name, 'github');
  trace({ type: 'tool_use', tool: 'Skill', input: { skill: 'missing' }, toolUseID: 's' });
  assert.equal(JSON.parse(trace({ type: 'tool_result', toolUseID: 's', isError: true, output: 'secret' }).output).status, 'failed');
});
test('streamed parallel tool inputs remain associated with native IDs', () => {
  const trace = createToolTrace([{ name: 'review', source_path: '/local/review/SKILL.md' }]);
  trace({ type: 'tool_use', tool: 'get_agent_skill', tool_kind: 'mcp', server_name: 'di_agent', input: {}, toolUseID: 'skill' });
  trace({ type: 'tool_use', tool: 'mcp__github__search', input: {}, toolUseID: 'other' });
  trace({ type: 'tool_use', tool: '', input: '{"name":"re', toolUseID: 'skill' });
  trace({ type: 'tool_use', tool: '', input: 'view"}', toolUseID: 'skill' });
  const result = trace({ type: 'tool_result', toolUseID: 'skill', output: 'PRIVATE BODY' });
  assert.equal(result.tool_kind, 'skill');
  assert.equal(result.skill_name, 'review');
  assert.equal(JSON.parse(result.output).content_redacted, true);
  assert.equal(trace({ type: 'tool_result', toolUseID: 'other', output: 'PUBLIC RESULT' }).output, 'PUBLIC RESULT');
});
test('compound commands referencing local skill files redact output without claiming a skill load', () => {
  const trace = createToolTrace([{ name: 'review', source_path: '/local/review/SKILL.md' }]);
  assert.equal(trace({ type: 'tool_use', tool: 'shell', input: "sed -n '1,80p' /local/review/SKILL.md; pwd", toolUseID: 'compound' }).tool_kind, 'tool');
  const end = trace({ type: 'tool_result', toolUseID: 'compound', output: 'PRIVATE BODY' });
  assert.equal(end.tool_kind, 'tool');
  assert.equal(JSON.parse(end.output).content_redacted, true);
  assert.equal(JSON.parse(end.output).status, 'completed');
});

test('wire output is always a string accepted by Go AgentEvent.Output', () => {
  const trace = createToolTrace([]);
  trace({ type: 'tool_use', tool: 'mcp_tool', tool_kind: 'mcp', toolUseID: 'native' });
  const result = trace({ type: 'tool_result', toolUseID: 'native', output: { content: [{ type: 'text', text: 'result' }] } });
  assert.equal(typeof JSON.parse(JSON.stringify(result)).output, 'string');
  assert.equal(JSON.parse(result.output).content[0].text, 'result');
});
