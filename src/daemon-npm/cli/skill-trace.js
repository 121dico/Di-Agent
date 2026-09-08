'use strict';
const path = require('node:path');

// The runtime still receives full tool results locally. Only this transport copy is redacted.
function createToolTrace(skills = [], now = () => new Date()) {
  const calls = new Map();
  let latest = null;
  let sequence = 0;
  const classify = (tool, input) => {
    let args = input;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    args = args || {};
    const mcp = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(tool);
    const meta = { tool_kind: mcp ? 'mcp' : 'tool' };
    if (mcp) meta.server_name = mcp[1];
    let name = /(?:^|__)get_agent_skill$/.test(tool) ? args.name : /^skill$/i.test(tool) ? args.skill || args.name : null;
    let skill = name && skills.find(s => s.name.toLowerCase() === String(name).toLowerCase());
    const file = args.file_path || args.path;
    if (!name && /^(read|read_file|readfile)$/i.test(tool) && typeof file === 'string') {
      skill = skills.find(s => path.resolve(s.source_path) === path.resolve(file));
      if (skill) name = skill.name;
    }
    // Exact, simple cat commands are evidence of a read. A path merely appearing in a command is not.
    if (!name && /^(shell|bash|exec_command)$/i.test(tool)) {
      const cmd = typeof input === 'string' ? input : args.command || args.cmd || '';
      const match = /^\s*cat\s+(?:'([^']+)'|"([^"]+)"|([^\s;&|]+))\s*$/.exec(cmd);
      if (match) {
        const target = match[1] || match[2] || match[3];
        skill = skills.find(s => path.resolve(s.source_path) === path.resolve(target));
        if (skill) name = skill.name;
      }
    }
    if (name || /(?:^|__)get_agent_skill$/.test(tool) || /^skill$/i.test(tool)) {
      meta.tool_kind = 'skill';
      if (name) meta.skill_name = String(name);
      if (skill) meta.source_path = skill.source_path;
    }
    return meta;
  };
  return event => {
    if (!event) return event;
    // 在缓冲批次之前记录观测时间，保留原生时间；仅在完成时上报的适配器不倒推开始时间。
    let timestamp;
    if (typeof event.ts === 'number' && Number.isFinite(event.ts) && Number.isFinite(new Date(event.ts).getTime())) timestamp = new Date(event.ts).toISOString();
    if (typeof event.ts === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(event.ts) && Number.isFinite(Date.parse(event.ts))) timestamp = event.ts;
    const ev = { ...event, ts: timestamp ?? now().toISOString() };
    if (ev.type === 'tool_use' && ev.timing_incomplete) delete ev.ts;
    delete ev.timing_incomplete;
    if (!['tool_use', 'tool_result'].includes(ev.type)) return ev;
    if (ev.type === 'tool_use') {
      const id = ev.toolUseID || (!ev.tool && latest) || `trace-${++sequence}`;
      const previous = calls.get(id);
      const tool = ev.tool || previous?.tool || '';
      let input = ev.input;
      if (previous && !ev.tool && typeof input === 'string') input = (previous.partial || '') + input;
      const meta = classify(tool, input);
      if (meta.tool_kind !== 'skill' && ev.tool_kind) meta.tool_kind = ev.tool_kind;
      if (ev.server_name || previous?.meta.server_name) meta.server_name = ev.server_name || previous.meta.server_name;
      const inputText = typeof input === 'string' ? input : JSON.stringify(input || {});
      const referencesLocalSkill = skills.some(s => inputText.includes(s.source_path));
      calls.set(id, { tool, meta, partial: typeof input === 'string' ? input : '', redact: referencesLocalSkill || previous?.redact });
      latest = id;
      return { ...ev, toolUseID: id, ...meta };
    }
    const id = ev.toolUseID || latest;
    const call = calls.get(id);
    const meta = call?.meta || classify(ev.tool || '', {});
    Object.assign(ev, meta);
    if (id) ev.toolUseID = id;
    if (meta.tool_kind === 'skill') {
      ev.output = { status: ev.isError ? 'failed' : 'loaded', name: meta.skill_name || '', source_path: meta.source_path || '', content_redacted: true };
    } else if (call?.redact) {
      // Compound commands may reference skill files without proving a load. Redact
      // their output conservatively, but leave them classified as ordinary tools.
      ev.output = { status: ev.isError ? 'failed' : 'completed', content_redacted: true };
    }
    if (typeof ev.output !== 'string') ev.output = JSON.stringify(ev.output ?? '');
    return ev;
  };
}
module.exports = { createToolTrace };
