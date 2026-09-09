# Native token usage contract

- `TokenUsage.input_tokens` includes cache read/write; optional cache buckets are subsets. Reasoning is an output subset. Missing counts are unknown, never zero by default.
- Codex app-server creates a new thread in this adapter. Snapshot `total` deltas against the turn-start baseline provide turn consumption; `last.inputTokens` provides the last request input snapshot. Exec `turn.completed.usage` supplies turn totals only, not context capacity/current occupancy.
- Claude result usage is the main-loop turn aggregate. Assistant/message_start inputs and cumulative message_delta output provide explicitly partial samples; deduplicate API message IDs and never let assistant output placeholders replace final deltas. Subagent envelopes cannot replace main-loop context. Model capacity comes from matching modelUsage contextWindow.
- `usage` AgentEvent becomes a single metadata MessageBlock, updated by observation time even after terminal events. It must not split text/thinking deltas, appear in reply prose, or count as a tool/trace event. Validate before broadcast and in both reducers.
- task.complete repeats the final token_usage so buffer flush timing cannot drop it. `agent_token_usage.task_id` is an idempotency key, not an FK: daemon tasks are in-memory. Context picks latest observation, while totals sum unique task snapshots across generations. Incomplete/unknown tasks retain incomplete coverage.
- Character estimates cover submitted platform input only. They cannot supply actual context percentages or true consumption. Capacity absent means unknown; never infer a window from CLI name. Current context reflects the last measured input, not prediction of next assembled request.
- Tests: CLI public parsing, shared reducer interleaving/terminal/malformed events, context service scope separation, PostgreSQL replay/late-arrival test with `DI_AGENT_TEST_DATABASE_URL` pointing to an isolated migrated DB, UI missing-vs-zero and real request/reload path.

## 聊天文本与模型初始化（2026-09-09）
- `my_messages` 单独统计认证用户可见输入、各 Agent 的公开回复；查询覆盖全部历史，排除隐藏、撤回、未完成流消息。Assistant 身份兼容 sender_id 与 artifacts_json.agent_id。
- 每条完整消息的 text blocks 按当前已确认模型词表重新分词；不按流式 delta 累加。排除 thinking、工具、附件正文和模板。文本 token 与计费 token、完整上下文压力不是同一指标。
- DeepSeek V4 Pro/Flash 使用固定官方词表，记录校验摘要。未知模型/运行时不可用标估算，字符量独立提供。Python 分词并发最多2，8秒超时，32批只存摘要及计数缓存。
- `agent_model_runtime` 分开 configured_model（候选）和 observed_model（原生请求确认）；窗口仅接收运行器数据。配置事件与原生事件来自不同机器，待确认状态不能因服务器时钟领先而拒绝真实观察。
- Codex 保存并恢复真实 thread ID，模型/推理层级切换不清空会话；旧兼容 UUID 恢复失败时仅用完全匹配 Agent/对话的日志真实 ID 重试，尚未发送提示，不能重复执行请求。无证据则保留历史并提示检查点续接。
