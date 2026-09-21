# 本地模型目录与 Default 调用恢复

## 用户行为
- 消息中点击模型按钮，按当前 Agent 的归属机器和 CLI/Desktop 版本扫描原生目录；Default 常驻，支持重新扫描。
- Codex 显示模型支持的推理强度，Claude 显示本地配置后的别名与名称。扫描失败保留当前选择和最后成功目录。
- 系统 Agent 沿用现有可访问范围；其它用户的私有 Agent 不可扫描。

## 接口与协议
`GET /api/agents/:id/models` 返回 `models`、`default_model`、`source`、`scanned_at`，不包含认证或账号信息。
模型项包含 `id`、`label`、`is_default`、`reasoning_efforts`、`default_reasoning_effort`、`supports_priority`；Claude 可包含 `resolved_model`。
后端要求 `model_discovery_v1`，通过已记录机器归属的内部任务 `__di_agent_list_models__` 查询，结果超时清理 promise；扫描不进入业务任务看板。
Codex 查询 `model/list`（分页）及 `config/read` 的 model 字段；Claude 只进行 stream-json initialize。扫描不启动用户 turn。

## Default 修复与恢复边界
Go 的 `model,omitempty` 曾让 Default 的空字段在传输中消失，旧 daemon 将 undefined 当成不支持的模型。现在后端发送空字符串，同时 daemon 和前端兼容缺失、空值和 default 别名。
静态模型白名单改为安全的标识符校验，模型能力由本机原生目录决定。Default 保留本地配置中的隐藏/自定义模型，不把列表首项推测成默认值。
Codex 同一原生会话支持切换回本地默认；仅在无 turn ID 的明确模型拒绝时刷新目录并最多恢复一次。先使用未被拒绝的本地默认，再考虑目录声明的默认；权限和沙盒不变。
Claude 用原生 set_model 切换；仅明确的模型参数拒绝允许在发送用户消息之前恢复 Default。旧目录缓存不否决新扫描模型。
网络、认证、限额等外部故障仍可能失败，执行中的任务不自动重放。

## 验证
- 回归覆盖 Go 真实缺字段形状、空对象、动态模型、原生目录分页/空结果/超时、敏感字段过滤、旧响应隔离、失败保留目录、任务归属与扫描不写业务看板。
- 实测线上 Desktop/CLI/Claude 的模型目录，Default Desktop 在原报错对话返回“默认模型调用成功”。其它人机验收记录见本任务工作目录。
- 全量前端：399 通过，2 个既有相关性外失败（SkillsView Router、reportV12Presentation NaN）。全量 backend 的 ServeSite traversal 测试在当前环境返回 404 而非期望 403；本次相关 service/handler 测试通过。

参考：https://learn.chatgpt.com/docs/app-server （原生 model/list）
