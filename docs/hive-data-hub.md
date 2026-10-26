# 数据接入台：Hive 查询首版

## 目标与边界

“数据”页面将 API、Hadoop/Hive、数据地图、Cooper 放在同一个接入台。页面分别展示账号标识和实际连接状态。当前可执行的新增能力是通过 HiveServer2 直接查询已批准的两张表，把查询返回的有界结果保存到 PostgreSQL，供后续报表复用；不复制整张 Hive 表，也不依赖 HDFS 文件下载。原有 API 报表数据源继续可用。

数据地图和 Cooper 当前只有明确的“未接入”状态，没有服务端接口与独立认证配置时不能标记为已连接。Boss 浏览器会话不能自动代替这两个系统的服务端授权。

## 服务端配置

将 `src/backend/config/.env.example` 中的 `DI_AGENT_HIVE_*` 变量填入服务器的 `src/backend/config/.env.local`，文件权限保持仅服务账号可读。`DI_AGENT_HIVE_OWNER_USER_ID` 必填，指向允许使用该个人 Hadoop 凭据的 Di Agent 用户 UUID。缺少任何必填值时连接保持关闭。不要把密码写入 YAML、仓库、日志或浏览器。

连接采用 HiveServer2 二进制协议，SASL PLAIN（驱动配置 `Auth: NONE`），默认端口 8084。后端主机必须能访问目标地址。用户的 Boss 登录只负责 Di Agent 会话；Hive 查询仍由服务端配置的 Hadoop 账号执行。连接状态只代表会话握手成功，表权限由具体查询验证。

## 使用方式

1. 在左侧“数据连接”选 Hadoop / Hive，再选一张已批准的表。
2. 编辑只读 SQL。两张表都需要 `dt` 分区条件；可使用聚合、分组和子查询，支持只引用已批准表的 CTE。
3. 点击“运行并保存”。服务端最多保存 10,000 行、8 MiB 的返回结果；超限会报错，不保存截断后的假结果。
4. 查询记录存储 SQL、表名、返回行数、耗时、执行时间及结果 JSON。仅执行查询的 Di Agent 用户可读取自己的记录。

Agent 对话新增独立的 `hive_data` 来源与 `probe_hive_data` 探测工具。它复用上述个人账号绑定，但不向模型开放页面的任意 SQL 输入：仅能对两张批准表的指定 `dt` 分区验证 `dt` 列是否可读、是否存在一行。它和数据地图的资产元数据搜索互不替代，也不证明其他业务列的 SELECT 权限。探测成功会保存一条最多一行、仅含 `dt` 的查询记录。

当前查询结果已可被页面检索，报表消费这些记录的绑定流程尚未接入。API 数据源的状态“凭据已配置”表示环境变量存在，实际网络/业务连通性由报表查询验证。

## 验证记录

2026-10-08：通过 SSH 转发到服务端可达的 HiveServer2，使用同一 Go 驱动和用户的 Hadoop 凭据，分别对 `epower_platform.price_sensitive_v1_3` 与 `charge_dw.dwd_charge_trd_order_di` 执行带 `dt='2026-10-07'` 的只读常量查询；两次均返回 `1`。未读取或保存业务原始明细。临时探测文件和转发进程已清理。

本地前端构建、后端相关包编译及 SQL 约束测试通过。完整 handler 测试套件仍有原有的 `TestServeSite_RejectsTraversalIntoAnotherDeployment` 失败（实际 404，预期 403），与本功能无关。

2026-10-08：已发布到用户确认的服务器 `10.190.43.41:8080`，并将 Hadoop 凭据绑定到 Di Agent 用户 `121`。该服务器的 `/health`、数据会话、连接状态、Hive 表目录、查询记录和 API 数据源状态接口均已验证；数据库迁移 `089_create_hive_query_receipts.sql` 已应用。实际浏览器进入 `/knowledge` 后，左侧显示 API、Hadoop / Hive、数据地图和 Cooper，右侧显示 Hive 查询与已保存记录；旧的“新建知识库”入口已移除。备份位于该服务器 `/root/deploy-backups/hive-data-20261008-actual-server` 和 `/root/deploy-backups/hive-data-20261008-permission`。

应用内用 `dt='2026-10-07'` 分区查询并保存了两条真实返回记录：`epower_platform.price_sensitive_v1_3` 的 `SELECT * ... LIMIT 1` 返回 1 行、49 列；`charge_dw.dwd_charge_trd_order_di` 的 `SELECT dt ... LIMIT 1` 返回 1 行。后者的 `SELECT *` 被 Hive 拒绝，因为账号对部分列没有 SELECT 权限；后端将此情况返回明确的 403 权限错误。该表可查询已授权的列，但不能据此推断拥有全列权限。查询记录只保存有界的实际结果，后续报表绑定流程尚未接入。

此前误发布到 `10.190.52.164` 的源文件、程序和前端已从发布前备份恢复，误启的进程已停止，Hive 凭据配置已移除。
