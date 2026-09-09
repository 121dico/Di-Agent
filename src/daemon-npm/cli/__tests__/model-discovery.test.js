'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configuredModel } = require('../model-discovery');
const { recoverCodexThread } = require('../session-recovery');

test('model discovery selects only model metadata, preserves env precedence and does not guess missing models', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'models-'));
  try {
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude/settings.json'), JSON.stringify({env:{ANTHROPIC_MODEL:'deepseek-v4-pro',ANTHROPIC_API_KEY:'private'}}));
    assert.equal(configuredModel('claude', {}, home), 'deepseek-v4-pro');
    assert.equal(configuredModel('claude', {ANTHROPIC_MODEL:'override'}, home), 'override');
    assert.equal(configuredModel('codex', {}, home), '');
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.codex/config.toml'), 'model = "actual-config"\n[profiles.other]\nmodel="other"');
    assert.equal(configuredModel('codex', {}, home), 'actual-config');
  } finally { fs.rmSync(home, {recursive:true,force:true}); }
});

test('legacy placeholder recovery uses latest real thread for exactly the same agent and conversation', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-'));
  const file = path.join(folder, 'daemon.log');
  const real = '01234567-1234-1234-1234-123456789abc';
  try {
    fs.writeFileSync(file, `stage=agent.codex_thread_ready agent_id=a conversation_id=c thread_id=${real}\nstage=agent.codex_thread_ready agent_id=a conversation_id=other thread_id=99999999-1234-1234-1234-123456789abc\n`);
    assert.equal(recoverCodexThread(file, 'a', 'c'), real);
    assert.equal(recoverCodexThread(file, 'b', 'c'), null);
    assert.equal(recoverCodexThread(file + '.missing', 'a', 'c'), null);
  } finally { fs.rmSync(folder, {recursive:true,force:true}); }
});
