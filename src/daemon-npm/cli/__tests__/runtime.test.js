'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  codexDesktopRuntimePaths,
  zcodeDesktopRuntimePaths,
  resolveRuntimeCandidates,
  resolveRuntimeCandidate,
  runtimeVariant,
  normalizeProcessSpec,
} = require('../runtime');

test('runtime discovery reports CLI and Desktop as separate runnable candidates', () => {
  const desktop = '/Applications/Codex.app/Contents/Resources/codex';
  const resolved = resolveRuntimeCandidates({
    cliCommand: 'codex',
    desktopPaths: [desktop],
    existingFile: (candidate) => candidate === desktop,
    commandVersion: (command) => (command === 'codex' ? 'codex-cli 1.0.0' : 'codex-cli 2.0.0'),
  });

  assert.deepEqual(resolved, [
    { command: 'codex', variant: 'cli', version: 'codex-cli 1.0.0' },
    { command: desktop, variant: 'desktop', version: 'codex-cli 2.0.0' },
  ]);
});

test('runtime discovery removes duplicate physical paths and keeps CLI first', () => {
  const desktop = '/Applications/Codex.app/Contents/Resources/codex';
  const resolved = resolveRuntimeCandidates({
    cliCommand: 'codex',
    desktopPaths: [desktop, `${desktop}/../codex`],
    existingFile: () => true,
    canonicalCommand: (command) => (command === 'codex' ? desktop : desktop),
    commandVersion: () => 'codex-cli 2.0.0',
  });

  assert.deepEqual(resolved, [
    { command: 'codex', variant: 'cli', version: 'codex-cli 2.0.0' },
  ]);
});

test('runtime resolution prefers standalone CLI before a desktop fallback', () => {
  const desktop = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const resolved = resolveRuntimeCandidate({
    cliCommand: 'codex',
    desktopPaths: [desktop],
    existingFile: () => true,
    commandVersion: (command) => (command === 'codex' ? 'codex-cli 1.0.0' : 'desktop 2.0.0'),
  });

  assert.deepEqual(resolved, { command: 'codex', variant: 'cli' });
});

test('runtime resolution falls back to a runnable desktop bundle', () => {
  const desktop = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const resolved = resolveRuntimeCandidate({
    cliCommand: 'codex',
    desktopPaths: [desktop],
    existingFile: (candidate) => candidate === desktop,
    commandVersion: (command) => (command === desktop ? 'codex-cli 2.0.0' : null),
  });

  assert.deepEqual(resolved, { command: desktop, variant: 'desktop' });
  assert.equal(runtimeVariant(desktop, [desktop]), 'desktop');
  assert.equal(runtimeVariant('codex', [desktop]), 'cli');
});

test('Windows desktop variant comparison is normalized and case-insensitive', () => {
  assert.equal(runtimeVariant(
    'C:\\PROGRAM FILES\\ZCode\\resources\\glm\\zcode.cjs',
    ['C:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs'],
    'win32',
  ), 'desktop');
});

test('runtime resolution gives an explicit override highest priority', () => {
  const resolved = resolveRuntimeCandidate({
    override: '/opt/custom/codex',
    cliCommand: 'codex',
    desktopPaths: ['/Applications/ChatGPT.app/Contents/Resources/codex'],
    existingFile: (candidate) => candidate.startsWith('/'),
    commandVersion: () => 'ok',
  });

  assert.deepEqual(resolved, { command: '/opt/custom/codex', variant: 'cli' });
});

test('desktop runtime paths cover supported macOS bundles', () => {
  assert.deepEqual(codexDesktopRuntimePaths({ platform: 'darwin', home: '/Users/me' }), [
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Users/me/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Users/me/Applications/Codex.app/Contents/Resources/codex',
  ]);
  assert.deepEqual(zcodeDesktopRuntimePaths({ platform: 'darwin', home: '/Users/me' }), [
    '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
    '/Users/me/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
  ]);
});

test('desktop runtime paths cover supported Windows layouts', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    PROGRAMFILES: 'C:\\Program Files',
  };
  const win = path.win32;
  const codex = codexDesktopRuntimePaths({ platform: 'win32', env, pathImpl: win });
  const zcode = zcodeDesktopRuntimePaths({ platform: 'win32', env, pathImpl: win });

  assert.ok(codex.includes('C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\codex.exe'));
  assert.ok(codex.includes('C:\\Program Files\\ChatGPT\\resources\\codex.exe'));
  assert.ok(zcode.includes('C:\\Users\\me\\AppData\\Local\\Programs\\ZCode\\resources\\glm\\zcode.cjs'));
  assert.ok(zcode.includes('C:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs'));
});

test('script runtime entry points are launched through the current Node executable', () => {
  assert.deepEqual(
    normalizeProcessSpec('/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs', ['--version'], {
      platform: 'darwin',
      nodeCommand: '/usr/local/bin/node',
    }),
    {
      command: '/usr/local/bin/node',
      args: ['/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs', '--version'],
    },
  );
});
