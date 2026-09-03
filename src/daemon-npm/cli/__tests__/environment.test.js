'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readDiAgentEnvironment } = require('../environment');

test('canonical daemon environment wins while retired installations remain readable', () => {
  assert.equal(readDiAgentEnvironment({
    AGENTHUB_DAEMON_TOKEN: 'retired', // [brand-compat]
    DI_AGENT_DAEMON_TOKEN: 'canonical',
  }, 'DAEMON_TOKEN'), 'canonical');
  assert.equal(readDiAgentEnvironment({
    AGENTHUB_DAEMON_TOKEN: 'retired', // [brand-compat]
  }, 'DAEMON_TOKEN'), 'retired');
});
