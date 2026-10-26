# Di Agent 报表与投放分析现状核验

核验日期：2026-10-16。此文只读源码、发布记录与既有验收证据，没有执行新业务 SQL、没有修改或部署产品。

## 证据口径

- 报表主应用以冻结生产候选 `.scratch/datadream-inline-20261016T034458Z/candidate` 为源码依据。下文 `C/` 指此目录，路径均相对仓库根目录。
- 当前发布记录为 `doc/operations/releases/datadream-inline-20261016.md:3` 的 `active_verified`；该批次只新增数梦页内配置，不应把本轮 MCP 握手成功当成报表 SQL 验收。
- 2026-10-13 生产融合验收明确 V1.2 报表已有快照和图表、投放真实快照正常呈现；保留线上行为、没有重新执行报表生成。依据：`doc/operations/releases/reconcile-20261013-604fa5e6-601fe870.md:15`、`:19`、`:30`。
- 投放 Node BFF 不在本次冻结候选源码包内；以下对独立投放子应用的判断同时引用根仓库 `src/delivery-analysis` 与 10/13 对其 41 文件一致性、98 测试及真实展示的记录。不能据此保证此刻所有上游分区都是最新。
- 未做 AgentHub 上游逐文件基线差分；“特化”指本项目中已经形成的业务专用能力，不能逐项断言上游从未有过。

## 一、当前不是只有聊天壳：有完整的业务报表垂直链路

已形成“内部 Data Service → 服务端签名连接器 → 字段契约与查询约束 → 报表执行/预计算 → PostgreSQL 聚合快照与查询凭证 → 页面图表/Agent 个人报表”的链路。它不是把全表下载到浏览器让模型计算，也不是让模型随意编造图表数据。

实际连接器读取环境变量中的认证值，生成 HMAC 签名或使用已配置签名，向配置的 Data Service API 发送 JSON 查询；返回数据、分页、SQL、queryId 和分区信息。源码：`C/src/backend/internal/infrastructure/report/http_connector.go:28`、`:88`、`:126`。数据库保存数据源配置、字段契约、报表定义、运行快照、每日聚合、个人报表等，架构说明见 `doc/architecture/reporting.md:1`。

关键边界：这个报表通道是“受约束的字段/过滤/分组/聚合 DSL 调用内部 API”，不是已开放的任意 Hive SQL 计算服务；数梦 MCP、Hadoop/Hive 连接和报表 Data Service 是不同链路，不能混写成同一个。

## 二、公共价敏报表：V1.2 已有生产证据，V1.3 不能等同完成迁移

### 已实现

1. **固定报表与模板**：可建立、编辑固定报表，选择数据源，配置查询 JSON 和图表 JSON，启停自动生成；管理员可套用模板，重复套用返回已有实例，不覆盖管理员已编辑内容。模板是复制配置的独立实例。源码：`C/src/frontend/src/views/ReportsView.tsx:534`；`C/src/backend/internal/service/report_template.go:71`。
2. **明确适配范围**：内置模板一目前只有 `price_sensitive` 和 `price_sensitive_v1_2` 两个 profile；V1.2 映射 `ps_score`、`ps_level`、价格/用券/时间得分、`order_cnt_180d`、城市和赋分类型。源码：`C/src/backend/internal/service/report_templates/template-1.json:7`。
3. **业务看板**：指标概览、全量与有订单价敏人群分布对比、增量分析、每日标签快照趋势、数据验证、精确用户查询；管理员另有分页明细和运行记录。省/城市筛选、范围选择、图例显隐、趋势对比/真实数值模式已接入。源码：`C/src/frontend/src/views/ReportsView.tsx:436`；`C/src/frontend/src/components/report/ReportCohortSections.tsx:34`。
4. **订单分层**：全部有订单、1—10 笔、超过 10 笔共 12 个分组；按所选城市、快照日展示人数、价敏分布和同等级基数对比。源码：`C/src/frontend/src/components/report/ReportOrderCountDistribution.tsx:20`、`:73`。
5. **业务口径显式化**：dt 是标签快照日期，不代表订单发生日；180 天订单汇总不是当天订单总量；包含先验赋分；不把相邻缺日补成 0，不跨日期直接累加人群，负净增保留。公式及图表绑定在 `C/src/backend/internal/service/report_provenance.go:24`；模板说明在 `C/src/backend/internal/service/report_template.go:132`。
6. **查证入口**：输入完整 DUID 精确查询；管理员可分页看明细、看运行记录、下载已保存运行快照。普通用户不开放全量明细浏览。源码：`C/src/frontend/src/views/ReportsView.tsx:497`、`:511`、`:524`；路由：`C/src/backend/internal/router/router.go:242`。
7. **站点/人群数据验证**：V1.2 数据验证板块已挂载站点验证、用户复购分析及价敏得分证据组件，对应 station-validation、station-people、station-score-evidence API。它是有边界的验证工作区，不代表已建立普适的价格因果模型。源码：`C/src/frontend/src/views/ReportsView.tsx:496`；`C/src/frontend/src/components/report/StationValidation.tsx:91`；`C/src/frontend/src/components/report/StationPeople.tsx:75`；`C/src/backend/internal/router/router.go:264`。

### V1.3 成熟度边界

冻结生产代码中 V1.3 表出现在 Hive 已知表/探测测试及通用个人报表测试；内置固定报表模板和专用预计算读取仍显式限定 V1.2。因此可以写“为 V1.3 查询与通用报表复用做了基础能力”，不能写“V1.3 已全面替换 V1.2，全部固定图表及每日生产跑批已核验”。依据：`C/src/backend/internal/service/hive_data.go:36`；`C/src/backend/internal/service/report_templates/template-1.json:14`；`C/src/backend/internal/service/report_agent_prepared.go:28`。

## 三、速度特化：把慢计算前移，而非只延长缓存

V1.2 已按 dt/城市持久保存聚合和订单分组，不保存 DUID 明细作为快照优化手段。后台构建完整单日后发布，失败保留成功日；启动补历史、每天北京时间 10 点刷新最新日、手动刷新近 31 日。日期任务最多两路并发，每日查询有完整性校验。依据：`C/src/backend/internal/service/report_prepared_job.go:16`、`:47`、`:71`、`:106`；`C/src/backend/internal/service/report_scheduler.go:10`、`:52`。

日常页面从持久结果与进程内缓存读取；订单切换优先使用一次响应中的 `order_groups`，不再每档请求上游。源码：`C/src/backend/internal/service/report_prepared_read.go:134`；`C/src/frontend/src/components/report/ReportOrderCountDistribution.tsx:38`、`:69`。

快照记录保留执行 ID，按单日城市归属汇总，不跨日期加人。缺失快照不伪造成零；源契约变化会影响缓存身份。源码：`C/src/backend/internal/service/report_prepared_read.go:19`、`:98`。

既有性能证据：9/15 任务验收记录的 analytics 服务端热读约 11 ms，冷读约 200—326 ms；两天预计算约 3 分钟，上游四路并发曾触发保护，因此降为两路。该数据只代表当时测试，不是 10/16 重测，也不能承诺所有设备端到端毫秒级。来源：`doc/task/report-prepared-snapshots.md:21` 及“当前边界”部分。10/13 证据确认保留了该 V1.2 体系，但未重新测量性能。

## 四、查询可追溯：图表不仅有数字，还能说明数字从何而来

- 每次聚合保存请求 JSON、上游 SQL、queryId、日期范围、城市、耗时、状态、图表绑定版本和公式；仅接受预期聚合字段，截断或不完整结果不写成可用快照。源码：`C/src/backend/internal/service/report_provenance.go:88`。
- 管理员可查看来源与执行记录，并做受白名单约束的核验重跑；不是任意执行上传 SQL，也不能扩大为用户明细导出。源码：同文件 `:37`、`:141`；路由 `C/src/backend/internal/router/router.go:267`。
- 聚合和页面范围挂钩，报表 Agent 会收到当前报表、数据日期、日期范围、城市、摘要；独立数据块被标记为事实而非指令，替换页面块时保留用户手写备注。源码：`C/src/frontend/src/components/report/reportAgentContext.ts:15`。

## 五、个人报表与 Agent：从“生成一段话”升级为可保存、可信的数据产物

公共报表与“我的报表”工作区已并存，个人报表有所有者范围的 CRUD，Agent 可通过 MCP 查询字段契约、执行真实查询并保存个人报表。源码：`C/src/frontend/src/views/ReportsView.tsx:549`；`C/src/backend/internal/router/router.go:274`、`:479`。

通用 Agent 查询支持过滤、分组、排序，AVG/MIN/MAX/SUM/COUNT/COUNT DISTINCT；字段必须在启用且非敏感契约内，按 select/filter/group/aggregate/sort 分能力控制。当前通用 DSL 限 1—30 个字段、每页最多 100 行。这是**此报表工具的边界**，不能用来描述所有数梦工具的行列上限。源码：`C/src/backend/internal/service/report.go:201`、`:227`、`:261`、`:345`。

最重要的可信设计：模型只选择模板、板块和字段绑定，服务端用当前用户真实查询凭证替换模型提交的数据；校验查询所属用户、数据源、24 小时时效及会话归属，不能由模型填任意数字。最多 16 板块，当前固定模板版本；V1.2 整体板块不能与通用板块混装。源码：`C/src/backend/internal/service/personal_report.go:90`、`:124`、`:151`、`:187`。

个人报表渲染支持指标卡、折线/柱图/环图、表格，也可直接复用 V1.2 预计算看板；展示数据源、分区、更新时间与模板版本。源码：`C/src/frontend/src/components/personal-report/TemplatePersonalReport.tsx:24`、`:43`、`:81`。预计算入口读取公共快照，不退回全表去重扫描，给模型简要摘要、给服务端凭证保存完整快照。源码：`C/src/backend/internal/service/report_agent_prepared.go:12`。

成熟度：完整代码链路和相关回归测试已在生产候选中；10/13 发布包含通用模板及工具增量。但现有发布记录未逐一给出本轮真实“新对话→生成个人报表→回访”端到端验收，不能把代码实现全部等同每种业务场景都已实测。

## 六、投放分析：有独立业务工作台，但不是闭环营销平台全部完成

### 已接入主产品

Di Agent 中同源嵌入独立 Node BFF 工作台，API 转发至该服务；主页面共享登录，悬浮“投放 agent”读取当前任务、日期、分组、维度页面上下文。源码：`C/src/backend/internal/handler/delivery_analysis.go:17`；`C/src/frontend/src/views/DeliveryAnalysisView.tsx:18`、`:27`、`:53`。

独立 BFF 对 API 重新验证登录，按账号保存任务及人群分析配置；有创建/编辑/删除、已核验人群包搜索、实验及目标配置、模块设置和离线 HTML 报告导出。读取发布快照服务页面，而非每次切换重跑底表。源码：`src/delivery-analysis/server/index.mjs:35`、`:45`、`:54`、`:63`、`:90`。

当前业务源分为召回复购发券漏斗与安心充效果/画像，不应拼成同一活动。支持生命周期、充电频次、身份、会员、城市、城市分框、战区等维度；累计/分日、分组、未达成画像、最多三级联合下钻、近 3/7/14 天及自定义范围、缺测断线；联合分组来自真实联合聚合，不拿边际比例相乘。代码：`src/delivery-analysis/server/snapshot.mjs:1`、`:8`、`:46`、`:94`；实际交付与下钻部署记录：`doc/task/delivery-prd-section4-audit.md`。

### 仍未闭合的关键边界

1. 已核验少量人群包目录/手动 ID 记录，不等于 Ditag 全站搜索及历史真实成员自动关联。BFF 明示该限制：`src/delivery-analysis/server/index.mjs:49`。
2. 保存 AB Master 链接不等于已打通自动分流、历史成员和 UID/DUID 映射。
3. 当前标签/回溯画像不能自动当成真实投放前快照；未通过组别互斥、标签时点、源字段对账时，不宣称实验均衡或因果提升。
4. 曝光和点击事件缺少真实来源，不能把领券当曝光、复购当点击；大盘/历史基准、收入成本也不能从现有三类数据推出。
5. 小时实时模块按用户意愿隐藏；不是已经上线小时级实时监控。
6. 9/23 重建 SQL 和预检文档明确尚未执行，不能把 SQL 文件存在写成新表跑批成功。来源：`src/delivery-analysis/docs/data-completeness-assessment-2026-09-23.md:3`、`:7`、`:22`。旧表跨组重叠等问题是对结论质量的真实限制。
7. 当前可导出离线 HTML，正式发送渠道、留存制度不等于已经完成。来源：`doc/task/delivery-prd-section4-audit.md` 的交付边界与 4.6.3。

## 七、适合最终总结使用的成熟度表述

| 领域 | 可确认阶段 | 不应夸大的部分 |
|---|---|---|
| 公共 V1.2 价敏看板 | 已实现、已有生产实用与回访证据 | 不代表 V1.3 全量迁移完成；不保证最新所有 dt 完整 |
| 持久聚合、城市/订单档位快读 | 已生产落地，已有历史性能测量 | 历史测量不是今日 SLA；初始化仍受上游资源约束 |
| 查询来源、公式、执行留痕与受控重跑 | 已实现并接入管理员 UI/API | 不是任意 SQL 工作台，不开放无限明细 |
| Agent 数据契约/真实查询/可信个人报表 | 完整链路已进生产候选，具备回归覆盖 | 本轮未重新实测所有报表创建场景 |
| 投放分析任务、累计/分日/联合画像、离线报告 | 已接入、部分真实数据与生产快照可用 | 历史人群、AB 主键、曝光点击、真实基准仍有断点 |

这部分最明显的业务特化，是把“通用 Agent 聊天和工具调用”发展成“有业务口径的数据接口、有可复用模板的报表、有性能与完整性守卫的聚合快照、能追溯图表数字的审计链、与页面筛选联动的分析 Agent”。其成熟度不能只用 UI 数量评价，必须同时保留已打通的数据链路与尚缺真实来源的边界。
