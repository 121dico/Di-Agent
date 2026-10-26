const http = require('node:http');
const { loadDatadreamCredential, SETUP } = require('./managed-mcp-credentials');
const { readConnection, saveConnection, credentialBound, browserBound } = require('./managed-mcp-state');
const intranet = require('./managed-mcp-intranet');

const ENDPOINT = 'http://127.0.0.1:28582/v1/datadream_mcp/datadream_mcp';
const ALLOWED = ['datamap_search_asset', 'datamap_get_table_detail', 'get_hive_table_partition_page_list', 'check_sql_syntax', 'run_sql', 'get_sql_log', 'get_sql_result'];
const MANAGED_TOOL_NAMES = ['list_managed_mcps', 'set_managed_mcp_enabled', 'get_managed_mcp_tools', 'call_managed_mcp_tool'];
const COOPER_ENDPOINT = 'http://127.0.0.1:28582/v1/hub/cooper_mcp';
const COOPER_TOOLS = ['readContent', 'getKnowledgeDirectory'];
const MAX_BODY = 8 * 1024 * 1024;

function safeError(code) {
  if (code === 50102) return Object.assign(new Error('公司 MCP 身份代理尚无可用登录态，请核对安全助手智能体安全登录及本人新版 API Key。'), { diagnosticCode: 'identity_required' });
  return new Error(`公司 MCP 请求失败${Number.isInteger(code) ? `（错误码 ${code}）` : ''}，请检查个人配置和上游权限。`);
}

// 即使服务器目录被误配，个人凭据也只能发送到本机固定代理地址。
function validateConnector(value) {
  if (value?.id === 'intranet-fetcher') return intranet.validateConnector(value);
  if (value?.id === 'cooper') {
    if (value.enabled !== true || value.endpoint !== COOPER_ENDPOINT || value.execution !== 'user_local' || value.transport !== 'streamable-http' || value.credential_binding !== 'company-personal' || !Array.isArray(value.allowed_tools)) throw new Error('Cooper MCP 未启用或与本机版本不兼容');
    return { ...value, allowed_tools: value.allowed_tools.filter(name => COOPER_TOOLS.includes(name)) };
  }
  if (!value || value.id !== 'datadream' || value.enabled !== true || value.endpoint !== ENDPOINT || value.execution !== 'user_local' || value.transport !== 'streamable-http' || value.credential_binding !== 'datadream-personal' || !Array.isArray(value.allowed_tools)) throw new Error('此托管 MCP 未启用或与本机支持版本不兼容，请升级 daemon。');
  return { ...value, allowed_tools: value.allowed_tools.filter((name) => ALLOWED.includes(name)) };
}

async function prepareIntranet(ctx, connecting = false) {
  const connector = validateConnector((await catalog(ctx)).find(entry => entry.id === 'intranet-fetcher'));
  const state = readConnection(ctx, connector.id);
  if (!connecting && !state.enabled) throw new Error('此 mcphub 服务尚未启用，请在用户要求接入后启用。');
  if (!browserBound(ctx)) throw new Error('请先在本人电脑交互终端运行 --bind-managed-mcp-browser intranet-fetcher，确认本人 Chrome 登录态与平台账号绑定。');
  const userId = ctx.userId;
  const check = async () => {
    validateConnector((await catalog(ctx)).find(entry => entry.id === connector.id));
    if (ctx.userId !== userId || !browserBound(ctx)) throw new Error('mcphub 本人绑定已变化');
    if (!connecting && !readConnection(ctx, connector.id).enabled) throw new Error('此 mcphub 服务已撤销');
  };
  return { connector, state, check };
}

async function catalog(ctx) {
  if (!ctx.userId || typeof ctx.callManagedMcpApi !== 'function') throw new Error('托管 MCP 需要当前任务的本人身份和新版 daemon。');
  let response;
  try { response = await ctx.callManagedMcpApi('GET', '/daemon/managed-mcps'); }
  catch { throw new Error('托管 MCP 目录鉴权失败或服务端尚未升级；仅电脑所属用户可以使用本机个人凭据。'); }
  const data = response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
  if (!data || data.version !== 1 || !Array.isArray(data.connectors)) throw new Error('托管 MCP 目录版本不兼容，请升级平台与 daemon。');
  return data.connectors;
}

function assertReadOnlySQL(sql) {
  if (typeof sql !== 'string' || !sql.trim() || Buffer.byteLength(sql) > 20480) throw new Error('SQL 必须为不超过 20 KB 的单条只读 SELECT。');
  let clean = '';
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end + 1; clean += ' '; continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); if (end < 0 || sql.slice(i + 2, end).includes('/*')) throw new Error('SQL 注释不明确'); i = end + 2; clean += ' '; continue; }
    if (sql[i] === "'" || sql[i] === '"' || sql[i] === '`') {
      const quote = sql[i++]; let closed = false;
      while (i < sql.length) {
        if (sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === quote) { if (sql[i] === quote) { i++; continue; } closed = true; break; }
      }
      if (!closed) throw new Error('SQL 字符串或标识符未闭合');
      const following = sql.slice(i).replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
      if (following.startsWith('(')) throw new Error('首版不支持带引号的函数调用，请使用标准只读 SQL 函数。');
      clean += ' literal '; continue;
    }
    clean += sql[i++];
  }
  clean = clean.trim().replace(/;\s*$/, '');
  if (clean.includes(';') || !/^(select|with)\b/i.test(clean) || /\b(insert|update|delete|merge|create|alter|drop|truncate|load|export|import|set|add|dfs|use|grant|revoke|analyze|refresh|cache|uncache|msck|repair|call|execute|transform|script|reflect|java_method|assert_true|into|directory|outfile)\b/i.test(clean)) throw new Error('首版托管 MCP 仅允许单条只读 SELECT（可含 WITH），不允许写入或脚本。');
  return sql;
}

function sanitize(value, key) {
  return JSON.parse(JSON.stringify(value).split(key).join('[REDACTED]').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'));
}

// 不跟随重定向；每个请求独立计时，并在收包时限制大小。
function requestMcp(body, headers, timeoutMs = 45000, endpoint = ENDPOINT) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(payload) } });
    let finished = false;
    const timer = setTimeout(() => { req.destroy(); finish(Object.assign(new Error('公司 MCP 请求超时，可稍后查询任务状态。'), { diagnosticCode: 'timeout' })); }, timeoutMs);
    function finish(error, result) { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
    req.on('error', () => finish(new Error('无法连接本机公司 MCP 代理，请确认安全助手已启动。')));
    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); finish(safeError(res.statusCode)); return; }
      if (body.id === undefined) { res.resume(); finish(null, {}); return; }
      let bytes = 0; let buffer = '';
      const isSSE = String(res.headers['content-type']).includes('text/event-stream');
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_BODY) { res.destroy(); finish(new Error('MCP 响应超过 8 MiB，请缩小结果范围。')); return; }
        buffer += chunk;
        if (isSSE) {
          let boundary;
          while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
            const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
            const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            try { const message = JSON.parse(data); if (message.id === body.id || message.error) { finish(null, { message, session: res.headers['mcp-session-id'] }); res.destroy(); return; } } catch { finish(new Error('数梦 MCP 返回无效 SSE')); res.destroy(); return; }
          }
        }
      });
      res.on('error', () => finish(new Error('数梦 MCP 响应中断')));
      res.on('end', () => {
        if (finished) return;
        try { if (isSSE) throw new Error(); finish(null, { message: JSON.parse(buffer), session: res.headers['mcp-session-id'] }); }
        catch { finish(new Error('数梦 MCP 返回格式不兼容')); }
      });
    });
    req.end(payload);
  });
}

async function openClient(credential, timeoutMs = 45000, connector = { id: 'datadream', endpoint: ENDPOINT }) {
  const headers = { Authorization: `Bearer ${credential.key}`, ...(connector.id === 'datadream' ? { 'project-code': credential.project } : {}) };
  let nextID = 0;
  async function rpc(method, params, notify = false) {
    const body = { jsonrpc: '2.0', method, params, ...(notify ? {} : { id: ++nextID }) };
    const response = await requestMcp(body, headers, timeoutMs, connector.endpoint);
    if (response.session) headers['Mcp-Session-Id'] = response.session;
    if (notify) return;
    if (!response.message || response.message.error) throw safeError(response.message?.error?.code);
    if (response.message.id !== body.id || !Object.prototype.hasOwnProperty.call(response.message, 'result')) throw new Error('数梦 MCP 返回消息不匹配');
    return sanitize(response.message.result, credential.key);
  }
  const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'di-agent-managed-mcp', version: '1.0.0' } });
  headers['MCP-Protocol-Version'] = init.protocolVersion || '2025-03-26';
  await rpc('notifications/initialized', {}, true);
  return { rpc };
}

async function prepare(ctx, id, connecting = false) {
  const entries = await catalog(ctx);
  const connector = validateConnector(entries.find((entry) => entry.id === id));
  const state = readConnection(ctx, id);
  if (!connecting && !state.enabled) throw new Error('此 MCP 尚未启用，请在用户要求接入后调用 set_managed_mcp_enabled。');
  const credential = loadDatadreamCredential();
  if (!credential) throw new Error(`尚未配置本机数梦个人凭据。${SETUP}`);
  if (id === 'cooper' && !credentialBound(ctx, credential.key)) throw new Error('请先在本人终端通过 --bind-managed-mcp-credential cooper 将现有公司个人凭据绑定到当前平台账号和电脑。');
  const userId = ctx.userId;
  const check = async () => {
    const current = validateConnector((await catalog(ctx)).find(entry => entry.id === id));
    if (ctx.userId !== userId || current.allowed_tools.join(',') !== connector.allowed_tools.join(',')) throw new Error('MCP 授权已变化，请重新加载');
    if (id === 'cooper' && !credentialBound(ctx, credential.key)) throw new Error('MCP 个人凭据绑定已变化');
    if (!connecting && !readConnection(ctx, id).enabled) throw new Error('此 MCP 已撤销，尚未启用');
  };
  return { connector, state, check, project: credential.project, client: await openClient(credential, 45000, connector) };
}

async function toolList(client, connector) {
  const result = await client.rpc('tools/list', {});
  if (!Array.isArray(result.tools)) throw new Error('数梦工具列表格式不兼容');
  return result.tools.filter((tool) => connector.allowed_tools.includes(tool.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

const MANAGED_MCP_TOOLS = [
  {
    name: 'list_managed_mcps', description: '发现 mcphub 已审核连接器及平台托管的本机 MCP 和个人配置状态。先索引，再 get_managed_mcp_tools 按需加载一个来源；目录不代表连接成功。',
    inputSchema: { type: 'object', properties: { keyword: { type: 'string', maxLength: 100 } }, additionalProperties: false },
    run: async (args, ctx) => {
      const entries = await catalog(ctx);
      const keyword = String(args.keyword || '').slice(0, 100).toLowerCase();
      return { catalog_url: 'https://mcphub.intra.xiaojukeji.com/square', connectors: entries.filter(entry => ['datadream', 'cooper', 'intranet-fetcher'].includes(entry.id) && entry.enabled && [entry.id, entry.name, entry.purpose, entry.source || '', entry.source_url || ''].join(' ').toLowerCase().includes(keyword)).map(entry => {
        validateConnector(entry);
        const enabled = readConnection(ctx, entry.id).enabled;
        const credential = loadDatadreamCredential();
        const configured = entry.id === 'intranet-fetcher' ? browserBound(ctx) : !!credential && (entry.id !== 'cooper' || credentialBound(ctx, credential.key));
        return { id: entry.id, name: entry.name, purpose: entry.purpose, source: entry.source || 'managed', source_url: entry.source_url || null,
          allowed_tools: entry.allowed_tools, status: !enabled ? 'not_enabled' : configured ? 'configured_unverified' : 'setup_required',
          guidance: !configured && entry.id === 'cooper' ? '先在本人终端运行 --bind-managed-mcp-credential cooper 完成个人凭据与平台账号绑定，再让具备 set_managed_mcp_enabled 权限的 Agent 接入。'
            : !configured && entry.id === 'intranet-fetcher' ? '先在本人电脑通过 --bind-managed-mcp-browser intranet-fetcher 确认当前 Chrome 登录态属于本人，再请求 Agent 接入。'
              : !enabled ? '用户要求接入时调用 set_managed_mcp_enabled，验证通过后仅对本人当前电脑启用。' : configured ? '调用 get_managed_mcp_tools 验证真实连接并加载工具。' : SETUP };
      }) };
    },
  },
  {
    name: 'set_managed_mcp_enabled', description: '仅当用户要求接入或撤销时使用。接入经审核的本机 MCP：用本人凭据或已绑定的本机 Chrome 登录态真实握手，成功后保存启用状态；内网页面检索首次接入会在本人电脑安装固定版本的公司官方包，不扩大上游权限。撤销阻止后续调用。不接收密码、URL 或安装命令。',
    inputSchema: { type: 'object', properties: { connector_id: { type: 'string', enum: ['datadream', 'cooper', 'intranet-fetcher'] }, enabled: { type: 'boolean' } }, required: ['connector_id', 'enabled'], additionalProperties: false },
    run: async (args, ctx) => {
      if (typeof args.enabled !== 'boolean' || !['datadream', 'cooper', 'intranet-fetcher'].includes(args.connector_id)) throw new Error('MCP 启用参数无效');
      if (!args.enabled) {
        await catalog(ctx);
        saveConnection(ctx, args.connector_id, false);
        return { connector_id: args.connector_id, status: 'not_enabled' };
      }
      if (args.connector_id === 'intranet-fetcher') {
        const { connector, state, check } = await prepareIntranet(ctx, true);
        const tools = await intranet.listTools();
        await check();
        saveConnection(ctx, connector.id, true, state.revision);
        return { connector_id: connector.id, status: 'connected', tools };
      }
      const { connector, client, state, check } = await prepare(ctx, args.connector_id, true);
      const tools = await toolList(client, connector);
      if (!tools.length) throw new Error('上游没有可用的已授权工具，未启用');
      await check();
      saveConnection(ctx, args.connector_id, true, state.revision);
      return { connector_id: connector.id, status: 'connected', tools };
    },
  },
  {
    name: 'get_managed_mcp_tools', description: '验证本人的本机 MCP 连接，仅加载指定来源的工具 schema；不暴露凭据。',
    inputSchema: { type: 'object', properties: { connector_id: { type: 'string', enum: ['datadream', 'cooper', 'intranet-fetcher'] } }, required: ['connector_id'], additionalProperties: false },
    run: async (args, ctx) => {
      if (args.connector_id === 'intranet-fetcher') {
        const { connector, check } = await prepareIntranet(ctx);
        const tools = await intranet.listTools();
        await check();
        return { connector_id: connector.id, status: 'connected', tools };
      }
      const { connector, client, check } = await prepare(ctx, args.connector_id);
      const tools = await toolList(client, connector); await check();
      return { connector_id: connector.id, status: 'connected', tools };
    },
  },
  {
    name: 'call_managed_mcp_tool', description: '使用当前电脑所属用户本人的身份调用已加载的托管 MCP 工具。数梦仅开放元数据、单条只读 SQL、日志和结果；内网页面检索仅开放公司 HTTPS 页面只读抓取，保留上游权限。',
    inputSchema: { type: 'object', properties: { connector_id: { type: 'string', enum: ['datadream', 'cooper', 'intranet-fetcher'] }, tool_name: { type: 'string' }, arguments: { type: 'object' } }, required: ['connector_id', 'tool_name', 'arguments'], additionalProperties: false },
    run: async (args, ctx) => {
      if (args.connector_id === 'intranet-fetcher') {
        const { connector, check } = await prepareIntranet(ctx);
        if (args.tool_name !== intranet.TOOL) throw new Error('mcphub 工具未授权');
        await check();
        const result = await intranet.callTool(args.arguments);
        await check();
        return result;
      }
      const { connector, project, client, check } = await prepare(ctx, args.connector_id);
      if (!connector.allowed_tools.includes(args.tool_name)) throw new Error('托管 MCP 工具未授权');
      const tools = await toolList(client, connector);
      if (!tools.some((tool) => tool.name === args.tool_name)) throw new Error('上游未提供该工具，请重新加载工具列表');
      const input = args.arguments;
      if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input)) > 65536) throw new Error('托管 MCP 参数无效或过大');
      if (connector.id === 'cooper') {
        validateCooperArguments(args.tool_name, input);
        await check();
        const result = await client.rpc('tools/call', { name: args.tool_name, arguments: input });
        await check();
        return result;
      }
      const parameterNames = {
        datamap_search_asset: ['bizTypeId', 'isSmartSearch', 'keyword', 'showTabs'], datamap_get_table_detail: ['uri'],
        get_hive_table_partition_page_list: ['pageCurrent', 'pageSize', 'partitionName', 'uri'],
        check_sql_syntax: ['sql', 'taskType', 'projectCode'], run_sql: ['sql', 'execQueue'], get_sql_log: ['taskId'], get_sql_result: ['taskId'],
      };
      if (Object.keys(input).some((name) => !parameterNames[args.tool_name].includes(name))) throw new Error('托管 MCP 参数未授权');
      if (args.tool_name === 'check_sql_syntax' && input.projectCode && input.projectCode !== project) throw new Error('projectCode 必须与本机个人绑定项目一致');
      if (args.tool_name === 'check_sql_syntax' && input.taskType && input.taskType !== 'SPARK_SQL') throw new Error('首版仅支持 SPARK_SQL');
      if (args.tool_name === 'run_sql' || args.tool_name === 'check_sql_syntax') assertReadOnlySQL(input.sql);
      if (args.tool_name === 'run_sql') {
        if (!connector.allowed_tools.includes('check_sql_syntax') || !tools.some((tool) => tool.name === 'check_sql_syntax')) throw new Error('上游 SQL 语法检查不可用');
        const checked = await client.rpc('tools/call', { name: 'check_sql_syntax', arguments: { sql: input.sql, taskType: 'SPARK_SQL', projectCode: project } });
        if (checked.isError || !syntaxPassed(checked)) return { isError: true, content: [{ type: 'text', text: 'SQL 预检查未确认通过，未提交执行。' }, ...(checked.content || [])] };
      }
      const parameters = args.tool_name === 'check_sql_syntax' ? { ...input, taskType: 'SPARK_SQL', projectCode: project } : input;
      await check();
      const result = await client.rpc('tools/call', { name: args.tool_name, arguments: parameters });
      await check();
      // 官方工具也可能将业务失败装进 isError:false；保留正文并提升显式失败。
      if (result.isError || decodedTexts(result).some((text) => /状态[：:]\s*失败/.test(text))) result.isError = true;
      return result;
    },
  },
];

function validateCooperArguments(name, input) {
  const fields = name === 'readContent' ? ['resourceId', 'appId', 'range'] : ['knowledgeId', 'parentResourceId', 'type'];
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Cooper 参数未授权');
  const id = name === 'readContent' ? input.resourceId : input.knowledgeId;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Cooper 文档或知识库 ID 无效');
  if (name === 'readContent' && ![2, 4].includes(input.appId)) throw new Error('Cooper appId 必须为 2 或 4');
  if (input.range !== undefined && (typeof input.range !== 'string' || input.range.length > 256)) throw new Error('Cooper 表格范围无效');
  if (input.parentResourceId !== undefined && (typeof input.parentResourceId !== 'string' || !/^[0-9]{1,128}$/.test(input.parentResourceId))) throw new Error('Cooper 父目录 ID 无效');
  if (input.type !== undefined && ![0, 1].includes(input.type)) throw new Error('Cooper 目录查询类型无效');
}

function syntaxPassed(result) {
  // 只接受明确成功标志，陌生响应不推断为可执行。
  const items = [result.structuredContent, ...(result.content || []).filter((item) => item.type === 'text').map((item) => { try { return JSON.parse(item.text); } catch { return null; } })];
  return items.some((item) => item && (item.valid === true || item.success === true || (item.code === 0 && item.data === true)))
    || decodedTexts(result).some((text) => text.includes('【SQL语法检查】') && /状态[：:]\s*通过/.test(text) && text.includes('SQL语法正确，无错误') && !/状态[：:]\s*失败/.test(text));
}

function decodedTexts(result) {
  return (result.content || []).filter((item) => item.type === 'text').map((item) => { try { const value = JSON.parse(item.text); return typeof value === 'string' ? value : ''; } catch { return item.text; } });
}

module.exports = { MANAGED_MCP_TOOLS, MANAGED_TOOL_NAMES, assertReadOnlySQL, openClient, validateConnector, ALLOWED };
