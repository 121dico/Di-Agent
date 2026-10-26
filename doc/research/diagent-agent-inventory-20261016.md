# Di Agent 智能体、运行时与交互现状核验
核验日期：2026-10-16（北京时间）。本报告只读代码与现有发布证据，未改产品代码、未执行新的业务查询、未部署。

## 1. 核验口径

本次主要读取已发布冻结候选 `.scratch/datadream-inline-20261016T034458Z/candidate`，不是把根工作区全部未提交改动视为线上。最新发布记录为 `datadream-inline-20261016T034458Z`、`active_verified`、Daemon 0.4.8。发布记录还明确：本次是有指纹的工作树快照发布，尚未完成 Git 整理，不能说代码仓库与线上全部一致。[doc/operations/releases/datadream-inline-20261016.md:3](</Users/didi/C/Di Agent/Di-Agent/doc/operations/releases/datadream-inline-20261016.md:3>)

成熟度用三种措辞：

- **有实现**：代码路径、接口、组件存在，不等于当前所有环境均可用。
- **有测试覆盖/发布证据**：有现存自动化记录或真实使用验收记录。
- **本轮未实测**：此次盘点没有重新连接每一种底座、重跑所有业务任务。

关于 AgentHub 来源：用户明确把 AgentHub 作为原始基础，但本地只看到 `origin`、`energy-tag-agent` 两个 remote 名称；本次对 README、架构与产品说明的检索没有找到可确认的 AgentHub 上游版本或可复现的精确差异基线。因而下文可称为“Di Agent 当前的特化形态”，**不能把每项现有能力都断言为相对 AgentHub 原创新增**。功能继承/新增归属需要指定原始上游仓库与 commit 后再做 diff。项目自己的 AGENTS 将其定义为 IM 式多 Agent 协作平台。[AGENTS.md:21](</Users/didi/C/Di Agent/Di-Agent/AGENTS.md:21>)

## 2. 产品底座已不只是一个网页聊天壳

当前形态是：网页/平台管理会话、配置和任务，本人电脑的连接程序发现并调用本地 Agent 运行时，运行过程及结果通过平台回传。平台服务端与本机执行端是职责分开的，但“职责分开”不等于后端数据库已经实现独立高可用集群。

Agent 使用的底座适配注册表实际包含：

| 适配器 | 源码状态 | 本次能确认的边界 |
|---|---|---|
| Claude Code | 已注册，支持持续会话、模型控制、图片输入 | 不能据此保证所有 Claude 版本/模型均实测 |
| Codex | 已注册，含 CLI/Desktop 运行时选择、app-server 路径 | 当前证据最完整的模型、强度、极速和审批适配 |
| OpenCode | 已注册 | 本次未进行真实运行验收 |
| OpenClaw | 已注册 | 本次未进行真实运行验收 |
| Zcode | 已注册 | 本次未进行真实运行验收 |

依据：[src/daemon-npm/cli/index.js:20](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/index.js:20>)。其中代码注释把未来 Gemini 作为扩展示例，**不代表 Gemini 已接入**。

### 2.1 电脑连接与 Desktop 识别

- 智能体页使用统一“连接电脑”弹窗，并允许已连接电脑进入升级流程。
- Codex 路径发现同时考虑本机安装、扩展目录及 Desktop runtime 路径；可明确选 CLI 或 Desktop，而不是因为“安装了 Desktop”就假设一定选对。
- 底座能力由连接程序扫描上报；版本/能力不满足时应明确禁用或提示，不假装已经配置成功。
- 最新数梦配置把安装/升级入口放回“智能体 → 连接电脑”，数据页只提示或导航，不重复放一套安装入口。

依据：[src/frontend/src/components/agent/AgentList.tsx:383](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/agent/AgentList.tsx:383>)；[src/daemon-npm/cli/codex.js:159](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/codex.js:159>)；[src/daemon-npm/cli/codex.js:286](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/codex.js:286>)；[src/daemon-npm/bin/di-agent-daemon.js:1572](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/bin/di-agent-daemon.js:1572>)；[doc/operations/releases/datadream-inline-20261016.md:9](</Users/didi/C/Di Agent/Di-Agent/doc/operations/releases/datadream-inline-20261016.md:9>)。

**成熟度判断**：连接程序与页面配置已是可交付功能，0.4.8 有真实线上验收；但仍依赖用户电脑在线、本地底座登录及本地公司安全代理，不是把所有用户凭据搬到服务器集中代用。

## 3. 对话体验的具体特化

### 3.1 Codex 风格输入底座

- 模型选择从所属 Agent 的目录读取，展示实际本地默认模型；提供重新扫描及扫描异常提示。
- 目录缺失时当前选择标记“待扫描确认”，而不是当成已经生效。
- 推理强度依据模型可用列表，极速依据 `supports_priority` 控制，切到不支持的模型会回落 default tier。
- 审批选择为“请求批准 / 帮我批准 / 完全访问”。
- 模型设置按“会话 ID + Agent ID”保存，避免 A 会话选择串到 B 会话。
- 附件上传及知识库材料从输入区操作；图像支持拖拽/粘贴，不仅是把文件名文本塞进 prompt。
- 侧边栏品牌图标采用固定位置，收起时默认显示品牌，hover/focus 才露出展开按钮；品牌文字单独布局。

依据：[src/frontend/src/components/chat/ComposerRuntimeControls.tsx:50](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/ComposerRuntimeControls.tsx:50>)；[src/frontend/src/components/chat/agentRuntime.ts:21](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/agentRuntime.ts:21>)；[src/frontend/src/components/chat/ChatInput.tsx:424](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/ChatInput.tsx:424>)；[src/frontend/src/components/shell/GlobalRail.module.css:20](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/shell/GlobalRail.module.css:20>)。

### 3.2 模型选择不止改 UI 文案

Codex 适配代码在 turn 参数里发送：

- `model`：选中模型；
- `effort`：推理强度；
- `serviceTier`：default/priority；
- `approvalPolicy`、`approvalsReviewer`、`sandboxPolicy`：对应审批与访问范围。

它还有请求模型、实际模型、请求强度、实际强度、请求 tier、实际 tier 的核验逻辑，不能仅以 dropdown 选中状态判断生效。CLI 后备路径也显式传 `--model`、`model_reasoning_effort` 和 priority 参数。模型错误策略限制只在生成前的明确模型拒绝场景重试，不把超时/限额/已执行任务任意重放。Claude 路径有单独 model-controls，不应把 Codex 的全套控制能力泛化到所有底座。

依据：[src/daemon-npm/cli/codex.js:103](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/codex.js:103>)；[src/daemon-npm/cli/codex.js:191](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/codex.js:191>)；[src/daemon-npm/cli/codex.js:475](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/codex.js:475>)；[src/daemon-npm/cli/codex-model-policy.js:1](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/codex-model-policy.js:1>)；[src/daemon-npm/cli/claude.js:550](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/claude.js:550>)。

**成熟度判断**：有真实运行参数链路和核验实现，不是纯装饰；本次盘点没有重新测试当前所有模型组合，不能列一份“所有型号都已跑通”的清单。极速是服务等级请求，不应承诺固定加速倍数。

### 3.3 审批已进入执行链路

审批不仅有 UI 卡片：后端审批对象绑定真实用户、会话、机器、任务；回答时检查 owner，连接程序确认写回运行时后再确认审批处理。请求可以保持 pending，不因前端点过按钮就假装工具已执行。

Codex full 映射为 never + dangerFullAccess；request/auto 是不同策略。**这仅是该 Agent 执行策略，不会增加 Hive/数梦/公司资源权限**。

依据：[src/backend/pkg/ws/daemon_hub.go:201](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/pkg/ws/daemon_hub.go:201>)；[src/backend/pkg/ws/daemon_hub.go:372](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/pkg/ws/daemon_hub.go:372>)；[src/daemon-npm/cli/codex.js:108](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/codex.js:108>)；[src/daemon-npm/cli/codex.js:671](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/codex.js:671>)。

### 3.4 回复下方复制、Fork、Pin

回复脚部提供复制、从此回复 Fork、回复、Pin 以及更多操作；流式未完成时禁用 Fork。Fork 后端并非仅复制文本到输入框，而是基于稳定 checkpoint 新建 Conversation 和 generation 1 Session，保存父对话/源消息/检查点/目标 Agent 关系，原分支不被改写。

依据：[src/frontend/src/components/chat/MessageFooterActions.tsx:34](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/MessageFooterActions.tsx:34>)；[src/backend/internal/service/conversation_fork.go:24](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/conversation_fork.go:24>)。

### 3.5 流式状态保留

消息状态是按 conversation 保存的 store，不只存在当前页面临时组件里。流式 block 被累积到占位消息；页面获取历史时保留尚未出现在服务器列表中的本地流式消息；完成/取消/错误使用服务端权威状态合并并清理运行标记。实现上已处理“切页面后丢渲染”“终态空正文不处理”“永远传输中”等典型问题。

依据：[src/frontend/src/hooks/useWebSocket.ts:84](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/hooks/useWebSocket.ts:84>)；[src/frontend/src/store/messageStore.ts:160](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/store/messageStore.ts:160>)；[src/frontend/src/store/messageStore.ts:362](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/store/messageStore.ts:362>)。

**边界**：这是前端状态合并和消息持久化的实现证据，不能据此声称任何网络中断、浏览器进程被杀或机器掉线都保证零丢失；需分别验证断线补偿与任务恢复。

## 4. 图片、文件和产物

### 4.1 图片真正到 Agent

服务器读取消息中合法图片附件，核对消息所属会话、上传路径与真实 MIME，并要求本地连接程序具有 `image_inputs_v1`。连接程序验证输入后，以底座要求的图像输入形式提交；Claude 使用多模态内容构造，Codex 也有持续会话图片路径。这不是仅把浏览器内图片 URL 当作可读图片。

依据：[src/backend/internal/service/image_input.go:25](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/image_input.go:25>)；[src/backend/internal/service/image_input.go:49](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/image_input.go:49>)；[src/backend/internal/service/image_input.go:61](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/image_input.go:61>)；[src/daemon-npm/bin/di-agent-daemon.js:3472](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/bin/di-agent-daemon.js:3472>)；[src/daemon-npm/cli/claude.js:530](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/claude.js:530>)。

### 4.2 Agent 生成图片返回平台

每轮任务有专用 image-outputs 目录和输出指引，运行结束收集图片产物。前端针对正文 Markdown 里的本地图片引用，使用同消息唯一且精确匹配的上传产物替换；找不到或有歧义就显示不可用，不盲目猜同名路径。点击图片默认弹窗预览，下载是额外按钮。受保护资源与外部图片的凭据策略不同。

依据：[src/daemon-npm/bin/di-agent-daemon.js:3420](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/bin/di-agent-daemon.js:3420>)；[src/daemon-npm/bin/di-agent-daemon.js:3502](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/bin/di-agent-daemon.js:3502>)；[src/frontend/src/components/chat/MessageImage.tsx:29](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/MessageImage.tsx:29>)；[doc/operations/releases/chat-image-20261013-281d835e.md:12](</Users/didi/C/Di Agent/Di-Agent/doc/operations/releases/chat-image-20261013-281d835e.md:12>)。

**实测证据**：10 月 13 日发布记录包含真实原对话的小鸭子和小鱼图片刷新后可预览，49 项图片回归测试通过。不是只看到了截图就宣称能回传。

### 4.3 文档、代码及交互产物

已有 PDF iframe 文档预览、PPTX 预览组件、HTML 默认预览/源码切换，以及 diff/project 产物协议。Agent 可以输出 plan、approval、progress、info、diff、project 卡片，由前端按协议渲染；平台根据 workDir/files 查询变更，不要求 Agent 把整个 diff 塞进正文。

依据：[src/frontend/src/components/chat/DocumentPreview.tsx:16](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/DocumentPreview.tsx:16>)；[src/frontend/src/components/chat/PptxPreview.tsx:1](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/PptxPreview.tsx:1>)；[src/frontend/src/components/chat/filePreview.ts:1](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/filePreview.ts:1>)；[src/backend/internal/service/context_agent_config.go:153](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/context_agent_config.go:153>)。

**边界**：预览依赖具体格式转换及可访问产物，不能宣称“所有 Office 文件均零损预览”。协议存在不代表每一个 Agent 都会稳定按协议输出。

## 5. 上下文、记忆与知识库

### 5.1 不是一个“本地 SQLite memory”概念

当前可确认至少分四层：

1. **平台持久记录**：Conversation、Message、Agent Session、Checkpoint 及 Fork 关系在后端 SQL 仓库保存。Conversation SQL 使用 PostgreSQL 风格参数和类型；仓库文档指定 PostgreSQL。
2. **本地底座会话**：Codex/Claude 等运行时保留各自 session/thread 状态，由本地连接程序管理。
3. **显式工作记忆**：Pin 黑板、checkpoint 摘要、导入/继续/Fork。
4. **知识材料**：知识库文件、提取文本、分块、向量/关键词检索和可选 reranker。

因此不要把“平台聊天历史在服务器数据库里”与“本地 Agent 原生 memory”混为一谈，也不能说所有历史文本都始终完整进入每次模型请求。

依据：[src/backend/internal/repository/conversation.go:13](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/repository/conversation.go:13>)；[src/backend/internal/service/orchestrator.go:244](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/orchestrator.go:244>)；[src/backend/internal/service/conversation_checkpoint.go:63](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/conversation_checkpoint.go:63>)；[src/backend/internal/service/knowledge_rag.go:21](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/knowledge_rag.go:21>)。

### 5.2 上下文按路径组装

直接回复、worker、orchestrator、fanout 和 summary 使用不同的 context chain；根据路径注入附件、Pin 黑板、知识库、绑定 checkpoint、Agent 自定义系统指令及工具/Skills 索引。不是无条件把所有资料全文推给模型。

检查点先保存可用兜底，再异步由 Agent 精炼；摘要有原始目标、已完成、当前状态、决策、约束、待完成、变更文件、测试状态、产物、开放问题。存在摘要失败 fallback 状态，不要求总结服务成功才保有可继续状态。

依据：[src/backend/internal/service/orchestrator.go:244](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/orchestrator.go:244>)；[src/backend/internal/service/conversation_checkpoint.go:63](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/conversation_checkpoint.go:63>)；[src/backend/internal/service/conversation_checkpoint_summary.go:51](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/conversation_checkpoint_summary.go:51>)。

### 5.3 当前页脚统计要准确描述

现在轻量页脚显示的是“聊天内容 X tokens”，明确只含当前对话用户输入与 Agent 公开回复，排除附件正文、系统指令、工具和推理内容；数据区分文本分词与估算，详细信息通过“检查点与详情”进入。

不能把这个数直接称为本次实际 API token、完整上下文窗口占用、账单 token 或全平台总记忆大小。用户历史要求过进度条，但当前这份页脚源码展示的是文本读数和详情入口，盘点不应照旧需求宣称页脚始终有窗口进度条。

依据：[src/frontend/src/components/chat/ContextUsageFooter.tsx:16](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/chat/ContextUsageFooter.tsx:16>)。

### 5.4 RAG 是可选真实实现，不是默认万能搜索

实现包含文件分块、embedding、候选 TopN、TopK、可选重排，索引状态有 indexing/failed/skipped；禁用或没有可提取文本时明确跳过。向量/重排失败有关键词回退；知识库引用会优先检索，失败转文件读取，超长材料提示通过工具读全文。

依据：[src/backend/internal/service/knowledge_rag.go:58](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/knowledge_rag.go:58>)；[src/backend/internal/service/knowledge_rag.go:106](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/knowledge_rag.go:106>)；[src/backend/internal/service/knowledge_rag.go:252](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/knowledge_rag.go:252>)；[src/backend/internal/service/context_kb.go:65](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/context_kb.go:65>)。

**成熟度判断**：有检索管线与降级行为；本次未读取生产敏感配置或重跑 embedding，不能承诺线上每个文件均已向量化，也不能把“知识库搜索”说成“已覆盖所有公司文档”。

## 6. Skills、MCP 与渐进式披露

### 6.1 Skills 三层

Agent Skills 页面明确区分本地 Skills、已分配 Skills、平台技能库，支持查看、分类、搜索、自定义、平台库导入和 GitHub 安装入口。配置注入包含本地技能索引与平台附加指令。

执行链路有工具/技能轨迹识别：仅凭路径出现在复杂命令里不冒充已加载；实际读取技能后可标记 loaded，平台传输副本会脱敏技能正文，本地运行时仍收到完整结果。

依据：[src/frontend/src/components/agent/AgentSkillsPanel.tsx:35](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/agent/AgentSkillsPanel.tsx:35>)；[src/backend/internal/service/context_agent_config.go:118](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/context_agent_config.go:118>)；[src/daemon-npm/cli/skill-trace.js:4](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/daemon-npm/cli/skill-trace.js:4>)。

### 6.2 内部资源逐步发现

常驻提示只告诉 Agent 有 `discover_internal_sources` 和 `get_internal_source_guide`：先看简短来源索引及真实接入状态，选中某个来源后再展开指南；按问题线索选路径，不强行固定“文档→代码→数据”。未接入来源不能声称检索过或获得权限。

托管 MCP 另有三步：`list_managed_mcps` → `get_managed_mcp_tools` → `call_managed_mcp_tool`。Agent 不需要预先被塞入全部服务器工具说明。

依据：[src/backend/internal/service/context_agent_config.go:125](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/context_agent_config.go:125>)。

### 6.3 数梦本机 MCP 的配置闭环

当前用户可在 Di Agent 页内填 Key/项目 Code；已保存 Key 不回显，留空表示保留；草稿关闭/切目标/成功后清理。一次性短期会话绑定本人、机器和 WebSocket，浏览器加密转发、本机保存。保存后真的做 MCP 握手与工具列表，分别报告“保存”和“验证”。

已发布 0.4.8 的真实验收为：旧客户端禁用输入；升级后启用；数字项目 ID 拦截；保留既有 Key、保存 epower_platform 后 MCP 验证成功；刷新保持；草稿清除；安装/更新入口归位；1440/1024/390 三种宽度检查。

**边界**：握手成功不证明所有项目和表可查询；本轮配置发布没有执行业务 SQL。当前还是“服务器统一编排 + 用户本机连接与身份”，不是服务器已替代每个用户完成公司安全认证。HTTP 页面的客户端加密不能防页面篡改，不能替代 HTTPS。

依据：[doc/operations/releases/datadream-inline-20261016.md:7](</Users/didi/C/Di Agent/Di-Agent/doc/operations/releases/datadream-inline-20261016.md:7>)；[src/frontend/src/components/knowledge/DatadreamConfigurationModal.tsx:51](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/frontend/src/components/knowledge/DatadreamConfigurationModal.tsx:51>)。

## 7. 与报表/部门工作流的结合

Agent 已有专门的真实报表提示及工具流程：发现源/字段能力→读取模板→真实查询→保存个人报表；不同图表可绑定不同 query_id，平台从真实查询凭证组装数据，不让 Agent 自填数字或伪造 data。对于已有 V1.2 大源，提示使用已核验预计算快照，不即时全表 COUNT DISTINCT。这个约束比“聊天里画一个看似正确的图”更接近业务交付。

同时明确两条通道不应混淆：

- 用户指定数梦/本机 MCP 查询，走托管 MCP。
- 平台报表数据源，走 discover/query/save 的受控契约。
- 旧 `probe_hive_data` 是已批准表的固定 dt LIMIT1 探测，**不是任意 SQL 通道**，不因上述新通道存在而升级其能力。

依据：[src/backend/internal/service/context_agent_config.go:21](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/context_agent_config.go:21>)；[src/backend/internal/service/context_agent_config.go:31](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/context_agent_config.go:31>)；[src/backend/internal/service/context_agent_config.go:126](</Users/didi/C/Di Agent/Di-Agent/.scratch/datadream-inline-20261016T034458Z/candidate/src/backend/internal/service/context_agent_config.go:126>)。

## 8. 一句话总结与仍需补齐

可以准确定位为：**在 IM 式多 Agent 基础上，已做出面向部门数据工作的 Agent 执行与交付平台——统一接本地底座、统一模型/审批/上下文体验、真实图像双向、平台技能与渐进 MCP、真实查询凭证和报表产物，而不只是换 Logo 的聊天页。**

仍不能过度宣称的地方：

1. 所有底座、所有模型、所有 OS 都经过当前版本实体验收。
2. MCP 已通就等于所有公司资源都具备权限。
3. 页脚聊天文本 token 就是实际完整请求/账单 token。
4. RAG 有代码就等于全公司的文档/代码已接入。
5. 审批“完全访问”能绕过公司数据权限。
6. 固定 Hive 探针能代表任意复杂 SQL 查询。
7. 用户本地安全代理已彻底迁移到服务器并具备多用户身份隔离。
8. Git HEAD 就代表线上全部发布内容。
9. 在没有原始 AgentHub 基线时，把每一项功能都统计成二次开发新增。
