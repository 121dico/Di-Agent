# 本地 Skills 优先与调用透明化

## Goal
用户已要求直接实现：顶部紧凑 Agent 切换，默认展开本地真实技能，只同步用途和用法索引到服务端，正文/资源留在本机；每条 Agent 回复透明显示实际 MCP 和 Skill 使用，支持历史回放。保留现有入库、分配、保存、安装操作。

## Requirements
- 最新用户纠正：不要在回复正文补调用记录。回复只新增“查看执行链路”按钮，打开独立 Drawer/面板，按顺序浏览真实执行链路。优先独立抽屉，保留回复上下文，避免翻转动画和内容挤压。
- 去除 /skills 左侧大面积 Agent 列表，顶部可搜索选择 Agent，显示运行时身份；主体默认本地技能列表。
- 本地技能索引含 name、description、usage（如何本地加载/使用）、source_path，以及可获得的来源字段。自动上报不得含 detail 正文或资源；后端也要剥离旧 daemon 上报的正文，不再仅截断。通用能力不冒充文件 Skill。
- 服务端用索引帮助任务选择技能，Agent 在本机按名称加载完整技能。显式“入库”仍可保留为用户主动创建平台指令副本，准确说明同步的是索引而非技能包。
- 复用现有 tool_use/tool_result 事件和 blocks 持久化；可选元数据 tool_kind（mcp/skill/tool）、skill_name、server_name、source_path 三端一致。只有有可验证工具事件时才标记技能已加载/调用，不把模型 prose、推荐或技能目录当作使用证据。
- MCP 可看到服务/工具、输入、结果、成功/失败；Skill 可看到名称、来源、加载成功/失败。本地 Skill 正文不能借事件结果重新上传服务端，上传元数据/执行状态。
- 实时与刷新后的历史一致；旧事件兼容，未知类型显示普通工具，不能误报完成。
- 借鉴 DeepSeek Harness 的目录/懒加载/事件回放，不引入其运行时依赖。

## Acceptance
- 本地 30 个、平台附加 0 个时默认展示本地列表，搜索可命中本地 Skill，顶部选择器不会占左栏。
- 注册请求和后端存储不含本地正文；上下文含技能用途与本地加载说明；按名称的本地读取能访问全文而 trace 仅返回摘要元数据。
- 真实 MCP 与技能加载事件可看到类型、名称、进行中/成功/失败、展开详情，刷新后保持；无证据不制造 Skill 使用。
- 通过相关 Node/Go/前端行为测试、typecheck/build，实际产品正常用户路径验证。

## Implementation contracts
保留现有 JSON/event kind，追加可选工具元数据：tool_kind、skill_name、server_name、source_path。本地索引新增可选 usage；detail 不自动传输。根据 runtime 原始事件转换，不根据回复自然语言推断。
测试边界：daemon 扫描注册/本地 loader、事件转换、后端注册/上下文/streaming reducer、前端 reducer 与渲染。用户已授权实现所需验证。

## Scope
本地代码与集成验证；不替换整个 Agent runtime，不迁移其它无关模块。线上发布未明确要求。现有用户改动不纳入提交。

## References
- .scratch/skills-local-first-analysis.md
- research/deepseek-harness.md
- ui-brief.md

## Verification evidence
- [Backend, cross-language transport, and baseline test evidence](verification.md). Real UI acceptance remains in the task UI evidence; automated fixtures do not establish production execution.
