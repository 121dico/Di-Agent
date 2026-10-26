# 投放三张表 SQL 根因审计

审计时间：2026-09-22。依据：用户提供的三段 `--SPARK_SQL` 原文 + 线上真实数据实测对照。

## 总览：症状 → SQL 根因

| 你观察到的症状 | SQL 根因 | 位置 |
|---|---|---|
| 投放前画像查不到 | 画像写死取 `dt='2026-08-24'`，不按进组日取 | SQL-3 `labels` / `city` CTE |
| 投放中画像对不上 | 同上：8/12 进组的人也拿 8/24 的标签 | SQL-3 |
| 分日的画像每天都一样 | 维度冻结在 `max(dt)` 快照，再复制到 14 天 | SQL-2 `audience` CTE |
| 只知道总数、分层分不开 | `max()` 当去重用（无择优规则）+ 两个维度与筛选条件同义 | SQL-1 `tag`/`axc` CTE |
| 实验组/对照组数据串了 | join 无去重，同一 DUID 同日产生 2 行 | SQL-3 `exp_user_pre`→`exp_user` |
| 未达成人数偏高 | 零活跃用户被算成未达标（`effect_rate=0`） | SQL-2 `calc` CTE |

**一句话：接口没问题，是这三段 SQL 的关联和口径写法有问题。**

---

## 一、SQL-3（召回复购漏斗）：实验分组串了——铁证

### 180 行重复，完全闭合

```
总行数                       59,541
(entry_dt, duid) 组合数      59,361
差值                            180   ← 多出来的行
日内组间重叠人日                180   ← 前面算出的重叠
```

**两个数字完全相同。** 这证明：每个重叠用户在同一天多产生了 1 行，一行标 `control_group`、一行标 `treatment_group`。

### 根因：三处 join 都没有去重

```sql
exp_user_pre AS (
    SELECT ymd AS dt, apollo_key AS uid, group_name AS group_type
    FROM apollo.pre_flow_data_bak
    ...
    GROUP BY ymd, apollo_key, group_name      -- ← 只去重到 (日,uid,组)
)
```
如果 Apollo 源表里同一个 `apollo_key` 在同一天有两个 `group_name`，这里会**保留 2 行**。

```sql
exp_user AS (
    SELECT DISTINCT a.dt, b.duid, a.group_type
    FROM exp_user_pre a
    INNER JOIN epub_dw.dim_energy_user b
        ON a.dt = b.dt AND a.uid = b.uid       -- ← UID→DUID 若不是 1:1 会扇出
)
```
第二处风险：`dim_energy_user` 里一个 `uid` 若对应多个 `duid`，或一个 `duid` 对应多个 `uid`，就会扇出。**两个不同 uid 映射到同一个 duid 且组分不同时，同一个 duid 就会同时落进两个组。**

`DISTINCT` 只去重到 `(dt, duid, group_type)`，**挡不住"同一天同一个 duid 两个组"**。

### 实测结果：13/13 天全部重叠

| entry_dt | control | treatment | 和 | 当日去重 | 重叠 |
|---|---|---|---|---|---|
| 2026-08-12 | 2,069 | 2,157 | 4,226 | 4,214 | **12** |
| 2026-08-15 | 2,784 | 2,886 | 5,670 | 5,653 | **17** |
| 2026-08-22 | 2,820 | 2,906 | 5,726 | 5,700 | **26** |
| 2026-08-24 | 1,460 | 1,444 | 2,904 | 2,900 | **4** |

**不是偶发，是每天都发生。** 影响：4.2 实验均衡、4.3.4 分组基准、所有组间提升度全部失效。

### 修复

```sql
-- ① 一天一人一组：取首次分流
exp_user_dedup AS (
    SELECT dt, uid, group_type FROM (
        SELECT dt, uid, group_type,
               ROW_NUMBER() OVER (PARTITION BY dt, uid ORDER BY group_type) AS rn
        FROM exp_user_pre
    ) t WHERE rn = 1
),
-- ② 一天一 duid 一组：UID→DUID 扇出后再次收口
exp_user AS (
    SELECT dt, duid, group_type FROM (
        SELECT a.dt, b.duid, a.group_type,
               ROW_NUMBER() OVER (PARTITION BY a.dt, b.duid ORDER BY a.group_type) AS rn
        FROM exp_user_dedup a
        INNER JOIN epub_dw.dim_energy_user b
            ON a.dt = b.dt AND a.uid = b.uid
        WHERE b.dt BETWEEN '2026-08-12' AND '2026-08-24' AND b.duid > 0
    ) t WHERE rn = 1
),
```

**并加一道兜底断言**（建议所有三张表都加）：

```sql
SELECT assert_true(
    COUNT(*) = 0,
    'group_type not unique per (entry_dt, duid)'
) FROM (
    SELECT entry_dt, duid
    FROM epower_platform.ads_delivery_coupon_funnel_di
    WHERE dt = '${BIZ_DATE_LINE}'
    GROUP BY entry_dt, duid
    HAVING COUNT(DISTINCT group_type) > 1
) t;
```

---

## 二、SQL-3：画像写死 8/24，这就是「投放前/投放中查不到」

```sql
labels AS (
    SELECT duid, max(charge_life_cycle) AS charge_life_cycle, ...
    FROM charge_dw.app_charge_tag_duid_df
    WHERE dt = '2026-08-24'        -- ← 写死单日
    GROUP BY duid
),
city AS (
    ...
    WHERE dt = '2026-08-24'        -- ← 写死单日
)
```

- 进组日范围是 **8/12 ~ 8/24**，但画像**一律取 8/24**。
- 8/12 进组的用户，画像晚了 12 天 → **不是投放前，也不是投放中，是活动末日**。
- 因为只有一份标签，**没有任何"投放前"的基线**，所以 4.2.5 均衡检查在数据上不成立。

**上游有每日分区**（`app_charge_tag_duid_df` 本身按 dt 分区，SQL 里其他地方就用了 `dt BETWEEN`），所以这是**可以修的**：

```sql
labels AS (
    SELECT dt, duid, max(charge_life_cycle) AS charge_life_cycle, ...
    FROM charge_dw.app_charge_tag_duid_df
    WHERE dt BETWEEN '2026-08-12' AND '2026-08-24'   -- ← 按日取
    GROUP BY dt, duid
)
...
LEFT JOIN labels l
    ON a.duid = l.duid
   AND a.dt = l.dt            -- ← 按进组日关联（原来是 ON a.duid = l.duid）
```

改完后，每个用户拿到的是**进组当日**的画像。想再要投放前基线，把窗口往前放一天（`dt = date_add(entry_dt, -1)`）即可，同一张表就能出。

---

## 三、SQL-3：整段写死活动期，不是日常调度

`'2026-08-12'` / `'2026-08-24'` 在 SQL 里出现 **8 处**；还有：

| 写死内容 | 位置 |
|---|---|
| 活动周期 `2026-08-12`~`2026-08-24` | 5 处 |
| 维度快照 `2026-08-24` | `labels`、`city` 共 2 处 |
| `source_task_id = '184765378'` | 1 处 |
| 9 个券批次 ID | `coupon_batch_map` |
| 流失周期边界 30/60/90/180 | `target_user` |

后果：**这段 SQL 每天跑只会往新分区写入完全相同的数据**（内容全由写死的日期决定，与 `${BIZ_DATE_LINE}` 无关）。这就是为什么表里只有 1 个分区——它本质是**一次性活动回溯脚本**，不是日更任务，但头部注释写的是 `dt=${BIZ_DATE_LINE}`，容易被误当成日更。

**建议**：把活动周期、券批次、任务 ID 抽成 `params` CTE 或配置表，头部注释明确标注「一次性回溯」还是「日更」。

---

## 四、SQL-1（人群画像快照）：分层拆不开的来源

### 1. `max()` 当去重，没有择优规则

```sql
tag AS (
    SELECT duid,
        max(charge_life_cycle) AS charge_life_cycle,
        max(charge_freq_type)  AS charge_freq_type,
        ...
    FROM charge_dw.app_charge_tag_duid_df
    WHERE dt = '${BIZ_DATE_LINE}'
    GROUP BY duid
),
```

如果源表一个 `duid` 有多行且取值不同，`max()` 会**按字符串大小静默挑一个**——结果随机且不可复现。同理还有 `axc` CTE 和 `city` CTE。

**建议**：改成有业务含义的规则，例如 `ROW_NUMBER() OVER (PARTITION BY duid ORDER BY update_time DESC)` 取最新一条。并加断言语料：源表 `(dt, duid)` 必须唯一，否则直接报错而不是静默取 max。

### 2. 两个维度与筛选条件同义 → 恒为单值

| 字段 | 实测 | 原因 |
|---|---|---|
| `axc_buy_status` | 基数=1（已购用户=193,570） | 人群已按购买筛过 |
| `ds_freq_type` | 基数=1（低频购买用户=193,570） | 与 `axc_freq_type='低频购买用户'` 同义 |

人群用 `axc_freq_type` 筛出低频购买用户，又把 `ds_freq_type`（安心充频次分层）当维度展示——**它必然只剩一个值**。页面上会出现"能点但永远只有一个选项"的假维度。

**建议**：`ds_freq_type` 从维度列表移除，或改成按订单数重新分桶。`axc_buy_status` 同理（人群已经全是已购）。

### 3. 分组是 SHA256 模拟的，不是真实分流

```sql
--  3. 当前实验分组为 SHA256 模拟分组，真实实验替换为 AB Master 分流结果
ranked AS (
    SELECT duid,
        ROW_NUMBER() OVER (ORDER BY sha2(CAST(duid AS string), 256)) AS rn,
        COUNT(1) OVER () AS total_cnt
    ...
)
```

注释自己写明了。**这个表里的 `experiment`/`control` 是按哈希随机劈成两半，和用户实际有没有领到券毫无关系。**

实测印证：`control=96,785` / `experiment=96,785`，恰好各半——这是哈希劈分的特征。

后果：**安心充页面上展示的"实验组 vs 对照组"差异全部是噪声**，页面上却按"实验/对照"呈现，会被误读成策略效果。

**建议**：在真实分流接入前，这个表的 `group_type` 应置为统一标记（如 `all`）并在页面隐藏分组对比；或直接接入 AB Master。

### 4. 城市字段口径

`city_name` 来自 `charge_most_order_city_id` 关联 `dim_charge_city`，是**高频订单城市**，不是投放城市。实测 289 个城市、100% 覆盖（join 正常），但**标签含义与页面文案"城市"不一致**，建议改名为"高频订单城市"。

---

## 五、SQL-2（用户级每日效果）：分日画像不随日期变

### 1. 维度冻结在最新快照

```sql
audience AS (
    SELECT a.duid, a.group_type, a.charge_life_cycle, ...
    FROM epower_platform.ads_delivery_audience_snapshot_di a
    CROSS JOIN params p
    WHERE a.dt = (SELECT max(dt) FROM epower_platform.ads_delivery_audience_snapshot_di)
)                                   -- ← 永远取最新快照
```

然后 `user_daily` 把它 `CROSS JOIN dates`（14 天）。**9/8 到 9/21 的每一行，画像标签完全相同。**

实测印证：`ads_delivery_user_effect_di` 和 `ads_delivery_audience_snapshot_di` 的所有维度分布**逐字节一致**（老用户 179,576 / 低频 68,583 / 端内网约车 71,777 …）。

所以页面上的"分日画像"是假的——它不随日期变化。

**建议**：`JOIN dates d ON a.dt = d.stat_dt`，按日取当日快照（前提是 SQL-1 有日更分区）。

### 2. 零活跃用户被算成"未达标"

```sql
CASE
    WHEN nvl(e.chg_ord_cnt_30d, 0) = 0 THEN 0.0     -- ← 没订单 → 渗透率 0
    ELSE nvl(e.axc_ord_cnt_30d,0) * 1.0 / nvl(e.chg_ord_cnt_30d,0)
END AS effect_rate,
...
CASE WHEN effect_rate < target_rate THEN 1 ELSE 0 END AS unmet_flag
```

**没充电订单 = 渗透率 0 = 未达标。** 但"没有订单"是**指标不适用**，不是"未达成"。

实测：`chg_ord_cnt_30d = 0` 涉及 **35,318 人（18.2%）**，全部被计入未达成。这直接让未达成画像和未达成率虚高。

**建议**：改成三态——

```sql
CASE WHEN nvl(e.chg_ord_cnt_30d,0) = 0 THEN NULL
     ELSE e.axc_ord_cnt_30d * 1.0 / e.chg_ord_cnt_30d END AS effect_rate,
CASE WHEN nvl(e.chg_ord_cnt_30d,0) = 0 THEN NULL      -- 不适用
     WHEN effect_rate >= target_rate THEN 1 ELSE 0 END AS achieved_flag,
CASE WHEN nvl(e.chg_ord_cnt_30d,0) = 0 THEN NULL      -- 不适用
     WHEN effect_rate <  target_rate THEN 1 ELSE 0 END AS unmet_flag,
```

注意：改成 NULL 需要同步改页面（`snapshot.mjs` 的 `normalize()` 目前强制要求 `achieved + unmet == users`，会校验失败）。**这是表结构和页面契约的联动改动，要一起评估。**

### 3. 目标值硬编码

```sql
WITH params AS (
    SELECT 'crowd_axc_low_freq' AS crowd_id,
           0.12                 AS target_rate      -- ← 魔法数字
)
```

"个人目标 12%" 写在 SQL 里。PRD 4.3.3 要的是**活动整体目标**，这是**个人级阈值**，两者不能互换（页面文档也已说明）。改目标要动 SQL。

**建议**：抽到配置表；若业务确认用个人目标口径，至少让 `target_rate` 可按 `activity_cycle` 分组配置。

### 4. 依赖校验太弱

```sql
SELECT assert_true(COUNT(*) > 0, 'audience_snapshot is empty')
FROM epower_platform.ads_delivery_audience_snapshot_di;
```

只校验"表非空"，**没校验"有今天的分区"**。若 SQL-1 当天失败，SQL-2 会静默用上一天的快照，产出的效果数据看不出异常。

**建议**：改成校验 `dt = '${BIZ_DATE_LINE}'` 分区存在。

### 5. `stat_dt` 与活动期无关

实测 `stat_dt` 范围 **2026-09-08 ~ 2026-09-21**（14 天），由 `BIZ_DATE-13 ~ BIZ_DATE` 生成。如果这是召回任务的表，活动期 8/12–8/24 根本不在窗口内。**分日窗口应该由活动期驱动，而不是由跑批日驱动。**

---

## 六、硬编码清单（建议全部外提）

| SQL | 硬编码项 | 出现次数 |
|---|---|---|
| SQL-1 | `crowd_id='crowd_axc_low_freq'`、`crowd_value='低频购买用户'` | 2 |
| SQL-2 | `crowd_id`、`target_rate=0.12`、`a_type=1`、14 天窗口 | 4 |
| SQL-3 | 活动起止日、维度快照日 8/24、`source_task_id`、9 个券批次、流失周期边界 | 15+ |

---

## 七、修复优先级

| 优先级 | 动作 | 影响 |
|---|---|---|
| **P0** | SQL-3 三处 join 加去重 + 加 `assert_true` 兜底 | 实验分组不再串，组间对比才可用 |
| **P0** | SQL-3 `labels`/`city` 改成按 `entry_dt` 取当日标签 | 一次拿到投放前 + 投放中画像，4.2 均衡成立 |
| **P1** | SQL-2 维度按 `stat_dt` 关联当日快照 | 分日画像真实变化 |
| **P1** | SQL-2 零活跃改三态（需与页面契约联动） | 未达成率不再虚高 |
| **P2** | SQL-1 分组接入真实分流 / 或隐藏分组对比 | 避免把噪声当策略效果 |
| **P2** | `max()` 去重改择优规则 + 源表唯一性断言 | 结果可复现 |
| **P2** | 全部硬编码外提为配置 | 换活动不用改 SQL |

## 八、验收条件

修完重跑后，用这四条卡：

1. `SELECT entry_dt, duid ... GROUP BY entry_dt, duid HAVING COUNT(DISTINCT group_type) > 1` → **必须 0 行**
2. 每天 `control + treatment = 当日去重人数` → **13/13 天守恒**
3. 总行数 `= (entry_dt, duid)` 组合数 → **无多余行**
4. 每个维度「分桶之和 = 去重总数」→ **全部守恒**（当前 `charge_is_member_active` 空值桶要单独确认口径）
