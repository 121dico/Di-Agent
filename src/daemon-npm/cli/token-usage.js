'use strict';

// 统一输入包含缓存；缓存与 reasoning 是细分项，不可再次加到总量。
const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : undefined;
const positive = (n) => count(n) > 0 ? n : undefined;
const stamp = (usage) => ({ ...usage, observed_at: new Date().toISOString() });
const usageEvent = (usage) => usage ? { type: 'usage', usage } : null;

function contextEvents() {
 const events=[];
 return {
  events,
  record(status,id) {
   let e=id ? events.find(x=>x.id===id) : events[events.length-1];
   if (status==='running' && (!e || e.status==='complete')) {
    e={id:id || `compact-${events.length+1}`,kind:'compaction',status,started_at:new Date().toISOString()};events.push(e);
   } else if (status==='complete') {
    if (!e) { e={id:id || 'compact-1',kind:'compaction'};events.push(e); }
    e.status=status;e.ended_at=new Date().toISOString();
   }
   return events.map(x=>({...x}));
  },
 };
}

function createCodexUsageMeter({ resumed = false } = {}) {
  let total = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0 };
  let baseline = { ...total };
  let totalKnown = !resumed;
  let baselineKnown = totalKnown;
  let snapshot;
  let contexts=contextEvents();
  return {
    beginTurn() { baseline = { ...total }; baselineKnown = totalKnown; snapshot = undefined; contexts=contextEvents(); },
    observe(wire) {
      const next = wire?.total;
      if (count(next?.inputTokens) === undefined || count(next?.outputTokens) === undefined) return null;
      const validDelta = baselineKnown && next.inputTokens >= baseline.inputTokens && next.outputTokens >= baseline.outputTokens;
      const usage = {
        provider: 'codex', source: 'actual', model: wire.model, context_events: contexts.events.map(x=>({...x})), complete: false,
        input_tokens: validDelta ? next.inputTokens - baseline.inputTokens : undefined,
        output_tokens: validDelta ? next.outputTokens - baseline.outputTokens : undefined,
        context_tokens: count(wire.last?.inputTokens),
        context_window_tokens: positive(wire.modelContextWindow),
      };
      for (const [native, unified] of [['cachedInputTokens', 'cache_read_tokens'], ['reasoningOutputTokens', 'reasoning_tokens']]) {
        if (validDelta && count(next[native]) !== undefined && count(baseline[native]) !== undefined && next[native] >= baseline[native]) usage[unified] = next[native] - baseline[native];
      }
      total = { ...next };
      totalKnown = true;
      snapshot = stamp(usage);
      return snapshot;
    },
    compact(status='complete',id) {
      const events=contexts.record(status,id);
      snapshot=stamp({...snapshot,provider:'codex',source:'actual',complete:false,context_tokens:undefined,context_events:events});return snapshot;
    },
    finish(success = true, model) { return snapshot ? stamp({ ...snapshot, model: model || snapshot.model, complete: success && snapshot.input_tokens !== undefined && snapshot.output_tokens !== undefined }) : null; },
  };
}


function claudeInput(u) {
  if (!u) return undefined;
  const buckets = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens];
  return buckets.every((n) => count(n) !== undefined) ? count(buckets.reduce((a, b) => a + b, 0)) : undefined;
}

function createClaudeUsageMeter() {
  let contextTokens;
  let model;
  let currentId;
  const requests = new Map();
  const contexts=contextEvents();
  const partial = () => {
    const samples = [...requests.values()];
    const sum = (field) => samples.length && samples.every((u) => count(u[field]) !== undefined)
      ? count(samples.reduce((n, u) => n + u[field], 0)) : undefined;
    return stamp({ provider: 'claude', source: 'actual', model, context_events:contexts.events.map(x=>({...x})), complete: false,
      input_tokens: sum('input'), output_tokens: sum('output'), cache_read_tokens: sum('cache_read_input_tokens'),
      cache_write_tokens: sum('cache_creation_input_tokens'), context_tokens: contextTokens });
  };
  return {
    observe(event) {
      // 子代理不是主循环上下文，不能覆盖主会话窗口快照。
      if (event.parent_tool_use_id) return null;
      if (event.type==='system' && event.subtype==='status' && event.status==='compacting') {contexts.record('running');return partial();}
      if (event.type === 'system' && event.subtype === 'compact_boundary') {
        contexts.record('complete');
        contextTokens = undefined;
        return partial();
      }
      const message = event.type === 'assistant' ? event.message
        : event.type === 'stream_event' && event.event?.type === 'message_start' ? event.event.message : null;
      if (message) {
        contextTokens = claudeInput(message.usage);
        model = message.model || model;
        if (message.id) {
          currentId = message.id;
          const previous = requests.get(currentId);
          // assistant.output_tokens 可能是初始占位值，不覆盖 message_delta 的最终累计值。
          requests.set(currentId, { ...message.usage, input: contextTokens, output: previous?.output });
        }
        return partial();
      }
      if (event.type === 'stream_event' && event.event?.type === 'message_delta' && currentId) {
        const previous = requests.get(currentId) || {};
        const merged = { ...previous, ...event.event.usage };
        merged.input = claudeInput(merged);
        merged.output = count(event.event.usage?.output_tokens) ?? previous.output;
        requests.set(currentId, merged);
        contextTokens = merged.input;
        return partial();
      }
      if (event.type !== 'result') return null;
      const u = event.usage;
      if (!u) return partial();
      const input = claudeInput(u);
      const output = count(u.output_tokens);
      return stamp({
        provider: 'claude', source: 'actual', model, context_events:contexts.events.map(x=>({...x})),
        input_tokens: input, output_tokens: output,
        cache_read_tokens: count(u.cache_read_input_tokens),
        cache_write_tokens: count(u.cache_creation_input_tokens),
        context_tokens: contextTokens,
        context_window_tokens: positive(event.modelUsage?.[model]?.contextWindow),
        complete: !event.is_error && input !== undefined && output !== undefined,
      });
    },
  };
}

function codexExecUsage(u) {
  if (!u) return null;
  const input = count(u.input_tokens);
  const output = count(u.output_tokens);
  return stamp({ provider: 'codex', source: 'actual', input_tokens: input, output_tokens: output,
    cache_read_tokens: count(u.cached_input_tokens), complete: input !== undefined && output !== undefined });
}

module.exports = { createCodexUsageMeter, createClaudeUsageMeter, codexExecUsage, usageEvent };
