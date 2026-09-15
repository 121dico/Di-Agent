# 数据源可用时间核验

## 真实查询（2026-09-15）
源：epower_platform.main_station_180d_downstream，ID 04185aa2-2546-4577-ab3f-3d752c7bb403。

- 实际 dt MIN/MAX：2026-08-12～2026-09-14。
- 追加 groupList=[dt] 查询返回上述区间34个逐日日期；不是按表名180d推算。
- 最新实际 dt=2026-09-14 内，order_date MIN/MAX：2026-03-13～2026-09-14。
- 日期聚合查询ID：ClickHouse_5b28f4e338cc4477afb09f4f67d3de02；日期列表：ClickHouse_d58fdb207d5e4ff5b458a9cba978d2b5；业务日期：ClickHouse_d9037605ad874e0b97cf092f7fa5a531。
- 用户委托的直接curl聚合核验成功。注册字段dt/order_date已允许选择/分组/排序/过滤，但未允许聚合；产品功能必须按契约改用有界完整日期分组查询，不扩大权限。
- 已补齐运行配置中缺失的REPORT_MAIN_STATION_*，使用用户提供的签名实测成功；这是静态签名，不承诺永久有效，凭据不提交。

## UI与接口方案
myuiskill沿用持续默认模式。卡片直接时间摘要、独立核验按钮，原主体按钮仍查看配置详情；dt分区与最新分区内业务日期分开显示，显示最近核验时间。未核验/加载/失败/旧配置状态明确，不因打开目录临时扫描上游。亮色原有卡片与字体，禁止嵌套button，窄屏折行。

管理员GET /api/reports/sources/:id/time-coverage只读持久metadata，POST显式查询并持久化。元数据与当前源契约指纹绑定；失败不覆盖上次成功，无用户明细。

## 验收
- 2026-09-15 部署成功，PID 89014，备份目录 `/root/deploy-backups/source-time-e4Fes4`；保留6255f6b预计算功能，health正常。
- 浏览器管理员在数据源卡片点击核验，16:19:17显示上述真实日期；数据库独立确认元数据已持久保存。
- 后端SourceTimeCoverage测试、service/repository测试、前端目标2文件6测试、TypeScript、生产构建通过。两轴审查提出的空分页与安全诊断问题均已修复。
- 全套检查有既有非本任务失败：handler部署路径测试期望403实际404；前端reportV12Presentation首日增量期望0实际NaN（其余378通过）。
- 目录关闭再打开只读取持久元数据、不自动扫描上游，已用组件回归测试覆盖。页面卡片排版截图验收通过。
