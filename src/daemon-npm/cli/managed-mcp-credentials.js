const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const SERVICE = 'di-agent-datadream-mcp';
const SETUP = '在本人电脑终端运行 di-agent-daemon --configure-managed-mcp datadream，并登录滴滴安全助手的智能体安全。';
const credentialPath = () => path.join(os.homedir(), '.di-agent', 'managed-mcp', 'datadream.json');

function readPrivateConfig() {
  try {
    const file = credentialPath();
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return {}; }
}

function validKey(key) {
  return typeof key === 'string' && key.length >= 16 && key.length <= 4096 && /^[A-Za-z0-9._~+/=-]+$/.test(key);
}

function loadDatadreamCredential(platform = process.platform) {
  const config = readPrivateConfig();
  let key = process.env.DI_AGENT_DATADREAM_API_KEY || '';
  if (!key && platform === 'darwin') {
    try {
      key = childProcess.execFileSync('/usr/bin/security', ['find-generic-password', '-a', os.userInfo().username, '-s', SERVICE, '-w'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { /* 尚未配置或钥匙串锁定，不向模型输出系统诊断。 */ }
  } else if (!key && platform !== 'win32') key = config.api_key || '';
  if (!validKey(key)) return null;
  const project = process.env.DI_AGENT_DATADREAM_PROJECT_CODE || config.project_code || 'epower_platform';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(project)) return null;
  return { key, project };
}

// raw TTY 模式不回显密码，也不把它放入命令行参数或日志。
function prompt(label, hidden = false) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('请在本人的交互终端执行配置命令。');
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    const previous = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';
    const done = () => { process.stdin.removeListener('data', onData); process.stdin.setRawMode(previous); process.stdin.pause(); process.stdout.write('\n'); };
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') { done(); reject(new Error('已取消配置')); return; }
        if (char === '\r' || char === '\n') { done(); resolve(value.trim()); return; }
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); if (!hidden) process.stdout.write('\b \b'); }
        else if (char >= ' ') { value += char; if (!hidden) process.stdout.write(char); }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function writeDatadreamKeychainCredential(key, account = os.userInfo().username) {
  if (!validKey(key)) throw new Error('API Key 格式无效');
  if (!/^[A-Za-z0-9_.-]+$/.test(account)) throw new Error('本机账号格式不支持钥匙串配置');
  await new Promise((resolve, reject) => {
    const child = childProcess.spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('钥匙串保存超时')); }, 30000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('钥匙串不可用')); });
    child.stdin.on('error', () => { clearTimeout(timer); reject(new Error('钥匙串保存失败')); });
    child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('钥匙串保存失败')); });
    child.stdin.end(`add-generic-password -U -a "${account}" -s "${SERVICE}" -w "${key}"\n`);
  });
  // security -i 退出为 0 不保证子命令成功；必须读回相同 Key 才提交项目配置。
  let stored;
  try {
    stored = childProcess.execFileSync('/usr/bin/security', ['find-generic-password', '-a', account, '-s', SERVICE, '-w'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { throw new Error('钥匙串写入后无法读取验证，配置未完成。'); }
  if (stored !== key) throw new Error('钥匙串写入后校验不一致，配置未完成。');
}

async function configureDatadream() {
  if (process.platform === 'win32') throw new Error('Windows 首版请在本人 daemon 进程环境配置 DI_AGENT_DATADREAM_API_KEY 和 DI_AGENT_DATADREAM_PROJECT_CODE；不会将 Key 写入未核验 ACL 的文件。');
  const project = await prompt('数梦项目 code [epower_platform]: ') || 'epower_platform';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(project)) throw new Error('项目 code 格式无效');
  const key = (await prompt('本人新版 API Key（不回显，不含 Bearer）: ', true)).replace(/^Bearer\s+/i, '');
  await saveDatadreamCredential({ key, project });
  process.stdout.write('数梦个人凭据已保存到本机。连接状态以实际 MCP 验证为准。\n');
}

// 供本机配置页复用；空 Key 保留已有凭据，环境覆盖时拒绝假保存。
async function saveDatadreamCredential({ key = '', project }, platform = process.platform) {
  if (platform === 'win32') throw new Error('Windows 暂不支持安全持久化，请在本人 daemon 进程环境配置后安全重启。');
  if (process.env.DI_AGENT_DATADREAM_API_KEY || process.env.DI_AGENT_DATADREAM_PROJECT_CODE) throw new Error('当前配置由进程环境变量覆盖，请修改启动环境并在任务结束后重启连接程序。');
  if (typeof project !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(project) || /^\d+$/.test(project)) throw new Error('项目 Code 格式无效，请复制 Code 而不是纯数字项目 ID。');
  if (typeof key !== 'string') throw new Error('API Key 格式无效');
  key = key.trim().replace(/^Bearer\s+/i, '') || loadDatadreamCredential(platform)?.key || '';
  if (!validKey(key)) throw new Error('API Key 格式无效');
  const dir = path.dirname(credentialPath());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('本地凭据目录不可为符号链接');
  fs.chmodSync(dir, 0o700);
  const config = { project_code: project };
  if (platform === 'darwin') {
    await writeDatadreamKeychainCredential(key);
  } else {
    // Unix 文件仅本人可读，Windows 首版使用个人进程环境变量。
    config.api_key = key;
  }
  const temp = `${credentialPath()}.${process.pid}.${require('node:crypto').randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, credentialPath());
}

function getDatadreamConfigState(credential = loadDatadreamCredential()) {
  const config = readPrivateConfig();
  return {
    key_configured: !!credential,
    project_code: credential?.project || (typeof config.project_code === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(config.project_code) ? config.project_code : ''),
    credential_source: process.env.DI_AGENT_DATADREAM_API_KEY ? 'environment' : credential ? (process.platform === 'darwin' ? 'keychain' : 'file') : 'missing',
    project_source: process.env.DI_AGENT_DATADREAM_PROJECT_CODE ? 'environment' : config.project_code ? 'file' : credential ? 'default' : 'missing',
  };
}

module.exports = { loadDatadreamCredential, configureDatadream, saveDatadreamCredential, getDatadreamConfigState, writeDatadreamKeychainCredential, SETUP };
