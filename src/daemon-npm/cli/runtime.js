'use strict';

const path = require('node:path');

function compactPaths(values) {
  return [...new Set(values.filter(Boolean))];
}

function codexDesktopRuntimePaths({
  platform = process.platform,
  env = process.env,
  home = env.HOME || env.USERPROFILE || '',
  pathImpl = path,
} = {}) {
  if (platform === 'darwin') {
    return compactPaths([
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      home && pathImpl.join(home, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
      '/Applications/Codex.app/Contents/Resources/codex',
      home && pathImpl.join(home, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
    ]);
  }
  if (platform !== 'win32') return [];
  return compactPaths([
    env.LOCALAPPDATA && pathImpl.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'codex.exe'),
    env.LOCALAPPDATA && pathImpl.join(env.LOCALAPPDATA, 'Programs', 'ChatGPT', 'resources', 'codex.exe'),
    env.PROGRAMFILES && pathImpl.join(env.PROGRAMFILES, 'ChatGPT', 'resources', 'codex.exe'),
    env.PROGRAMFILES && pathImpl.join(env.PROGRAMFILES, 'Codex', 'resources', 'codex.exe'),
  ]);
}

function zcodeDesktopRuntimePaths({
  platform = process.platform,
  env = process.env,
  home = env.HOME || env.USERPROFILE || '',
  pathImpl = path,
} = {}) {
  if (platform === 'darwin') {
    return compactPaths([
      '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
      home && pathImpl.join(home, 'Applications', 'ZCode.app', 'Contents', 'Resources', 'glm', 'zcode.cjs'),
    ]);
  }
  if (platform !== 'win32') return [];
  return compactPaths([
    env.LOCALAPPDATA && pathImpl.join(env.LOCALAPPDATA, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs'),
    env.LOCALAPPDATA && pathImpl.join(env.LOCALAPPDATA, 'ZCode', 'resources', 'glm', 'zcode.cjs'),
    env.PROGRAMFILES && pathImpl.join(env.PROGRAMFILES, 'ZCode', 'resources', 'glm', 'zcode.cjs'),
  ]);
}

function comparablePath(value, platform = process.platform) {
  const normalized = path.normalize(String(value || ''));
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function runtimeVariant(command, desktopPaths, platform = process.platform) {
  const target = comparablePath(command, platform);
  return desktopPaths.some((candidate) => comparablePath(candidate, platform) === target)
    ? 'desktop'
    : 'cli';
}

function resolveRuntimeCandidate({
  override,
  cliCommand,
  desktopPaths = [],
  existingFile = () => false,
  commandVersion,
  platform = process.platform,
  canonicalCommand,
}) {
  const candidates = resolveRuntimeCandidates({
    override,
    cliCommand,
    desktopPaths,
    existingFile,
    commandVersion,
    platform,
    canonicalCommand,
  });
  if (candidates.length > 0) {
    const { command, variant } = candidates[0];
    return { command, variant };
  }
  return { command: cliCommand, variant: runtimeVariant(cliCommand, desktopPaths, platform) };
}

/**
 * Return every independently runnable runtime for one product. The list is
 * stable (standalone CLI first, Desktop second), contains at most one entry per
 * variant, and removes aliases that resolve to the same physical executable.
 */
function resolveRuntimeCandidates({
  override,
  cliCommand,
  desktopPaths = [],
  existingFile = () => false,
  commandVersion,
  platform = process.platform,
  canonicalCommand = (command) => comparablePath(command, platform),
}) {
  const raw = [];
  if (override && existingFile(override)) {
    raw.push({ command: override, variant: runtimeVariant(override, desktopPaths, platform) });
  } else {
    raw.push({ command: cliCommand, variant: 'cli' });
  }
  for (const command of desktopPaths) {
    if (existingFile(command)) raw.push({ command, variant: 'desktop' });
  }

  const seenCommands = new Set();
  const seenVariants = new Set();
  const runnable = [];
  for (const candidate of raw) {
    let canonical = candidate.command;
    try { canonical = canonicalCommand(candidate.command) || candidate.command; } catch { /* keep raw path */ }
    const commandKey = comparablePath(canonical, platform);
    if (seenCommands.has(commandKey) || seenVariants.has(candidate.variant)) continue;
    const version = commandVersion(candidate.command);
    if (version === null) continue;
    seenCommands.add(commandKey);
    seenVariants.add(candidate.variant);
    runnable.push({ ...candidate, version });
  }
  return runnable;
}

function normalizeProcessSpec(command, args, {
  platform = process.platform,
  nodeCommand = process.execPath,
} = {}) {
  if (/\.(?:c?js|mjs)$/i.test(command)) {
    return { command: nodeCommand, args: [command, ...args] };
  }
  if (platform === 'win32' && !command.toLowerCase().endsWith('.exe')) {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
  }
  return { command, args };
}

module.exports = {
  codexDesktopRuntimePaths,
  zcodeDesktopRuntimePaths,
  resolveRuntimeCandidates,
  resolveRuntimeCandidate,
  runtimeVariant,
  normalizeProcessSpec,
};
