# 报表区域和时间筛选

## 需求 / UI Brief
- 地图常驻展开（confirmed），浅色现有主题不改。
- 停止选择500ms后自动应用（defaulted），保留立即应用和重置；超过50个城市显式提示。
- 地图限高250px，SVG显式230px防止固有比例撑高裁切；有城市时并排，小于760px上下排列（defaulted）。
- 省份选择保持多选；点击省内具体城市切换为城市条件，不残留全省条件。
- 保留权限、统计口径、真实API；标签趋势时间仍为dt，不改成订单时间。总览及分布为区间最新快照，趋势为所选日期区间。
- 复用ChinaRegionPicker、Ant Design和wb/report tokens，不新增依赖；控件焦点与reduced-motion保留。
- 主路径：报表→区域/时间→自动查询→显示对应快照/趋势；错误显示原错误信息，不用全国数据冒充城市数据。

## 诊断证据
`scripts/test-frontend.sh src/components/report/ChinaRegionPicker.test.tsx` 新增回归修复前失败：选择浙江再杭州，实际展开11城市而非杭州。修复后通过。
地图原截图下半部裁切；原城市/时间只改draft，必须手动应用；改为合并自动应用。

## 验收
14项区域/历史/城市隔离测试及生产构建通过。真实浏览器主路径待完成。
仅更新前端，备份 `/root/deploy-backups/report-map-filters-Nv8xRE/frontend-previous`。
Gate0–7按上述范围自动通过，Gate8–9待真实UI检查；小屏真实设备尚未验收。
