# V1.2 数据验证

## 目标与状态
- V1.2 报表底部接入试点站 API，复现用户提供 HTML 的场站/日期/基准日切换、指标、双图与三表。
- 已实现并部署前后端，构建通过；用户已确认测试边界，真实用户路径与视口验收尚未完成。追加的用户级复购分析见 [用户复购与重合](report-station-people.md)。

## 数据契约
- 来源：epower_platform.station_price_sensitive_test_detail，按 APIName 唯一定位启用数据源，不重绑定 V1.2 主报表。
- 固定条件：duid>0、label_match_status=MATCHED、vehicle_type=private，包含会员；private 不宣称已核验私家用途。
- COUNT_DISTINCT 为实际网关枚举；ALL 按日独立去重，各站分别去重；不能相加场站人数替代 ALL。
- dt 为订单日；七档人数与总去重人数不一致时拒绝显示和缓存，避免同日多标签导致重复计数。
- 原始数据日存在且固定人群无匹配时显示0；源日期缺失保持缺失。跨日合计为用户日。

## API / 存储
- GET /api/reports/:id/station-validation：登录用户读取聚合。
- ?refresh=true：仅管理员重新查询；无SQL/字段/源地址自由输入。
- 复用 report_template_analytics_cache，独立 station-validation 缓存键；含报表/源/字段版本，不修改原快照。
- 缓存有效期到下一北京时间10点，过期后首次访问刷新，不宣称已经接入定时预热任务。
- 全部分页严格校验，最大5万聚合行、365天跨度，截断不视为完成。
- 凭据仅使用已登记的服务器环境变量，不在新代码/页面/文档存放真实值。

## UI 决策和验证
- myuiskill 默认选择模式；参考HTML功能、现有报表视觉，不嵌入静态旧快照。
- 本区筛选独立，不错误映射用户城市ID到场站城市。
- 16/14px文案与表格、双图桌面并列，1024以下单列；390窄屏控件换行、表格内部滚动。
- 说明默认折叠；空/加载/失败/旧数据状态明确；图例开关，悬停原始数值。
- 浏览器安全策略拒绝打开参考file://地址，因此未绕过该限制；功能从源HTML和dashboard.js核对。
- 真实API探测：2026-09-12七档去重查询成功；全期场站/日期/等级分组13,535行，第一页1000行，14页。
- 本地构建通过（现有大chunk警告）；既有前端测试343通过、2失败：reportV12Presentation首日0/NaN预期、ReportCohortLayout旧顺序预期。
- 既有后端service/repository通过；handler仅既有TestServeSite_RejectsTraversalIntoAnotherDeployment失败（404 vs403），未改相关逻辑。
- 两轮Spec/Standards只读审查通过；修正稀疏日期跨度上限（超过365日明确报错）与主源版本缓存键。只剩非阻塞的短别名可读性建议。

## 待完成
- 宏观聚合专项2项及用户级统计/缓存/权限/分页与前端交互测试已通过。真实服务查询与缓存复验通过，详情见用户复购文档。
- 真实账户导航和交互、视口验证、提交推送。
