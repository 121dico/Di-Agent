# Di Agent 公司能力接入：官方目录与授权契约核查

核查日期：2026-10-20（北京时间）。本次按 `ask-matt` → `research` 只读调查；通过现有 Di Agent Cooper 桥读取明确的一方文档，没有修改公司配置、创建 Agent、申请权限、调用公司写工具或控制浏览器。仅新增本笔记。

## 结论

**可以复用的是公司 Agent Identity / MCP HUB 的注册、路由与授权体系，不是一个叫“数小智”的万能 MCP。** 数小智只是这一体系的调用方之一。Di Agent 可使用自己的产品名称，例如“公司能力接入”，保留来源、服务标识、授权与接入状态；不能把数小智的后台凭据或登录态当作 Di Agent 的身份。[Agent Identity 定义](https://cooper.didichuxing.com/knowledge/2208286682877/2207872693517)、[司内 MCP 接入](https://cooper.didichuxing.com/knowledge/2199579337142/2209268754504)

**本次仍未找到可供第三方直接调用的全公司目录搜索 API 或“目录 MCP”的正式契约。** 已读取的《开放接口说明》列出 Agent 注册、用户令牌、MCP 注册、验签和权限申请跳转，不包含目录查询接口；这只是本次文档范围内的未发现，不能证明公司没有该接口。[开放接口说明](https://cooper.didichuxing.com/knowledge/2208286682877/2208330672493)

已核实的调用链足以支撑“选定一个可信服务 → 自动配置接入 → 真实握手 → 加载工具”，但**不能据此宣称已经支持自动搜索任意公司 Agent/MCP**。自动发现仍需可信目录来源及其访问契约。

## 已核实事实

| 问题 | 官方证据与边界 |
| --- | --- |
| 数小智从哪里发现 MCP？ | 从 Agent Identity 应用广场按 `interfaceName/interfaceCode` 搜索，选中后回填连接方式和标识。MCP HUB 的服务未必注册 AID，测试记录可能重名；不能随便取同名首项。[司内 MCP 接入](https://cooper.didichuxing.com/knowledge/2199579337142/2209268754504) |
| 公司 Agent 与 MCP 是同一种条目吗？ | AID 注册中心覆盖 Agent、MCP、OpenAPI；注册 Agent 文档固定 `interfaceType=1`。发现 Agent 不等于发现一个可按 MCP 初始化的服务，需目录类型与调用契约。[工作原理](https://cooper.didichuxing.com/knowledge/2208286682877/2208316364562)、[Agent 注册](https://cooper.didichuxing.com/knowledge/2208286682877/2208364107577) |
| 本机如何接入已知 MCP？ | 本人安全助手提供身份，个人 API Key 提供委托权限；目标 URL 是 `http://127.0.0.1:28582/v1/{service_code}/{interface_code}`。MCP HUB 代理的 `service_code` 为 `hub`。仍须目标 MCP 自己的正式配置，不能仅猜接口名。[用户手册](https://cooper.didichuxing.com/knowledge/2200742351021/2207430497329)、[快速接入](https://cooper.didichuxing.com/knowledge/2208286682877/2207874821331) |
| SDK 会自动发现公司 MCP 吗？ | 官方 Node.js SDK 提供 `AidGatewayMCPClient.listTools/callTool`、会话握手与重连，但这些针对已指定服务；其 §7 明确 `GatewayRoutes` 不会自动发现或更新映射，由宿主平台维护。不能把单个 MCP 的 `tools/list` 说成公司服务搜索。[Node.js SDK](https://cooper.didichuxing.com/knowledge/2208286682877/2208353772749) |
| 能不能把 Di Agent 的 Agent 注册到公司？ | 有 Agent 平台同步接口，负责注册、更新、删除自己的 Agent 并取得凭据，需要项目凭证签名。这是管理写操作，不是查询或安装其他公司的 Agent，本次没有调用。[Agent 注册](https://cooper.didichuxing.com/knowledge/2208286682877/2208364107577) |
| 云端服务器能复用本机方式吗？ | 不应直接搬个人本机令牌。官方云端模式区分“人+应用+Agent”“人+Agent”和纯 Agent，需要对应项目/SSO 凭证、可信关系、用户 ticket/token 与 Agent API Key。SDK 当前从 AID 响应的 `routeContext.gatewayService` 取路由，不应硬编码旧网关代替。[快速接入](https://cooper.didichuxing.com/knowledge/2208286682877/2207874821331)、[Node.js SDK](https://cooper.didichuxing.com/knowledge/2208286682877/2208353772749) |

## 权限申请可直接衔接，但不自动批准

官方提供生产环境申请页的预填格式：

```text
https://agent-identity.intra.xiaojukeji.com/user/home/apply
info=(serviceCode[目标项目标识])(type[1])(subject[当前本人用户名])
```

实现时将 `info` 正确 URL 编码为 query 参数。`type=1` 是为当前登录人的个人访问令牌申请，只保留等于当前用户的用户名；`type=2` 才是为 Agent 的 `interfaceCode` 申请。这个链接仅预填申请表，用户还需选择令牌并确认 BPM 申请，不代表已获目标数据权限。不得填入明文 API Key。[权限申请跳转说明](https://cooper.didichuxing.com/knowledge/2208286682877/2208925200294)

## 建议给 Di Agent 的最小接入步骤（工程推论）

1. 从有来源与更新时间的正式目录项获得类型、名称、`serviceCode/interfaceCode`、生产/测试环境及配置要求；第一版可使用受审核服务目录，明确不是公司实时全量搜索。
2. 对 MCP 条目按本人选择建立连接，不安装公司服务端程序；继续使用当前本机安全助手代理和本地个人凭据，避免把令牌上传平台。
3. 初始化并读取工具清单；只有真实成功后才保存“已接入”。工具发现、调用权限、业务数据权限分别判定，不把前一步成功当作后一步成功。
4. 未授权时给出官方申请入口，不尝试换身份或绕过权限。未知生产状态、缺必填业务头、非 MCP 类型均不得自动启用。
5. 工具权限与撤销仍按用户隔离；单独审核有写副作用的工具，不能把公司目录导入等同于授权任意工具执行。

以上是基于官方契约的工程建议，不是本次已经实现或部署的结果。

## 实测与未决项

- 主线程另通过用户已登录的 Edge 只读打开 [MCP HUB 广场](https://mcphub.intra.xiaojukeji.com/square)。2026-10-20 页面显示 544 个服务，具有名称/作者/描述/标签搜索、分类、分页；实际搜索 Cooper 返回一个条目，说明其已升级集团统一 AI 认证。这证明公司已有可浏览的服务目录，但不证明存在第三方目录 MCP 或开放搜索 API。未点击访问令牌、未创建凭据、未安装服务，也未复制浏览器登录态。

- 已通过现有 `get_managed_mcp_tools(cooper)` 真实加载 `readContent`、`getKnowledgeDirectory`，并成功读取本笔记引用的正文；没有调用其余上游写工具。
- 对已知 AID 知识库 `2208286682877` 的根目录读取返回文本“无权访问该资源”，尽管 MCP `isError=false`。因此结果成功需检查业务语义，不能只看传输或 `isError`；本次没有继续扩大目录读取。
- 尚缺：第三方目录搜索/分页/详情的正式 URL、方法、响应 schema、身份凭证类型、权限边界、配额和生产服务判定规则。数小智私有前端的 `intranetCatalog` 线索不是第三方公开 API 合同，不能据此复制会话或绕过其宿主身份。历史一方前端证据见[前次笔记](./shuxiaozhi-company-identity-local-evidence-20261019.md)。
- 尚缺：若要“发现并调用公司 Agent”而非 MCP，需该 Agent 的协议、输入输出、调用授权与等待/任务状态语义，不能自动把所有 AID Agent 当 MCP Server。
- 尚缺：如果要求 daemon 不在线时仍能在服务器执行，需正式云端 AID/SSO 注册与委托链；本机既有 Cooper 成功不能证明服务器权限已开通。

## 阅读范围

除上列来源，本次读取了 [AID 帮助索引](https://cooper.didichuxing.com/knowledge/2208286682877/2208264008908)、[开发者指南](https://cooper.didichuxing.com/knowledge/2208286682877/2208264459820)、[SDK 索引](https://cooper.didichuxing.com/knowledge/2208286682877/2208264503873)、[办公终端入口](https://cooper.didichuxing.com/knowledge/2208286682877/2208412643871) 和[内部测试中的云端 Endpoint Adapter](https://cooper.didichuxing.com/knowledge/2208286682877/2208492343668)。后者是运行环境 URL 改写机制，不是公司服务目录发现器，也未安装。未保存文档全文、截图签名 URL 或任何凭据。

## 补充：以“数据地图”为例检查现有能力（2026-10-20）

本节仅检查本地源码和已有发布记录，未调用业务查询、安装服务或修改配置。当前本机安装包 `package.json` 是 **0.4.11**；不能继续把昨日 0.4.10 发布记录当作当前版本证明，也未据此推断服务器当前版本。

- **数据地图不一定缺失。** 当前本机 `/Users/didi/.di-agent/node_modules/di-agent-daemon/cli/managed-mcp.js:6` 已将 `datamap_search_asset` 和 `datamap_get_table_detail` 列入数梦白名单，`:205` 定义对应允许参数；昨日发布候选服务端也明确包含这两个工具。它们分别对应资产搜索、表详情。实际个人权限和查询效果仍需主线程通过 `get_managed_mcp_tools(datadream)` 与最小只读查询验证，不能仅凭源码宣称业务可用。[候选服务端:23](../../.scratch/managed-mcp-20261019T095454Z/candidate/src/backend/internal/handler/managed_mcp.go#L23)、[候选客户端:6](../../.scratch/managed-mcp-20261019T095454Z/candidate/src/daemon-npm/cli/managed-mcp.js#L6)
- **当前“发现”仍不是公司目录搜索。** 安装版 `managed-mcp.js:154` 仅对服务器提供的 `datadream/cooper` 目录按关键词过滤；`:166`、`:184`、`:189` 的连接器 schema 均只有这两项。`:18` 起验证固定本机 endpoint 与允许工具，未实现 MCPHub/AID 实时目录适配。[候选同实现:154](../../.scratch/managed-mcp-20261019T095454Z/candidate/src/daemon-npm/cli/managed-mcp.js#L154)
- **当前“接入”是启用经过审核的已有连接器。** `set_managed_mcp_enabled` 先握手取工具列表，再保存本人作用域的启用状态；不接受任意 URL 或安装命令，不下载新 MCP 服务端，不把上游凭据发送到平台服务器。[候选实现:165](../../.scratch/managed-mcp-20261019T095454Z/candidate/src/daemon-npm/cli/managed-mcp.js#L165)、[已有发布与权限范围](../operations/releases/managed-mcp-cooper-20261019.md)
- **版本来源须区分。** 根 `src/daemon-npm/cli/managed-mcp.js` 和 `src/backend/internal/handler/managed_mcp.go` 仍为更旧的单数梦实现；发布记录明确线上完整源码保存在候选目录，根工作区并非完整线上版本。因此不能用根源码否认已上线的 Cooper，也不能全量覆盖部署。

若本次真实数梦工具发现与查询成功，准确结论应为“复用了已经接入的数梦数据地图能力”，不能记为“从 MCPHub 自动找到并新安装了数据地图”。真正测试缺能力后的动态安装，需要选取尚未接入且有可信官方配置、本人授权的独立 MCP，并补齐动态目录与接入实现后再验收。
