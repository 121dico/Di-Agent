# 报表数据、API 与持久化

## 数据链路

```text
内部 Data Service
  -> HTTPConnector（服务端签名）
  -> ReportService / ReportRunner（权限、字段白名单、查询约束）
  -> PostgreSQL（配置、快照、每日聚合、个人报表）
  -> Gin API / MCP API
  -> React 报表工作区与 Agent 个人报表
```

价敏报表的源数据不保存在前端或 Git 仓库中。后端根据数据库中的数据源定义和字段契约，在运行时调用内部 Data Service。全表分页、城市筛选和精确 DUID 查询按需读取上游数据，不会把整张源表复制进本地数据库。

## 数据存储位置

本地开发环境使用 PostgreSQL 数据库 `di-agent`。Docker Compose 将数据库目录 `/var/lib/postgresql/data` 持久化到命名卷 `di-agent_pgdata`；该卷是运行状态，不属于源码版本库。

| 表 | 保存内容 |
| --- | --- |
| `report_data_sources` | 上游地址、API 名称及凭据环境变量名；不保存真实凭据值 |
| `report_data_source_fields` | 字段类型、说明、敏感标记及 select/filter/group/aggregate/sort 白名单 |
| `report_definitions` | 固定报表查询 JSON、可视化 JSON 和启停状态 |
| `report_runs` | 每次运行状态、不可变结果快照、源分区、查询 ID、耗时及错误 |
| `report_daily_analytics` | 价敏指标、趋势和分布的逐日聚合缓存 |
| `personal_reports` | 用户私有报表的查询、文档、样式和数据来源 JSON |

建表、升级和默认价敏报表均由 `src/backend/migrations/064_*` 至后续报表迁移维护。`066_seed_price_sensitive_full_report.sql` 写入默认价敏报表定义，`069_create_report_daily_analytics.sql` 建立逐日缓存，`071_create_report_data_contracts.sql` 建立字段契约，`073_create_personal_reports.sql` 建立个人报表。

## HTTP API

以下接口均位于已登录用户的 `/api` 路由组内：

| 路径 | 用途 | 访问范围 |
| --- | --- | --- |
| `GET /api/reports` | 固定报表目录 | 已登录用户 |
| `GET /api/reports/:id/analytics` | 指标、趋势和分布 | 已登录用户 |
| `GET /api/reports/:id/search` | 完整 DUID 精确查询 | 已登录用户 |
| `GET/POST /api/reports/sources` | 查看或新增数据源 | 管理员 |
| `GET/PUT /api/reports/sources/:id/contract` | 查看或维护数据契约 | 管理员 |
| `POST /api/reports`、`PUT /api/reports/:id` | 创建或更新固定报表 | 管理员 |
| `POST /api/reports/:id/run` | 手动生成报表 | 管理员 |
| `GET /api/reports/:id/data` | 服务端分页明细 | 管理员 |
| `GET /api/reports/:id/runs` | 运行历史 | 管理员 |
| `GET /api/reports/:id/runs/:runId/download` | 下载运行快照 CSV | 管理员 |
| `/api/personal-reports` | 个人报表增删改查 | 仅所有者 |

Agent 使用的 `/mcp/report-data/contracts` 和 `/mcp/report-data/query` 只暴露脱敏字段契约和受约束查询，不返回物理地址、Hive 信息或凭据。`/mcp/personal-reports` 将真实查询产生的结构化结果保存为当前用户的个人报表。

## API 连接配置

数据源物理地址、API 名称、Hive 定义和字段契约由数据库迁移提供。真实认证值只从后端进程环境或 `src/backend/config/.env.local` 读取；数据库只保存环境变量名称。

部署时复制模板并在服务器上填写：

```bash
cp src/backend/config/.env.example src/backend/config/.env.local
```

`REPORT_PRICE_APP_SECRET` 可用于动态 HMAC 签名；如果内部服务只提供可重放的签名请求，则使用 `REPORT_PRICE_SIGN` 与 `REPORT_PRICE_SIGN_DATE`。模板可以提交，真实 `.env.local`、数据库卷和数据库导出不得进入 Git。

## 源码范围

- 后端模型、仓储、服务、连接器和调度：`src/backend/internal/{model,repository,service,infrastructure}/`
- HTTP 与 MCP 路由：`src/backend/internal/handler/`、`src/backend/internal/router/router.go`
- 数据库结构与种子：`src/backend/migrations/064_*` 至后续报表迁移
- 前端 API、类型、状态和界面：`src/frontend/src/{api,types,store,components,views}/`
- 报表测试：后端 `report*_test.go` 与前端 `*report*.test.*`

当前 GitHub 镜像为公开仓库。即使内部 Data Service 无法从公网连接，提交到 Git 的凭据或数据库快照仍然可以被下载和离线读取，因此发布内容必须保持“完整源码、无真实密钥、无运行数据”。
