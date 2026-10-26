# mcphub 内网页面检索：本机接入实测

日期：2026-10-20（北京时间）。用户指定用“内网页面检索”验证发现、安装、调用链路，并明确允许仅在本机复用 Chrome 公司登录态读取 mcphub；不上传 Cookie/令牌到 Di Agent 服务器。

## 结果

| 环节 | 实测 |
| --- | --- |
| 当前能力检查 | Di Agent 托管目录只有 datadream/cooper；数梦已有数据地图工具，内网页面检索尚未接入 |
| mcphub 服务发现 | 通过已登录 Edge 读取官方服务详情 `intranet-fetcher` |
| 安装配置 | 官方公司 npm：`@didi/intranet-fetcher-mcp`，本次固定 `4.1.1`，未直接执行浮动 latest |
| 隔离安装 | 安装于 `/tmp/diagent-intranet-mcp-check.op3jlq/package`；使用 `--ignore-scripts`，没有更改全局 Codex/Claude 或线上配置 |
| MCP initialize | 成功：server name `intranet-fetcher`，version `4.1.1` |
| tools/list | 成功：`fetch_intranet`、`screenshot_intranet` |
| tools/call | 调用 fetch_intranet 读取自身 mcphub 详情页，返回 `isError: true`，被重定向到公司 SSO 登录页 |
| 卡点 | 官方包 macOS 复用 Chrome 登录态；本机自动选中 Default，但该登录态未通过目标站点认证。Edge 中能访问不等于 Chrome 状态可用 |

## 来源与复现

- [mcphub 官方详情](https://mcphub.intra.xiaojukeji.com/square/intranet-fetcher)：stdio/npx 配置、仅本机使用、macOS Chrome 登录态复用。
- 公司 npm `http://npm.intra.xiaojukeji.com/` 返回版本 `4.1.1`；下载包及 README/source 用于核对，只读接口与实际 tools/list 一致。
- 下载包 integrity：`sha512-I0mxTuioHwyGRg9TgXBXldZnhmdda+3YHCkK6W19ElinoAqg1HJIFqpIK5Xdprl4Zd6173vWXlmVa26w962uOw==`。
- 本机测试脚本：`/tmp/diagent-intranet-mcp-check.op3jlq/package/verify-client.mjs`，通过 MCP SDK stdio 客户端真实握手与调用；未直接绕过 MCP 抓取目标页面。
- 测试 URL：`https://mcphub.intra.xiaojukeji.com/square/intranet-fetcher`，maxLength 2400。进程已正常关闭。工具错误不能被测试进程退出码 0 掩盖。

## 下一步与边界

不读取或迁移 Edge Cookie，不收集密码，不向服务器传递登录态。没有把 Di Agent 产品的动态目录搜索、任意 MCP 安装与多用户授权功能实现或发布。临时安装不是持久托管接入。

## Chrome 登录后复测

用户确认 Chrome 登录后，首次调用仍返回 SSO 重定向。通过 Chrome 界面确认 mcphub 目录可见，`chrome://version` 确认当前资料路径确为 Default；因此不能把该次失败简单归因于用户登错浏览器或配置目录。

随后同一 MCP、同一 URL、无认证配置和包源码改动的重试成功：返回 `MCP Hub Dashboard` 正文，含“内网页面检索”、`intranet-fetcher`、官方 npm 配置和 `fetch_intranet` 工具说明。测试脚本新增正文断言，检查 `isError` 与预期内容，退出码为 0，MCP 和浏览器已关闭。首次重试失败、后续成功符合登录状态刷新存在延迟的可能，但未收集证据证明具体落盘或传播机制，不作确定根因声明。

这证明本次“人工 Agent 在 mcphub 发现服务 → 本机隔离安装 → MCP 握手 → 使用本人 Chrome 登录态读取内网页面”链路成功。不是服务器部署成功，也不是产品已具备无人介入的动态安装能力。

再次独立启动同一 stdio 客户端复测成功，正文断言通过、退出码 0。连续两次成功后停止测试；没有修改上游包、扩大授权或保留浏览器进程，临时 Chrome 版本诊断标签已关闭。
