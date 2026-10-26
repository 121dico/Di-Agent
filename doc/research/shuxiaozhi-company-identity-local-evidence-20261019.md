# 数小智与公司系统身份：Di Agent 本地证据

调研日期：2026-10-19。第一阶段只读取本地源代码和项目文档；第二阶段补充公司一方公开静态前端资源的只读 GET 与文本分析，详见末节。没有读取真实凭据、执行下载的 JS 或发送 Agent 任务。按 ask-matt 路由使用 research 流程，仅新增本笔记。已确认 `docs/agents/issue-tracker.md`、`docs/agents/domain.md` 存在；根目录 `CONTEXT-MAP.md` 和相关模块领域文档在本次定位中未发现，按领域布局说明继续。

## 结论与证据边界

Di Agent 已有“当前任务用户 → 所属电脑 → 本人本机安全助手 → 数梦 MCP”的接入链路。此证据说明 Di Agent 如何调用数梦，不能证明“数小智”内部采用什么模型、身份委托协议、数据接口或状态查询方案。本次在 `src/`、`doc/`、`docs/` 和下述冻结候选源码中检索 `数小智|shuxiaozhi` 无命中；“未找到”仅限这些本地材料，不等于该公司产品不存在相应能力。

本地根 `src/` 与历史发布候选不是同一版本：2026-10-16 发布记录另有页内配置能力和冻结候选 `.scratch/datadream-inline-20261016T034458Z/candidate`。本笔记分别标明来源，不以根源码或历史发布记录代替当前线上检查。[发布记录:3](../operations/releases/datadream-inline-20261016.md#L3)

## 已具备的代码能力

1. **显式工具接入。** 服务端托管目录目前只注册 `datadream`，用途是 Hive 元数据、只读 SQL、日志和结果；执行位置为 `user_local`，地址固定为本机 `127.0.0.1:28582`。代码没有注册一个通用公司业务状态连接器。[managed_mcp.go:9](../../src/backend/internal/handler/managed_mcp.go#L9)、[managed-mcp.js:4](../../src/daemon-npm/cli/managed-mcp.js#L4)

2. **两层不同身份边界。** Di Agent 目录入口只接受带用户归属的单机 Bearer API key，并要求请求 `user_id` 等于该机器所属用户；daemon 调用时使用当前运行上下文的 `userId`。数梦侧另使用个人 API Key 和项目 Code 向本机代理发起 MCP 请求。因此平台登录身份、机器身份与上游公司数据授权不能混为一谈。[daemon.go:89](../../src/backend/internal/handler/daemon.go#L89)、[data_map.go:18](../../src/backend/internal/handler/data_map.go#L18)、[di-agent-daemon.js:5057](../../src/daemon-npm/bin/di-agent-daemon.js#L5057)、[managed-mcp.js:98](../../src/daemon-npm/cli/managed-mcp.js#L98)

3. **个人凭据保留本机。** 凭据加载实现支持进程环境，macOS 钥匙串，以及受权限检查的 Unix 本地配置；代码说明需要本人登录安全助手“智能体安全”。这是源码中的设计，未读取任何个人配置或钥匙串。[managed-mcp-credentials.js:6](../../src/daemon-npm/cli/managed-mcp-credentials.js#L6)、[managed-mcp-credentials.js:23](../../src/daemon-npm/cli/managed-mcp-credentials.js#L23)

4. **发现、配置、连接、业务执行分层。** `list_managed_mcps` 仅返回 `setup_required` 或 `configured_unverified`；`get_managed_mcp_tools` 真正初始化 MCP 并请求工具列表后才返回 `connected`；调用阶段重新查目录、重新握手，并校验工具白名单。SQL 还需单条只读检查和上游语法预检查。连接成功不能推导所有项目和表均获授权。[managed-mcp.js:116](../../src/daemon-npm/cli/managed-mcp.js#L116)、[managed-mcp.js:130](../../src/daemon-npm/cli/managed-mcp.js#L130)、[managed-mcp.js:147](../../src/daemon-npm/cli/managed-mcp.js#L147)

5. **存在页内配置发布证据。** 2026-10-16 发布记录称支持短期会话绑定用户、电脑和 WebSocket，加密转发个人凭据，并在保存后独立验证 MCP；该次明确没有执行业务 SQL，不能宣称全部表权限通过。冻结候选服务实现会在动作前后核对机器 owner，并约束 `connected` 必须有 identity 验证结果。该记录属于历史验收，非本次实测。[发布记录:9](../operations/releases/datadream-inline-20261016.md#L9)、[发布记录:19](../operations/releases/datadream-inline-20261016.md#L19)、[候选 managed_mcp_setup.go:84](../../.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/managed_mcp_setup.go#L84)、[候选 managed_mcp_setup.go:203](../../.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/managed_mcp_setup.go#L203)

6. **Boss 登录适配与数据授权分离。** `bossauth` 明确“不假设或实现 Boss 原生 OAuth/SSO 协议”。它检查可信代理网络、专用秘密头、身份头和允许用户，生成 Di Agent 自身会话 JWT；状态页明确服务可访问不代表公司登录已打通。源码没有证明向任意下游公司系统交换用户授权令牌。[config.go:1](../../src/backend/internal/bossauth/config.go#L1)、[boundary.go:69](../../src/backend/internal/bossauth/boundary.go#L69)、[boundary.go:105](../../src/backend/internal/bossauth/boundary.go#L105)、[status.go:58](../../src/backend/internal/bossauth/status.go#L58)

## 尚不能证明、或接入新状态查询时仍需补齐

- **数小智自身实现与授权链条：未知。** 需数小智官方产品文档、实际工具清单、接口契约或其负责人的说明；Di Agent 的数梦桥接不能充当数小智实现证据。
- **任意公司系统状态查询：未见通用实现。** 当前托管白名单只有 7 个数梦工具，其中 `get_sql_log`、`get_sql_result` 是 SQL 任务日志和结果查询，不能直接称为工单、审批、发布等业务状态接口。增加具体系统需要该系统提供可调用的只读工具/API、业务对象标识和状态字段契约，以及对应个人或委托授权。[白名单与参数:154](../../src/daemon-npm/cli/managed-mcp.js#L154)
- **通用身份委托/OBO：未获证实。** 当前代码能证明的是“机器 owner 校验 + 本机个人 Key + 安全助手代理”；上游代理如何将 Key 映射成公司身份、如何审计/撤销、是否存在 token exchange，不在这些源码中，应向公司身份/目标系统文档求证。[请求头:99](../../src/daemon-npm/cli/managed-mcp.js#L99)
- **此刻可用性：未验证。** 源码与历史发布记录无法证明今天安全助手在线、个人登录有效、目标系统有权限，或线上运行产物与候选一致。此结论不需要读取密码；后续可通过授权的连接健康检查、工具清单和最小只读请求分别验证。

说明：文内 `#L数字` 为源码行号定位约定；路径均相对本笔记所在目录。未修改业务代码、配置、原有文档或部署状态。

## 补充：数小智一方前端与 MCP HUB 证据

这一节补充的是数小智自身一方部署的前端 JS，证据强于从 Di Agent 反推，但仍仅能确认前端契约和界面支持，不能证明后台授权实现。以下“行”来自原始压缩资源；同时给出检索锚点以便定位。只下载入口 chunk map 明确引用的 7 个异步资源，未调用 MCP 管理接口、未保存配置、未启动任务。

- **宿主传入身份与项目上下文。** `home.js` 第 58 行、模块 `103946` 的 `getBaseInfo` 返回 `sessionId/projectId/projectCode/username(realUserId)/isProjectAdmin` 等，`getDynamicInfo` 返回已打开/可见标签、最近修改文件；同模块含文件读写和编辑器交互工具。SDK 的 `ConfirmLogin`、`LoggedIn` 事件见 `vendors.js` 第 317 行。这能证明宿主有上下文与工具桥，不能证明仅传 `username` 就获得下游数据权限。[宿主源码](https://img-ys011.didistatic.com/static/bp_fe_prod/data_studio_fe_big_data_web_platform/home.09bf353bba382b325034.js)、[SDK 源码](https://img-ys011.didistatic.com/static/bp_fe_prod/data_studio_fe_big_data_web_platform/vendors.3745502cf393484c4907.js)

- **确有公司 MCP HUB 目录接入。** `8533.c57af162.async.js` 第 9 行包含 `/ai-service/dia/mcp/list`、`detail`、`count`、`intranetCatalog`、`saveOrUpdate`、`delete`。目录请求参数为 `keyword/pageNum/pageSize`；列表可按 `spaceId/source/platformType/scene` 选择，接受数组或 `list` 响应。目录项用 `serviceCode::interfaceCode` 唯一定位，字段包含 `serviceName/serviceCode/interfaceCode`。界面支持从司内目录逐一导入，自动填充 Streamable HTTP 与服务/接口标识；说明文字明确 Headers 留空使用 MCP HUB 默认鉴权配置。[MCP 管理源码](https://img-ys011.didistatic.com/static/bp_fe_prod/data_studio_fe_chat_dia/8533.c57af162.async.js)

- **工具元数据不是固定几个按钮。** 同一资源第 9 行、锚点 `W.tools` 和 `se.inputSchema`：详情提供 `tools/resources/prompts` 三组；工具包含 `name/description/inputSchema`，展示参数名、描述和 required；资源展示 `uri/mimeType`；prompt 展示 arguments。保存字段包含 `serviceName/serviceCode/interfaceCode/interfaceName/transportType/serviceUrl/source/platformType/status/headers`，并调用 `McpServiceClient.initializeMcpServers({})`。这是“注册目录 → 获取元数据 → 初始化连接”的前端证据，未获取任何实际目录响应，也没有确认当前用户能使用哪些工具。[MCP 元数据与初始化源码](https://img-ys011.didistatic.com/static/bp_fe_prod/data_studio_fe_chat_dia/8533.c57af162.async.js)

- **有系统、个人和项目来源及个人开关。** 管理代码含 `SYSTEM/PERSONAL/PROJECT` 来源、当前项目变化后的 MCP 重新初始化，以及“开启/禁用只对本人有效”的提示。个人服务支持 URL + Headers、SSE / Streamable HTTP；这些表明产品有接入与作用域配置，但作用域如何在后台强制执行仍未知。[来源与接入设置源码](https://img-ys011.didistatic.com/static/bp_fe_prod/data_studio_fe_chat_dia/8533.c57af162.async.js)

- **有 MCP 调用审批与执行事件展示。** `3646.ec503a60.async.js` 中 `use_mcp_server` 支持 approve/reject；区分 `use_mcp_tool` 和 `access_mcp_resource`，消息字段含 `serverName/toolName/arguments/uri`，处理 `mcp_server_request_started/mcp_server_response/mcp_notification`。这是工具执行过程可观测性的前端证据，不等于已内置任意工单、审批单、发布单状态查询工具。[调用事件源码](https://img-ys011.didistatic.com/static/bp_fe_prod/data_studio_fe_chat_dia/3646.ec503a60.async.js)

- **实际工具名称线索。** 入口 `umi.fc209f6a.js` 中有 `mcp__dclaw__queryTableMeta/nl2data/sql2data/datainfer/tavilySearch/getWeatherOrEventData` 和 `mcp__cooper__` 前缀；`5530.f83cd9aa.async.js` 中有 `StudioSystemMcp::datamap_get_table_detail`、`check_sql_syntax` 的 SQL 工作流文本。它们证明这些名称在当前前端产物中被支持或引用，不能据此保证后端已启用、工具全集或本人权限。[入口工具命名](https://img-ys011.didistatic.com/static/bp_fe_prod/data_studio_fe_chat_dia/umi.fc209f6a.js)、[SQL 工作流资源](https://img-ys011.didistatic.com/static/bp_fe_prod/data_studio_fe_chat_dia/5530.f83cd9aa.async.js)

**能否复用公司 MCP HUB：** 一方前端已经证明存在可复用的司内服务目录与标准 MCP 传输入口，Di Agent 可据此评估接入，而无需为每个能力重新实现业务逻辑。但尚未拿到 HUB 面向第三方客户端的正式接口与授权契约，也没有验证 Di Agent 运行位置的网络、本人服务授权和执行身份。不能从“默认鉴权配置”推断为共享账号、用户凭据透传、OAuth OBO 或免登录；这些均需 HUB 的官方契约或受控只读验收确认。任意业务状态查询仍取决于目录中是否存在目标系统工具、其字段与权限。

**本次边界：** 主代理另确认官方手册入口为 [数小智手册](https://cooper.didichuxing.com/knowledge/2199579337142/2207572948798)，但只获得应用壳，未读正文；浏览器工具超时，没有登录态 UI 验收。主代理一次 `datamap_get_table_detail({uri:'epower_platform.home_charge_user'})` 返回“未找到该表”，不能据此断定表不存在或权限已通过。未查询更多业务数据。本节静态副本位于 `/tmp/shuxiaozhi-research.SukBbN/`，临时目录非永久存档，引用以一方带内容哈希 URL 为准。

## 后续实证补充（2026-10-19，取代上述“正文未读/此刻未验证”的时点结论）

- 已在本人登录的浏览器读取官方 [MCP 能力与定义](https://cooper.didichuxing.com/knowledge/2199579337142/2207622640205)、[司内 MCP 接入](https://cooper.didichuxing.com/knowledge/2199579337142/2209268754504) 及 [AI 身份认证用户使用手册](https://cooper.didichuxing.com/knowledge/2200742351021/2207430497329) 正文。
- 数小智的司内选择器当前显示 239 项；官方说明目录来自 Agent Identity，不等于 MCP HUB 全量服务。页面可见不代表个人有所有服务调用权限。本轮未向数小智保存任何连接。
- 数小智司内使用其受管身份入口；本地 Agent 需本人个人令牌与安全助手。官方 Cooper 配置为 `http://127.0.0.1:28582/v1/hub/cooper_mcp`，Authorization Bearer；没有数梦 project-code 要求。不能把数小智的默认后台身份直接复制到第三方平台。
- 用户授权 Cooper 作为首个新增 MCP，许可复用本人现有个人令牌，只读验收且不上传令牌。实际 official proxy 初始化、工具列表和上述《司内 MCP 接入》正文读取成功。
- 已在部署版 Di Agent 上，以本机 Codex/Claude 两个 Agent 身份通过同一 stdio 桥读取指定文档；撤销后下一次工具调用拒绝，重连成功。仅开放 `readContent`/`getKnowledgeDirectory`，上游写工具未暴露、未调用。数梦仍可列出原 7 个允许工具。
- 本轮实现的是经过审核的 Cooper 接入适配，不是 239 项目录的通用导入。第三方应用目录合同、更多连接器和写操作审批仍未实现。详见 [发布记录](../operations/releases/managed-mcp-cooper-20261019.md)。
