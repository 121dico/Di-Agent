# 数据地图 Hive 表资产检索：试点接入说明

此通道只调用官方文档《数据地图-开放服务-接口文档 V1.01》的只读 `GET /dp_metadata_api/hive/table/pageByPrefix`。Agent 传 `prefix`，可选 `db_name`，分页最大 20 条；后端转换为文档参数 `prefix`、`dbName`、`pageNo`、`pageSize`，响应只保留经过校验的库名、表名与接口路径。字段详情、分区、SQL 查询和样例数据均未接入。

在后端服务器的 git 忽略文件 `src/backend/config/.env.local` 中配置四项：

```dotenv
DI_AGENT_DATA_MAP_BASE_URL=
DI_AGENT_DATA_MAP_CLIENT=
DI_AGENT_DATA_MAP_TOKEN=
DI_AGENT_DATA_MAP_OWNER_USER_ID=
```

`BASE_URL` 必须由数据地图方提供正式环境地址，不能使用文档中的测试主机替代；`CLIENT` 与 `TOKEN` 是数据地图独立审批的凭据，不是 Boss Cookie、Hive 密码或 Di Agent 登录令牌。`OWNER_USER_ID` 是唯一获批申请人的 Di Agent 用户 UUID，缺少任一项就关闭连接器。当前实现接受 HTTP/HTTPS 基础地址；正式配置前必须确认传输链路可保护 token，未经批准不要在明文链路中使用正式凭据。不要把实际值写入 Git、日志或 Agent 环境。

后端按照文档公式 `MD5(base64(timeStamp) + ":" + token)` 生成每次请求的 `sign`，通过 `client`、毫秒 `timeStamp`、`sign` 请求头发送。文档的示例签名与该公式计算结果不一致；单元测试锁定的是文档公式，**尚未经过正式接口验证**。申请通过后需与维护方核对签名及错误码。

文档确认成功条件为 `meta.code=0`，但分页结果的实际 JSON 字段尚未拿到正式响应验证。当前解析器保守地只接受 `data.list` 数组，且每条必须有合法 `dbName`、`tableName` 并匹配检索条件。任何其它成功响应形状都会报“返回格式未核验”，不会产生假“未命中”；接到凭据后应先做一次最小真实请求，按官方实际响应修正解析器并补回归测试，然后再标记上线。空列表仅表示**所请求前缀的当前页无结果**，不能单凭某一页证明某张表全局不存在；`has_prefix_matches` 也只表示当前页有前缀命中，不等于精确表名存在。

Agent 从 `/daemon/internal-sources/...` 查询时，必须用电脑专属 API key 在 `Authorization: Bearer` 请求头中认证；服务端以已认证电脑的所属用户为准，并要求本轮请求者与之相同。全局 daemon token、缺失请求者或其他电脑的密钥均不能调用。这个检查只保证 Di Agent 内的单机归属，**不能替代数据地图来源系统的逐用户授权**，也不支持其他用户在该电脑的共享 Agent 会话中借用试点凭据。

单进程调用间隔至少 1.1 秒，低于文档的个人 1 QPS；如改为多实例，必须先引入跨实例共享限流。多人使用须另行申请或实现可验证的委托身份机制。
