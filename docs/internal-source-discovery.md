# 内部资料源渐进发现

Agent 的初始上下文只包含 `discover_internal_sources` 与 `get_internal_source_guide` 两个入口，不预载来源指南。遇到内部资料缺口时，Agent 可先发现 Cooper、GitLab、数据地图、Hive 资产、Hive 真实数据的简短用途与接入状态，再按问题线索展开单一来源。没有固定的查找顺序。

发现和指南工具本身只返回有界元数据，不读取用户凭据。Cooper 与 GitLab 仍未接入。数据地图现有一个**待正式凭据验证**的 Hive 表资产前缀搜索通道：选定数据地图或 Hive 来源后，Agent 才得到 `search_data_map_hive_tables` 的用法。该工具只返回库名、表名和接口出处；不执行 HiveServer2 SQL，不查询字段、分区、样例行或业务数值。Hive 页面的单用户连接与此通道无关。

目录状态按当前 Di Agent 用户动态显示：`not_configured`（服务端未配置）、`configured_unverified`（已配置但尚无可验证成功调用）、`connected`（最近一次响应结构和资产标识通过校验）、`no_permission`（不是获批试点用户或来源拒绝）、`temporarily_unavailable`（调用失败或响应无法确认）。旧服务端仍显示 `not_connected`。错误与格式不明绝不表示“没有这个表”。

`hive_data` 是另一条独立通道，使用当前用户已登录的 Hadoop/HiveServer2 会话或服务端明确绑定给此用户的个人凭据，不使用数据地图 client/token。Agent 选中它后才获得 `probe_hive_data` 的操作指南。首版只接受两张已批准的表和明确的 `dt` 日期；服务端固定执行 `SELECT dt ... WHERE dt = 'YYYY-MM-DD' LIMIT 1`，返回 `readable` 与 `row_found`，不向 Agent 开放任意 SQL、其他列或整表读取。`readable=true` 只证明 `dt` 列可查询；`row_found=false` 只证明这一次指定分区未查到行，不代表表不存在或其他分区没数据。不同用户的 Agent 不能借用这份个人凭据。

若线上采用“本人在数据连接页手动登录 Hadoop”的会话方式，状态会显示 `login_required`；用户需要自己在页面登录，Agent 不接收密码。会话失效后须重新登录。当前本地实现仍基于单用户绑定版本，正式上线前必须与服务器现有的按人登录实现合并验证，不能直接覆盖服务器源码。

试点的 `owner_user_id` 只是 Di Agent 侧限制：MCP 请求的 `user_id` 来自 daemon 运行上下文，并不是数据地图签发的逐用户委托身份。来源凭据是否只授权申请人、以及部门多人如何按人授权，仍需数据地图维护方确认。正式凭据仅存于后端私有环境，不会发送给 daemon、Agent 或浏览器。配置和未验证项见 [数据地图接入说明](data-map-connector.md)。
