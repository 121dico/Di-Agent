'use strict';
const fs = require('node:fs');
const path = require('node:path');
function json(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function literal(raw) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^'[^']*'$/.test(value)) return value.slice(1, -1);
  try { return JSON.parse(value); } catch { return undefined; }
}
// Only the plugin/marketplace tables needed for discovery are read. Unsupported
// config syntax is ignored (fail closed), never interpreted as enabled.
function configTables(file) {
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const tables = { plugins: {}, marketplaces: {} };
  let current;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      const match = /^\s*\[(plugins|marketplaces)\.("(?:[^"\\]|\\.)*"|'[^']*'|[\w-]+)\]\s*(?:#.*)?$/.exec(line);
      current = undefined;
      if (match) {
        const key = /^["']/.test(match[2]) ? literal(match[2]) : match[2];
        if (typeof key === 'string') current = tables[match[1]][key] = {};
      }
    } else if (current) {
      const match = /^\s*(enabled|source|source_type)\s*=\s*(.*)$/.exec(line);
      if (match) current[match[1]] = literal(match[2].replace(/\s+#.*$/, ''));
    }
  }
  return tables;
}
function codexPluginSkillRoots(codexHome) {
  const tables = configTables(path.join(codexHome, 'config.toml'));
  const roots = [];
  for (const [id, config] of Object.entries(tables.plugins || {})) {
    if (config.enabled !== true) continue;
    const match = /^([\w-]+)@([\w-]+)$/.exec(id);
    if (!match) continue;
    const [, name, marketplace] = match;
    const cache = path.join(codexHome, 'plugins', 'cache', marketplace, name);
    let versions;
    try { versions = fs.readdirSync(cache).filter(version => json(path.join(cache, version, '.codex-plugin', 'plugin.json'))?.name === name); } catch { continue; }
    let version;
    const source = tables.marketplaces?.[marketplace];
    if (source?.source_type === 'local' && typeof source.source === 'string') {
      const manifest = json(path.join(source.source, '.agents', 'plugins', 'marketplace.json'));
      const entry = manifest?.plugins?.find(plugin => plugin.name === name);
      if (entry?.source?.source === 'local' && typeof entry.source.path === 'string') {
        const plugin = json(path.resolve(source.source, entry.source.path, '.codex-plugin', 'plugin.json'));
        if (plugin?.name === name && versions.includes(plugin.version)) version = plugin.version;
      }
      // A configured source with a different version is not proof an old cache is active.
      if (!version) continue;
    } else if (versions.length === 1) version = versions[0];
    if (!version) continue;
    const install = path.join(cache, version);
    const manifest = json(path.join(install, '.codex-plugin', 'plugin.json'));
    const declared = manifest.skills === undefined ? ['./skills'] : Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills];
    for (const skillRoot of declared) {
      if (typeof skillRoot !== 'string') continue;
      const root = path.resolve(install, skillRoot);
      if (!root.startsWith(install + path.sep)) continue;
      roots.push({ root, namespace: name, plugin_id: id });
    }
  }
  return roots;
}
module.exports = { codexPluginSkillRoots };
