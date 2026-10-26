# 投放分析 API 能力核对：需求数据 vs 接口真实返回

核验时间：2026-09-22。核验方式：线上服务器 `10.190.43.41` 实测，非本地源码推断。
证据：`/delivery-analysis-app/api/bootstrap`（真实快照）、`/mcp/report-data/contracts`（实时契约）、`/mcp/report-data/query`（真实聚合查询）。

## 结论

**部分满足。** 你正在用的投放分析 API 能满足 PRD 第 4 部分中"基于投放结果 + 当前人群画像"的绝大部分统计；**满足不了 4 类数据**（曝光/点击、投放前标签、AB Master 自动分流、大盘与历史活动）。

另外发现：**接口层实际注册了 8 个源 / 349 个字段，投放分析只接了 3 个 / 57 个。** 未接入的 5 个源里，至少有 3 个可以直接补掉当前的缺口——这些缺口不是"API 没有数据"，而是"没有接"。

## 一、你实际在用的 API（实测链路）

```
页面 /delivery-analysis (React 壳 + iframe)
  └─ iframe /delivery-analysis-app/
       └─ 页面 API  /delivery-analysis-app/api/{bootstrap,tasks,crowds,refresh,export}
            └─ 取数 API  DiAgent /mcp/report-data/{contracts,query}   ← 服务令牌鉴权
                 └─ ClickHouse epower_platform.*
```

- 页面 API 需要 DiAgent 登录态（`Bearer`），服务端再换成服务令牌取数。
- **取数 API 是"单源聚合查询"，没有 JOIN 能力**：一次查询只能指定一个 `source_id`，只返回聚合结果，不返回 DUID/订单明细。跨源关联只能在应用层按 `duid` 做。
- 单次查询上限 30 字段、聚合分页 300 页；当前快照构建 976 次查询约 110 秒。

线上挂载的 3 个源，面板自报 **57/57 字段已接入**：

| 源 | 字段 | 覆盖 |
|---|---|---|
| `epower_platform.ads_delivery_coupon_funnel_di` | 18 | 召回发券复购漏斗 |
| `epower_platform.ads_delivery_user_effect_di` | 18 | 安心充效果 |
| `epower_platform.ads_delivery_audience_snapshot_di` | 21 | 安心充人群画像快照 |

## 二、能满足的（线上真实数据已验证）

| PRD | 需求 | 线上实测 |
|---|---|---|
| 4.3.4 / 4.4.6 | 进组→领券→复购漏斗、分组对比 | 累计进组 46,858 / 领券 36,536 / 领券且复购 7,838（21.45%）；对照组 23,429、实验组 23,722 |
| 4.4.3 / 4.4.4 | 分日、近 3/7/14 日周期与日均 | 13 个进组日期、91 个召回区间已发布，逐区间独立去重 |
| 4.2.3 / 4.2.4 | 画像三视图、维度配置 | 7 个画像维度 + 流失周期，饼图/条形图/表格 |
| 4.3.10 | 多级下钻、组合分析、路径与清空 | 互斥联合去重桶，最多三级 |
| 4.4.7 | 所选日未达成用户画像 | 按日独立去重 |
| 4.6.3 | 导出报告 | 离线 HTML 可用 |

`periodFunnels` 的备注也如实写明："在所选日期范围内按 DUID 独立去重，不能将分日人数相加。"

## 三、满足不了的（接口里根本没有这类字段）

| PRD | 缺口 | 真实原因 |
|---|---|---|
| 4.3.6 / 4.4.2 | 曝光成功率、曝光后点击率、**进组→曝光→点击→有效**漏斗 | 全部 349 个字段里**没有任何资源位曝光/点击事件字段**。`main_duid_coupon_sort` 只有 `price_sort_count_30d`、`distance_sort_count_30d`、`comprehensive_sort_count_30d`、`latest_sort_time_1/2/3`、`recent_5_sort_sequence` —— 这些是**列表排序行为的 30 天滚动计数**，是代理量，不是资源位曝光埋点，也没有资源位 ID 和事件时间戳 |
| 4.2.5 / 4.2.6 / 4.2.7 | 实验均衡、投放前分组画像、投放前标签快照 | 三个投放源都是**当日快照**（`dt` = 最新分区）。线上 `groupPortrait.basis = "current_snapshot"`、`conclusion = null`——页面自己拒绝下均衡结论，属于诚实处理而非缺陷 |
| 4.1.7 | AB Master 自动联动（实验 ID → 成员/分流映射） | 只有人工核验记录：`captureMode = "人工核验历史记录，非自动同步"`。契约里没有 Apollo 分流底表 |
| 4.1.3 | 人群包全量搜索、历史成员 | `/api/crowds` 只返回 3 个已核验包 + 手填数字 ID，无 ditag 搜索/成员接口 |
| 4.3.3 | 大盘基准、节奏状态 | 无同期大盘样本源 |
| 4.3.5 | 历史活动基准 | 无可比历史活动目录 |
| 4.3.3 | 活动整体目标 | 只有个人级 `target_rate`，不能冒充整体目标 |
| 4.5 | 小时级实时 | 无小时分区 |
| 条件性 | 投放期**新增**订单/收入/充电量 | `*_ord_cnt_30d` 是每日滚动近 30 天值，跨日不能相加 |

## 四、关键发现：5 个源没接，可补掉 3 个缺口

`/mcp/report-data/contracts` 实测返回 **8 个源 / 349 字段**，投放分析只用了 3 个。未接入的 5 个（已实测可查且有数据）：

| 源 | 字段 | 粒度 | 实测 |
|---|---|---|---|
| `epower_platform.main_duid_coupon_sort` | 101 | DUID × 每日快照 | 22.19 亿行；2026-09-21 分区 4,298 万人 |
| `epower_platform.main_station_180d_downstream` | 48 | **订单粒度** | 2026-09-21 分区 3.44 亿订单；`order_date` 回溯至 2026-03-23 |
| `epower_platform.price_sensitive` | 62 | DUID | 价敏标签 |
| `epower_platform.price_sensitive_v1_2` | 49 | DUID | 价敏标签 V1.2 |
| `epower_platform.station_price_sensitive_test_detail` | 32 | 订单 | 试点站明细 |

### 可直接补的 3 个缺口

**1. 投放前标签快照（4.2.5 / 4.2.7）→ 可补**

`main_duid_coupon_sort` 按 `dt` 有**历史每日全量快照**（实测 2026-08-11、2026-08-12 均可查，8/12 为 4,124 万人）。取投放基准日分区即得投放前标签，不再需要 `charge_dw.app_charge_tag_duid_df` 单独接入。

**2. 真实流失分层人群（4.1.3 及 30–60/60–90/90–180 三个包）→ 可补**

2026-09-21 分区实测：

- `recall_loss_type`：流失 33,749,372 / 其他 9,142,640 / 召回 88,890
- `life_cycle_v2`：流失90天用户 27,586,658 / 流失28天用户 6,162,714 / 流失28天召回用户 52,805 / 流失90天召回用户 36,085

这比现在"只有 3 个包 ID、成员靠人工核验"强得多，可支撑真实人群范围。

**3. 订单级有效事件（累计新增订单/收入/电量）→ 可补**

`main_station_180d_downstream` 为订单粒度，含 `order_id`、`order_date`、`duid`、`coupon_fee`、`total_charge_kwh`、`market_total_fee`、`active_total_fee`。按 `duid` + `order_date` 可算投放期新增，解决"滚动值不能相加"。

**附带可补：券批次与核销（4.1）** —— `coupon_behavior_segment` 实测分层（1_USED_TODAY 215,134 人 / 2_USED_RECENT_7D 671,730 / 3_ACTIVE_UNUSED_WITH_HISTORY_USE 1,464,671 …），另有 `coupon_created_cnt_1d/7d`、`coupon_used_cnt_1d/7d`、`first/latest_coupon_create_time`、`first/latest_coupon_use_time`、`coupon_use_rate_1d/7d`。

### 补不了的 4 类

曝光/点击事件、AB Master 自动分流成员映射、大盘样本、可比历史活动目录 —— 这 4 类在**任何已注册源里都没有对应字段**，必须新增数据源或数据服务，不是页面侧能补的。

## 五、实施建议

| 优先级 | 动作 | 收益 |
|---|---|---|
| P0 | 接入 `main_duid_coupon_sort`，按投放基准日取快照 | 一次解决"投放前标签 + 真实流失分层"，是 4.2 均衡能否下结论的前提 |
| P1 | 接入 `main_station_180d_downstream` | 累计口径从"覆盖率"升级为"新增订单/收入/电量" |
| P2 | 接入 `coupon_behavior_segment` 等券字段 | 补齐券批次与核销漏斗 |
| — | 曝光/点击、大盘、历史活动 | 需业务方提供新数据源，当前无解 |

**接入前必须评估成本与口径**：

- 数据量：`main_duid_coupon_sort` 22 亿行，单分区聚合实测 5–8 秒；`main_station_180d_downstream` 单日 3.44 亿订单。现有快照 976 次查询约 110 秒，接入后需重新评估构建耗时，必须继续走"预计算快照 + 只读切换"，不能在切页时扫源表。
- 跨源关联：取数 API 无 JOIN，`main_duid_coupon_sort` 与投放漏斗表按 `duid` 的关联需在应用层完成，并单独核验覆盖率和重复。
- 口径核验：`life_cycle_v2` 的"流失28天/90天"与 PRD 的 30–60/60–90/90–180 三个包**是否同口径需源端确认**，不能仅凭名称套用。
- 价敏三源（`price_sensitive`、`price_sensitive_v1_2`、`station_price_sensitive_test_detail`）经核对与投放分析需求关系较弱，除 `sort_confirm_cnt` 外无曝光/点击语义，建议不纳入本轮。

## 六、一句话回答

你的 API **能满足"投放后效果 + 当前人群画像"，不能满足"投放前状态 + 曝光点击 + 跨活动对比"**；而且接口里还躺着 5 个没用的源，其中 `main_duid_coupon_sort`（含每日历史快照和真实流失分层）与 `main_station_180d_downstream`（订单粒度）可以直接把当前最大的几个缺口补上——**先接这两个，比继续在页面上做空态更有价值。**
