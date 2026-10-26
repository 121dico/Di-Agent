const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const { writeDatadreamKeychainCredential, loadDatadreamCredential, saveDatadreamCredential } = require('../cli/managed-mcp-credentials');

test('personal Keychain write verifies readback and never puts API Key in process arguments', async (t) => {
  const key = 'test-personal-key-never-real';
  let written = '';
  let readback = key;
  let readError = false;
  t.mock.method(childProcess, 'spawn', (binary, argv, options) => {
    assert.equal(binary, '/usr/bin/security');
    assert.deepEqual(argv, ['-i']);
    assert.doesNotMatch(JSON.stringify({ argv, options }), /test-personal-key/);
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = (input) => { written = input; process.nextTick(() => child.emit('exit', 0)); };
    return child;
  });
  t.mock.method(childProcess, 'execFileSync', (binary, argv) => {
    assert.equal(binary, '/usr/bin/security');
    assert.deepEqual(argv, ['find-generic-password', '-a', 'fixture-user', '-s', 'di-agent-datadream-mcp', '-w']);
    if (readError) throw new Error('sensitive diagnostic must stay private');
    return readback + '\n';
  });
  await writeDatadreamKeychainCredential(key, 'fixture-user');
  assert.ok(written.includes(key));
  readback = 'old-personal-key-not-real';
  await assert.rejects(writeDatadreamKeychainCredential(key, 'fixture-user'), (error) => error.message === '钥匙串写入后校验不一致，配置未完成。');
  readError = true;
  await assert.rejects(writeDatadreamKeychainCredential(key, 'fixture-user'), (error) => error.message === '钥匙串写入后无法读取验证，配置未完成。');
});

test('Windows ignores unverified file credentials and accepts only personal process environment key', (t) => {
  const previous = process.env.DI_AGENT_DATADREAM_API_KEY;
  delete process.env.DI_AGENT_DATADREAM_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.DI_AGENT_DATADREAM_API_KEY; else process.env.DI_AGENT_DATADREAM_API_KEY = previous; });
  t.mock.method(fs, 'lstatSync', () => ({ isFile: () => true, isSymbolicLink: () => false, mode: 0o600, uid: process.getuid?.() }));
  t.mock.method(fs, 'readFileSync', () => JSON.stringify({ api_key: 'file-key-that-must-not-be-used', project_code: 'fixture_project' }));
  assert.equal(loadDatadreamCredential('win32'), null);
  process.env.DI_AGENT_DATADREAM_API_KEY = 'env-personal-key-not-real';
  assert.equal(loadDatadreamCredential('win32').key, 'env-personal-key-not-real');
});

test('local save rejects environment override and Windows before touching storage', async (t) => {
  const oldKey = process.env.DI_AGENT_DATADREAM_API_KEY;
  const oldProject = process.env.DI_AGENT_DATADREAM_PROJECT_CODE;
  t.after(() => {
    if (oldKey === undefined) delete process.env.DI_AGENT_DATADREAM_API_KEY; else process.env.DI_AGENT_DATADREAM_API_KEY = oldKey;
    if (oldProject === undefined) delete process.env.DI_AGENT_DATADREAM_PROJECT_CODE; else process.env.DI_AGENT_DATADREAM_PROJECT_CODE = oldProject;
  });
  t.mock.method(fs, 'mkdirSync', () => { throw new Error('must not touch disk'); });
  process.env.DI_AGENT_DATADREAM_API_KEY = 'fixture-environment-key';
  await assert.rejects(saveDatadreamCredential({ key: '', project: 'fixture' }, 'linux'), /环境变量覆盖/);
  delete process.env.DI_AGENT_DATADREAM_API_KEY;
  process.env.DI_AGENT_DATADREAM_PROJECT_CODE = 'fixture';
  await assert.rejects(saveDatadreamCredential({ key: '', project: 'fixture' }, 'linux'), /环境变量覆盖/);
  await assert.rejects(saveDatadreamCredential({ key: '', project: 'fixture' }, 'win32'), /Windows/);
});

test('numeric project IDs are rejected before credential storage', async (t) => {
  const oldKey = process.env.DI_AGENT_DATADREAM_API_KEY;
  const oldProject = process.env.DI_AGENT_DATADREAM_PROJECT_CODE;
  delete process.env.DI_AGENT_DATADREAM_API_KEY; delete process.env.DI_AGENT_DATADREAM_PROJECT_CODE;
  t.after(() => {
    if (oldKey !== undefined) process.env.DI_AGENT_DATADREAM_API_KEY = oldKey;
    if (oldProject !== undefined) process.env.DI_AGENT_DATADREAM_PROJECT_CODE = oldProject;
  });
  t.mock.method(fs, 'mkdirSync', () => { throw new Error('must not touch disk'); });
  await assert.rejects(saveDatadreamCredential({ key: 'fixture-private-key', project: '839' }, 'linux'), /纯数字项目 ID/);
});

test('blank Key saves retain private Unix credential with atomic owner-only config', async (t) => {
  const oldKey = process.env.DI_AGENT_DATADREAM_API_KEY;
  const oldProject = process.env.DI_AGENT_DATADREAM_PROJECT_CODE;
  delete process.env.DI_AGENT_DATADREAM_API_KEY; delete process.env.DI_AGENT_DATADREAM_PROJECT_CODE;
  t.after(() => {
    if (oldKey !== undefined) process.env.DI_AGENT_DATADREAM_API_KEY = oldKey;
    if (oldProject !== undefined) process.env.DI_AGENT_DATADREAM_PROJECT_CODE = oldProject;
  });
  const fixture = 'fixture-private-existing-key'; let written;
  t.mock.method(fs, 'lstatSync', () => ({ isFile: () => true, isSymbolicLink: () => false, mode: 0o600, uid: process.getuid?.() }));
  t.mock.method(fs, 'readFileSync', () => JSON.stringify({ api_key: fixture, project_code: 'old_project' }));
  t.mock.method(fs, 'mkdirSync', () => {});
  t.mock.method(fs, 'chmodSync', (_path, mode) => assert.equal(mode, 0o700));
  t.mock.method(fs, 'writeFileSync', (_path, body, options) => { assert.equal(options.mode, 0o600); assert.equal(options.flag, 'wx'); written = JSON.parse(body); });
  t.mock.method(fs, 'renameSync', () => {});
  await saveDatadreamCredential({ key: '', project: 'new_project' }, 'linux');
  assert.deepEqual(written, { api_key: fixture, project_code: 'new_project' });
});
