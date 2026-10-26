# 投放前 / 投放中 / 投放后三张事实表重写方案

这三张表按不同事实粒度拆开，避免用人群快照推算投放效果。

## 1. 投放前人群基线

表名：`epower_platform.ads_delivery_campaign_audience_baseline_di`

粒度：`campaign_id + crowd_id + baseline_dt + duid`

用途：保存投放开始前某一天的人群成员、真实实验组和投放前画像。它支撑页面的总人数、实验/对照人数、实验均衡、生命周期、充电频次、用户身份、会员、城市、城市分框、战区等模块。

必须字段：

```sql
campaign_id, resource_id, crowd_id, baseline_dt, duid,
group_type, group_source, entry_dt,
charge_life_cycle, charge_freq_type, charge_duid_role_name_v2_type,
member_status, city_id, city_name, city_fenkuang, charge_region,
axc_ord_cnt_30d, chg_ord_cnt_30d, first_axc_date, last_axc_date
```

关键改动：`crowd_id` 必须来自 Ditag 的真实成员快照（1011337400、1011337415、1011337424），`group_type` 必须来自 Apollo/AB Master；不能继续使用固定 `crowd_axc_low_freq` 或 SHA256 模拟分组。

## 2. 投放中过程事实

表名：`epower_platform.ads_delivery_campaign_delivery_event_di`

粒度：`campaign_id + resource_id + event_dt + duid + event_type`

用途：支撑页面的投放中漏斗和累计效果。每个事件独立记录，不能由画像快照补出来。

建议字段：

```sql
campaign_id, resource_id, crowd_id, duid, group_type,
event_dt, event_ts, event_type,
is_experiment_entry, is_exposure, is_click,
is_coupon_issued, is_coupon_received, is_coupon_used,
coupon_batch_id, coupon_id, source_event_id,
city_id, city_name, charge_region
```

事件类型至少需要：`entry`、`exposure`、`click`、`coupon_issued`、`coupon_received`、`coupon_used`。如果上游没有曝光或点击日志，页面必须显示“暂无该事件源”，不能用进组人数代替。

## 3. 投放后效果事实

表名：`epower_platform.ads_delivery_campaign_outcome_di`

粒度：`campaign_id + resource_id + duid + entry_dt + observation_dt`

用途：支撑投放后 7 日/14 日复购、订单变化、完整发券后复购、实验组与对照组对比。

建议字段：

```sql
campaign_id, resource_id, crowd_id, duid, group_type,
entry_dt, observation_dt, observation_days,
is_coupon_issued, is_full_coupon,
order_cnt_before, order_cnt_during, order_cnt_after,
axc_order_cnt_before, axc_order_cnt_during, axc_order_cnt_after,
is_repurchase_7d, is_repurchase_14d,
is_full_coupon_repurchase_7d, is_full_coupon_repurchase_14d,
first_order_after_dt, last_order_after_dt,
source_order_id, source_event_id
```

口径必须按事件时间计算：投放前为基准日之前，投放中为活动有效期内，投放后为每个用户进组/发券日之后的观察窗口。`*_30d` 滚动字段只能作为画像辅助字段，不能直接作为投放后效果。

## 当前页面可以填到哪一步

| 页面模块 | 三表完成后的状态 |
|---|---|
| 投放前总人数与人群画像 | 可完整填充，前提是 Ditag 成员快照和基准日分区可取 |
| 实验/对照人数与均衡 | 可完整填充，前提是接入真实 AB Master 分组 |
| 生命周期、充电频次、身份、会员、城市等组合下钻 | 可完整填充 |
| 投放中进组/发券/领取/核销漏斗 | 可完整填充，前提是过程事件源提供对应事件 |
| 累计效果 | 可完整填充，按 DUID 去重，不能把每日人数直接相加 |
| 投放后 7 日/14 日复购 | 可完整填充，前提是订单事实表覆盖观察窗口 |
| 曝光、点击 | 只有上游有日志时可填；没有日志必须显示空状态 |
| 历史活动对比 | 需要额外保留历史活动的基线和结果分区，三表可以承载 |

## 本次活动建议时间参数

```text
campaign_id: 184765378（需用真实 BOSS 任务 ID 映射，不应写死）
campaign_start: 2026-08-12
campaign_end: 2026-08-24（以实际下线/活动事实为准）
baseline_dt: 2026-08-11
post_window: 每个用户 entry_dt 或 coupon_received_dt + 7 天
```

## 不能直接开跑的依赖

以下来源在现有三段 SQL 中没有被真实绑定，必须先确认表名和字段：

1. Ditag 三个人群包的历史成员快照；
2. Apollo/AB Master 的真实分组明细；
3. BOSS 六个资源任务与 Ditag 人群、券批次的映射；
4. 曝光、点击、触达事件；
5. 订单事实的活动前/中/后可按日期过滤字段。

在这些来源未确认前，只能完成表结构和页面空状态，不能声称页面已经全部是真实投放数据。
