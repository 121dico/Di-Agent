'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCodexUsageMeter, createClaudeUsageMeter, codexExecUsage } = require('../token-usage');

test('Codex replaces repeated total snapshots, keeps latest context separate from turn consumption', () => {
  const meter = createCodexUsageMeter();
  meter.beginTurn();
  const first = { total: { inputTokens: 10000, outputTokens: 1000, cachedInputTokens: 8000 }, last: { inputTokens: 10000, outputTokens: 1000 }, modelContextWindow: 272000 };
  assert.equal(meter.observe(first).input_tokens, 10000);
  assert.equal(meter.observe(first).input_tokens, 10000);
  meter.beginTurn();
  const next = meter.observe({ total: { inputTokens: 22000, outputTokens: 2000, cachedInputTokens: 18000 }, last: { inputTokens: 12000, outputTokens: 1000 }, modelContextWindow: 272000 });
  assert.equal(next.input_tokens, 12000);
  assert.equal(next.cache_read_tokens, 10000);
  assert.equal(next.context_tokens, 12000);
  assert.equal(next.context_window_tokens, 272000);
});

test('Claude counts disjoint cache inputs once, context is latest request, result is turn aggregate', () => {
  const meter = createClaudeUsageMeter();
  meter.observe({ type: 'assistant', message: { model: 'claude-test', usage: { input_tokens: 200, cache_creation_input_tokens: 100, cache_read_input_tokens: 800, output_tokens: 1 } } });
  const usage = meter.observe({ type: 'result', usage: { input_tokens: 400, cache_creation_input_tokens: 200, cache_read_input_tokens: 1800, output_tokens: 300 }, modelUsage: { 'claude-test': { contextWindow: 1000000 } } });
  assert.equal(usage.input_tokens, 2400);
  assert.equal(usage.output_tokens, 300);
  assert.equal(usage.context_tokens, 1100);
  assert.equal(usage.context_window_tokens, 1000000);
  assert.equal(usage.complete, true);
});

test('compaction invalidates context, missing capacity or cache counts remain unknown', () => {
  const meter = createClaudeUsageMeter();
  meter.observe({ type: 'assistant', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  meter.observe({ type: 'system', subtype: 'compact_boundary' });
  const usage = meter.observe({ type: 'result', usage: { input_tokens: 20, output_tokens: 2 } });
  assert.equal(usage.context_tokens, undefined);
  assert.equal(usage.context_window_tokens, undefined);
  assert.equal(usage.input_tokens, undefined);
  assert.equal(usage.complete, false);
});

test('Codex exec reports turn usage, not latest context, and does not invent capacity', () => {
  const usage = codexExecUsage({ input_tokens: 10000, cached_input_tokens: 8000, output_tokens: 1000 });
  assert.equal(usage.input_tokens, 10000);
  assert.equal(usage.context_tokens, undefined);
  assert.equal(usage.context_window_tokens, undefined);
  assert.equal(usage.cache_read_tokens, 8000);
  assert.equal(usage.complete, true);
});

test('Claude preserves measured input and final streaming output on interruption, and invalidates context on compaction', () => {
  const meter = createClaudeUsageMeter();
  const start = { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1', model: 'm', usage: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 800, output_tokens: 1 } } } };
  assert.equal(meter.observe(start).input_tokens, 1000);
  assert.equal(meter.observe(start).input_tokens, 1000);
  const delta = meter.observe({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 15 } } });
  assert.equal(delta.output_tokens, 15);
  assert.equal(delta.complete, false);
  meter.observe({ type: 'assistant', message: { id: 'm1', model: 'm', usage: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 800, output_tokens: 1 } } });
  const compact = meter.observe({ type: 'system', subtype: 'compact_boundary' });
  assert.equal(compact.context_tokens, undefined);
  assert.equal(compact.input_tokens, 1000);
  assert.equal(compact.output_tokens, 15);
});

test('native compaction remains auditable after the next usage snapshot',()=>{
 const m=createClaudeUsageMeter();
 const start=m.observe({type:'system',subtype:'status',status:'compacting'});
 assert.equal(start.context_events[0].status,'running');
 m.observe({type:'system',subtype:'compact_boundary'});
 m.observe({type:'assistant',message:{model:'m',usage:{input_tokens:5,cache_creation_input_tokens:0,cache_read_input_tokens:0}}});
 const u=m.observe({type:'result',usage:{input_tokens:5,cache_creation_input_tokens:0,cache_read_input_tokens:0,output_tokens:2}});
 assert.equal(u.context_events[0].status,'complete');
 assert.ok(u.context_events[0].ended_at);
 assert.equal(u.context_tokens,5);
});

test('resumed Codex history is not billed again and final model comes from post-turn confirmation', () => {
 const meter=createCodexUsageMeter({resumed:true});
 meter.beginTurn();
 meter.observe({total:{inputTokens:1000,outputTokens:30},last:{inputTokens:400}});
 meter.observe({total:{inputTokens:1500,outputTokens:40},last:{inputTokens:500}});
 const first=meter.finish(true,'confirmed-model');
 assert.equal(first.input_tokens,undefined);
 assert.equal(first.model,'confirmed-model');
 assert.equal(first.context_tokens,500);
 meter.beginTurn();
 meter.observe({total:{inputTokens:2100,outputTokens:50},last:{inputTokens:600}});
 assert.equal(meter.finish().input_tokens,600);
});
