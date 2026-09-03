import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeDiAgentEnvironment, readDiAgentEnvironment } from './brand-environment.mjs';

test('canonical desktop environment wins while retired deployments still launch', () => {
  const env = {
    AGENTHUB_BACKEND_URL: 'http://retired.example', // [brand-compat] 旧桌面安装输入。
    DI_AGENT_BACKEND_URL: 'http://canonical.example',
  };
  assert.equal(readDiAgentEnvironment(env, 'BACKEND_URL'), 'http://canonical.example');
  assert.equal(readDiAgentEnvironment({
    AGENTHUB_BACKEND_URL: 'http://retired.example', // [brand-compat]
  }, 'BACKEND_URL'), 'http://retired.example');
});

test('desktop child processes receive canonical names only', () => {
  const migrated = canonicalizeDiAgentEnvironment({
    PATH: '/bin',
    AGENTHUB_CONFIG: 'retired.yaml', // [brand-compat]
  });
  assert.equal(migrated.DI_AGENT_CONFIG, 'retired.yaml');
  assert.equal(Object.hasOwn(migrated, 'AGENTHUB_CONFIG'), false); // [brand-compat]
});
