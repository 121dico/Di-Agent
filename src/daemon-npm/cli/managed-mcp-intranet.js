const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const execFileAsync = promisify(execFile);
const SOURCE = 'https://mcphub.intra.xiaojukeji.com/square/intranet-fetcher';
const PACKAGE = '@didi/intranet-fetcher-mcp';
const VERSION = '4.1.1';
const INTEGRITY = 'sha512-I0mxTuioHwyGRg9TgXBXldZnhmdda+3YHCkK6W19ElinoAqg1HJIFqpIK5Xdprl4Zd6173vWXlmVa26w962uOw==';
const REGISTRY = 'http://npm.intra.xiaojukeji.com/';
const TOOL = 'fetch_intranet';

function validateConnector(entry) {
  if (!entry || entry.id !== 'intranet-fetcher' || entry.enabled !== true || entry.source !== 'mcphub'
    || entry.source_url !== SOURCE || entry.execution !== 'user_local' || entry.transport !== 'stdio'
    || entry.package !== PACKAGE || entry.version !== VERSION || entry.credential_binding !== 'chrome-local-confirmed'
    || !Array.isArray(entry.allowed_tools) || entry.allowed_tools.length !== 1 || entry.allowed_tools[0] !== TOOL) {
    throw new Error('mcphub 内网页面检索目录与本机已审核版本不兼容');
  }
  return entry;
}

function privateDirectory() {
  let dir = os.homedir();
  for (const part of ['.di-agent', 'managed-mcp', 'packages']) {
    dir = path.join(dir, part);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.uid !== process.getuid())) {
      throw new Error('mcphub 本机目录权限不安全');
    }
    if (process.platform !== 'win32') fs.chmodSync(dir, 0o700);
  }
  return dir;
}

function installedRoot() {
  const target = path.join(privateDirectory(), 'intranet-fetcher-4.1.1');
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.uid !== process.getuid())) throw new Error('mcphub 本机包目录无效');
  const pkg = path.join(target, 'node_modules', '@didi', 'intranet-fetcher-mcp');
  if (!fs.existsSync(pkg) || fs.lstatSync(pkg).isSymbolicLink()) throw new Error('mcphub 本机包不完整');
  const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
  if (manifest.name !== PACKAGE || manifest.version !== VERSION) throw new Error('mcphub 本机包版本不匹配');
  return pkg;
}

async function ensureInstalled() {
  const existing = installedRoot();
  if (existing) return existing;
  const parent = privateDirectory();
  const stage = fs.mkdtempSync(path.join(parent, '.intranet-fetcher-stage-'));
  const adjacentNpm = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npm = fs.existsSync(adjacentNpm) ? adjacentNpm : 'npm';
  try {
    const { stdout } = await execFileAsync(npm, ['pack', `${PACKAGE}@${VERSION}`, '--registry', REGISTRY,
      '--pack-destination', stage, '--json', '--ignore-scripts'], { timeout: 120000, maxBuffer: 1024 * 1024 });
    const packed = JSON.parse(stdout)[0];
    if (packed.name !== PACKAGE || packed.version !== VERSION || packed.integrity !== INTEGRITY
      || !/^[a-zA-Z0-9@._-]+\.tgz$/.test(packed.filename)) throw new Error('官方包完整性校验失败');
    await execFileAsync(npm, ['install', '--prefix', stage, path.join(stage, packed.filename),
      '--registry', REGISTRY, '--ignore-scripts', '--no-audit', '--no-fund'],
    { timeout: 180000, maxBuffer: 1024 * 1024 });
    const pkg = path.join(stage, 'node_modules', '@didi', 'intranet-fetcher-mcp');
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
    if (manifest.name !== PACKAGE || manifest.version !== VERSION) throw new Error('安装后版本校验失败');
    try { fs.renameSync(stage, path.join(parent, 'intranet-fetcher-4.1.1')); }
    catch (error) { if (!installedRoot()) throw error; }
    return installedRoot();
  } catch (error) {
    throw new Error(error.message === '官方包完整性校验失败' ? error.message : '内网页面检索安装失败；请检查公司 npm 网络与本机 Node 环境。');
  } finally {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  }
}

function validateArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => !['url', 'selector', 'maxLength'].includes(key))) throw new Error('内网页面检索参数无效');
  let url;
  try { url = new URL(args.url); } catch { throw new Error('请输入完整的公司内网 HTTPS 地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !(url.hostname === 'xiaojukeji.com' || url.hostname.endsWith('.xiaojukeji.com')))
    throw new Error('内网页面检索只允许公司域名的 HTTPS 页面');
  if (args.selector !== undefined && (typeof args.selector !== 'string' || args.selector.length > 256)) throw new Error('页面选择器无效');
  const maxLength = args.maxLength === undefined ? 12000 : args.maxLength;
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 20000) throw new Error('页面字数上限须为 1 至 20000');
  return { url: url.toString(), ...(args.selector ? { selector: args.selector } : {}), maxLength };
}

async function withClient(action) {
  const root = await ensureInstalled();
  const requirePackage = createRequire(path.join(root, 'package.json'));
  const { Client } = requirePackage('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = requirePackage('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'index.js')], stderr: 'pipe' });
  const client = new Client({ name: 'di-agent-mcphub', version: '1.0.0' });
  try {
    await client.connect(transport, { timeout: 45000 });
    const server = client.getServerVersion();
    if (server?.name !== 'intranet-fetcher' || server?.version !== VERSION) throw new Error('mcphub 服务握手版本不匹配');
    const listed = await client.listTools(undefined, { timeout: 45000 });
    const tool = listed.tools?.find(item => item.name === TOOL);
    if (!tool) throw new Error('mcphub 上游没有已审核工具');
    return await action(client, tool);
  } finally {
    await client.close().catch(() => {});
  }
}

async function listTools() {
  return withClient(async (_client, tool) => [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }]);
}

async function callTool(args) {
  const input = validateArguments(args);
  return withClient(async (client) => {
    const result = await client.callTool({ name: TOOL, arguments: input }, undefined, { timeout: 180000 });
    if (result.isError) throw new Error('内网页面读取失败；请检查本人 Chrome 公司登录态和页面权限。');
    const content = (result.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (content.length > 30000) throw new Error('页面结果过长，请缩小范围');
    if (/stargate-auth\/html\/login|请先登录.*(Boss|公司)/i.test(content)) throw new Error('公司登录态已失效，请在本人 Chrome 重新登录。');
    return { content: [{ type: 'text', text: content }], isError: false };
  });
}

module.exports = { SOURCE, TOOL, validateConnector, validateArguments, ensureInstalled, listTools, callTool };
