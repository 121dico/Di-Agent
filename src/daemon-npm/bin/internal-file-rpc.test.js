const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'di-agent-file-rpc-test-'));
const homedir = os.homedir;
os.homedir = () => home;
const { handleTaskDispatch, pendingTaskCompletions } = require('./di-agent-daemon');
test.after(() => { os.homedir = homedir; fs.rmSync(home, { recursive: true, force: true }); });

test('dispatch preserves internal file RPC JSON and returns file bytes without image/artifact rewriting', async () => {
  const file = path.join(home, 'index.html');
  const content = '<!doctype html><h1>Preview</h1>\n![example](/not-an-output.png)';
  fs.writeFileSync(file, content);
  const id = 'internal-html-read-test';
  const write = process.stdout.write;
  let logs = '';
  process.stdout.write = function(chunk, ...args) {
    logs += String(chunk);
    return write.call(this, chunk, ...args);
  };
  try {
    await handleTaskDispatch(null, {
      task_id: id, cli_tool: '__di_agent_browse_files__', agent_id: 'owned-agent',
      prompt: JSON.stringify({ action: 'read', work_dir: home, path: file }),
    });
    const reply = pendingTaskCompletions.get(id);
    assert.ok(reply, 'completion must be delivered or buffered');
    assert.equal(reply.error, undefined);
    assert.equal(JSON.parse(reply.result).content, content);
    assert.deepEqual(reply.artifacts, []);
    assert.ok(!logs.includes('<h1>Preview</h1>'), 'file body must not enter daemon logs');
  } finally {
    process.stdout.write = write;
    pendingTaskCompletions.delete(id);
  }
});

test('file RPC accepts workspace aliases but rejects symlinks escaping the real workspace', async () => {
  const root = path.join(home, 'real-project');
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q', root]);
  const alias = path.join(home, 'project-alias');
  fs.symlinkSync(root, alias, 'dir');
  fs.writeFileSync(path.join(root, 'page.html'), '<h1>Alias preview</h1>');
  const outside = path.join(home, 'private.html');
  fs.writeFileSync(outside, 'private');
  fs.symlinkSync(outside, path.join(root, 'escape.html'));
  fs.symlinkSync(path.join(home, 'missing-directory'), path.join(root, 'dangling'), 'dir');
  for (const [name, allowed] of [['page.html', true], ['escape.html', false], ['dangling/child.html', false]]) {
    const id = 'alias-' + name;
    try {
      await handleTaskDispatch(null, {
        task_id: id, cli_tool: '__di_agent_browse_files__',
        prompt: JSON.stringify({ action: 'read', work_dir: alias, path: path.join(alias, name) }),
      });
      const reply = pendingTaskCompletions.get(id);
      if (allowed) {
        assert.equal(reply.error, undefined);
        assert.equal(JSON.parse(reply.result).content, '<h1>Alias preview</h1>');
      } else {
        assert.equal(reply.error, 'Invalid or out-of-root path');
        assert.equal(reply.result, undefined);
      }
    } finally { pendingTaskCompletions.delete(id); }
  }
});

test('file RPC preserves historical show and diff after a file and its parent are deleted', async () => {
  const root = path.join(home, 'history-project');
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
  execFileSync('git', ['init', '-q', root]);
  const file = path.join(root, 'nested', 'deleted.html');
  const content = '<h1>Historical preview</h1>\n';
  fs.writeFileSync(file, content);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  fs.unlinkSync(file);
  fs.rmdirSync(path.dirname(file));
  const alias = path.join(home, 'history-alias');
  fs.symlinkSync(root, alias, 'dir');
  for (const action of ['show', 'diff']) {
    const id = 'deleted-history-' + action;
    try {
      await handleTaskDispatch(null, {
        task_id: id, cli_tool: '__di_agent_browse_files__',
        prompt: JSON.stringify({ action, rev: 'HEAD', work_dir: alias, path: path.join(alias, 'nested', 'deleted.html') }),
      });
      const reply = pendingTaskCompletions.get(id);
      assert.equal(reply.error, undefined);
      const result = JSON.parse(reply.result);
      // Historical git reads retain the existing trimmed-output contract.
      if (action === 'show') assert.equal(result.content, content.trim());
      else {
        assert.equal(result.oldContent, content.trim());
        assert.equal(result.newContent, '');
      }
    } finally { pendingTaskCompletions.delete(id); }
  }
});
