const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { codexPluginSkillRoots } = require('../codex-plugin-skills');
function fixture(t) {
 const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-plugin-index-'));
 t.after(() => fs.rmSync(home, { recursive: true, force: true }));
 const install = (name, version) => {
  const dir = path.join(home, 'plugins/cache/market', name, version);
  fs.mkdirSync(path.join(dir, '.codex-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.codex-plugin/plugin.json'), JSON.stringify({ name, version, skills: './skills' }));
  return dir;
 };
 return { home, install };
}
test('only explicitly enabled installed plugins contribute namespaced roots', t => {
 const {home, install} = fixture(t);
 install('enabled', '1'); install('disabled', '1'); install('cache-only', '1');
 fs.writeFileSync(path.join(home, 'config.toml'), '[plugins."enabled@market"]\nenabled = true\n[plugins."disabled@market"]\nenabled = false\n');
 const roots = codexPluginSkillRoots(home);
 assert.equal(roots.length, 1);
 assert.equal(roots[0].namespace, 'enabled');
 assert.equal(roots[0].plugin_id, 'enabled@market');
});
test('multiple cached versions require current local marketplace manifest evidence', t => {
 const {home, install} = fixture(t);
 install('enabled', '1'); install('enabled', '2');
 const config = '[plugins."enabled@market"]\nenabled = true\n';
 fs.writeFileSync(path.join(home, 'config.toml'), config);
 assert.deepEqual(codexPluginSkillRoots(home), []);
 const market = path.join(home, 'market');
 fs.mkdirSync(path.join(market, '.agents/plugins'), { recursive: true });
 fs.mkdirSync(path.join(market, 'enabled/.codex-plugin'), { recursive: true });
 fs.writeFileSync(path.join(market, '.agents/plugins/marketplace.json'), JSON.stringify({plugins:[{name:'enabled',source:{source:'local',path:'./enabled'}}]}));
 fs.writeFileSync(path.join(market, 'enabled/.codex-plugin/plugin.json'), JSON.stringify({name:'enabled',version:'2'}));
 fs.writeFileSync(path.join(home, 'config.toml'), config + `[marketplaces.market]\nsource_type = "local"\nsource = ${JSON.stringify(market)}\n`);
 assert.ok(codexPluginSkillRoots(home)[0].root.endsWith('/2/skills'));
});
