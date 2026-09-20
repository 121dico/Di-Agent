# 投放分析 API 字段核验与用途

核验日期：2026-09-20。依据：服务器实时 contracts 与真实聚合快照，三个源表共 57 个字段项（同名字段按数据源分别计数）。

本轮补齐前：三个 API 均已调用，但部分字段未用。补齐后：57 项均用于统计、画像、范围限定或质量校验；不代表所有 PRD 功能已实现。

## 页面入口

- 原“配置维度”：13 种安心充画像维度，画像与分日拆解分别选择；召回支持流失周期分布和分日拆解。
- 原“分日效果”：订单合计比率、个人目标、个人达标人数、个人渗透率均值；召回漏斗补充源表完整发券复购人数。
- 原“数据范围 / 数据接口”：全部字段用途、目标与比例覆盖、画像订单汇总、首末单 ID 有值覆盖。
- 原“导出报告”：当前真实聚合数据、字段用途和查询依据 JSON。

## 实查示例（2026-09-19）

安心充人群 195,449 人，源表个人目标 12%，个人渗透率均值 14.01%，订单合计比率 10.78%。三者定义不同，不能互换。近 30 天安心充订单 417,367，充电订单 3,872,662。首单 ID 有值 192,812 人，最近单 ID 有值 193,117 人。会员有效标记：1 为 90,077 人，0 为 39,188 人，空值为 66,184 人（显示未知）。

历史 effect_rate 曾出现最大 2（200%）；保留原值并提示核查，不截断、不冒充整体转化率。目标同一天若不同值或有缺失，统一目标显示 —。

## 逐字段用途

### epower_platform.ads_delivery_audience_snapshot_di（21 项）

| 字段 | 类型 | 用途 |
|---|---|---|
| `axc_buy_status` | STRING | 安心充购买状态画像 |
| `axc_ord_cnt_30d` | BIGINT | 单日快照近 30 天安心充订单合计，不能跨日累加 |
| `charge_duid_role_name_v2_type` | STRING | 用户身份当前快照画像（不替代历史效果标签） |
| `charge_freq_type` | STRING | 充电频次当前快照画像（不替代历史效果标签） |
| `charge_is_member_active` | BIGINT | 会员有效标记画像；空值单独显示未知 |
| `charge_life_cycle` | STRING | 生命周期当前快照画像（不替代历史效果标签） |
| `charge_most_order_city_id` | BIGINT | 高频订单城市 ID 画像；不等同投放城市 |
| `charge_region` | STRING | 战区当前快照画像（不替代历史效果标签） |
| `chg_ord_cnt_30d` | BIGINT | 单日快照近 30 天充电订单合计，作为订单比率分母 |
| `city_fenkuang` | STRING | 城市分框当前快照画像（不替代历史效果标签） |
| `city_name` | STRING | 城市当前快照画像（不替代历史效果标签） |
| `crowd_id` | STRING | 限定安心充人群包、记录来源标识 |
| `ds_freq_type` | STRING | 安心充频次分层画像 |
| `dt` | STRING | 选择最新快照分区、展示数据新鲜度 |
| `duid` | BIGINT | 去重人数、记录粒度校验；不返回用户明细 |
| `first_axc_date` | STRING | 首单日期分布；不等同投放后新增首单 |
| `first_axc_order_id` | STRING | 仅校验非空覆盖人数，不拉取订单明细 |
| `group_type` | STRING | 来源组人数与当前快照画像分布 |
| `last_axc_date` | STRING | 最近订单日期分布；不推断投放归因 |
| `last_axc_order_id` | STRING | 仅校验非空覆盖人数，不拉取订单明细 |
| `member_status` | STRING | 会员状态当前快照画像（不替代历史效果标签） |

### epower_platform.ads_delivery_coupon_funnel_di（18 项）

| 字段 | 类型 | 用途 |
|---|---|---|
| `activity_cycle` | STRING | 流失周期分布和分日效果拆解 |
| `charge_duid_role_name_v2_type` | STRING | 用户身份画像和分日拆解 |
| `charge_freq_type` | STRING | 充电频次画像和分日拆解 |
| `charge_life_cycle` | STRING | 生命周期画像和分日拆解 |
| `charge_region` | STRING | 战区画像和分日拆解 |
| `city_fenkuang` | STRING | 城市分框画像和分日拆解 |
| `city_name` | STRING | 城市画像和分日拆解 |
| `dt` | STRING | 选择最新快照分区、展示数据新鲜度 |
| `duid` | BIGINT | 去重人数、记录粒度校验；不返回用户明细 |
| `entry_dt` | STRING | 按进组日统计发券后 7 日复购，不跨日相加 |
| `group_type` | STRING | 来源组人数、效果对比；不自动认定随机实验 |
| `is_coupon` | INT | 领券人数、主漏斗及领券后复购率分母 |
| `is_entry` | INT | 校验进组标记，保证漏斗分母属于进组人群 |
| `is_full_coupon` | INT | 完整发券子集人数 |
| `is_full_coupon_repurchase_7d` | INT | 源表完整发券后 7 日复购人数，不用推算值替代 |
| `is_repurchase_7d` | INT | 整体复购人数、领券且复购人数 |
| `member_status` | STRING | 会员状态画像和分日拆解 |
| `source_task_id` | STRING | 限定召回任务、记录来源标识 |

### epower_platform.ads_delivery_user_effect_di（18 项）

| 字段 | 类型 | 用途 |
|---|---|---|
| `achieved_flag` | INT | 源表个人达标人数 |
| `axc_ord_cnt_30d` | BIGINT | 单日快照近 30 天安心充订单合计，不能跨日累加 |
| `charge_duid_role_name_v2_type` | STRING | 用户身份画像和分日拆解 |
| `charge_freq_type` | STRING | 充电频次画像和分日拆解 |
| `charge_life_cycle` | STRING | 生命周期画像和分日拆解 |
| `charge_region` | STRING | 战区画像和分日拆解 |
| `chg_ord_cnt_30d` | BIGINT | 单日快照近 30 天充电订单合计，作为订单比率分母 |
| `city_fenkuang` | STRING | 城市分框画像和分日拆解 |
| `city_name` | STRING | 城市画像和分日拆解 |
| `crowd_id` | STRING | 限定安心充人群包、记录来源标识 |
| `dt` | STRING | 选择最新快照分区、展示数据新鲜度 |
| `duid` | BIGINT | 去重人数、记录粒度校验；不返回用户明细 |
| `effect_rate` | DOUBLE | 个人渗透率均值、非空覆盖及原始范围；与整体订单比率分开 |
| `group_type` | STRING | 来源组人数、效果对比；不自动认定随机实验 |
| `member_status` | STRING | 会员状态画像和分日拆解 |
| `stat_dt` | STRING | 分日效果和日期筛选 |
| `target_rate` | DOUBLE | 源表个人目标及非空覆盖；只有全覆盖同值才显示统一目标 |
| `unmet_flag` | INT | 源表个人未达标人数及画像 |

## 仍然缺少的能力

- 跨日去重累计及其目标/历史基准，需要明确实验归属、观察窗口与去重口径。
- 资源位曝光/点击、小时级趋势，需要相应明细或聚合接口。
- 投放前均衡与历史活动比较，需要对应时点快照及实验配置。
- 召回侧栏的指定流失人群组合仍未接入；流失周期作为单维分布/效果拆解可选。
- DUID、首末单 ID 不返回原始明细；非空覆盖不能证明订单 ID 有效，也不证明投放归因。

## 验证记录

预发布真实快照首次构建用时约 110 秒，976 次聚合查询；筛选只读持久聚合结果，不重新扫描上游。快照不含用户或订单 ID 明细。静态原 HTML 和 CSS 均未修改。
