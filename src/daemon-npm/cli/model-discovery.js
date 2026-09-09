'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// 只提取模型名，绝不上传认证配置；配置候选不冒充已执行模型。
function configuredModel(cli, env = process.env, home = os.homedir()) {
 try {
  if (cli === 'claude') {
   const settings = JSON.parse(fs.readFileSync(path.join(home,'.claude','settings.json'),'utf8'));
   return String(env.ANTHROPIC_MODEL || settings.env?.ANTHROPIC_MODEL || settings.model || '').slice(0,200);
  }
  if (cli === 'codex') {
   const root = env.DI_AGENT_CODEX_HOME || env.CODEX_HOME || path.join(home,'.codex');
   const top = fs.readFileSync(path.join(root,'config.toml'),'utf8').split(/^\s*\[/m)[0];
   return (top.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] || '').slice(0,200);
  }
 } catch { /* 未找到配置时等待原生运行上报，不猜模型。 */ }
 return cli === 'claude' ? String(env.ANTHROPIC_MODEL || '').slice(0,200) : '';
}
module.exports = { configuredModel };
