# 验证记录

- 后端 service/model/repository/server 测试通过；独立 PostgreSQL 临时表验证隐藏、撤回、其他用户、assistant 元数据身份及客户端时钟偏差。
- 官方 tokenizer 0.22.2 验证中文/英文/emoji 固定词表值；共享缓存不泄露可变引用；未知模型明确退回估算。
- daemon232项、frontend指定12项及TypeScript检查通过。
- 真实 Claude 请求确认 deepseek-v4-pro /200000窗口。验证时3条输入130字符=76文本token，两条公开回复15字符=8文本token；原生最近请求40875独立保留。后续暗号问答返回青竹，连续上下文保留。
- code-review两轴已处理：旧Codex恢复、群聊分项、旧消息隐藏刷新、交接文字截断、分词并发/缓存、时钟差。
- 浏览器检查暂受Mac锁屏阻塞；已发解锁请求，不能声称视觉Gate通过。
- 真实Codex确认配置gpt-6-astra而本轮实际gpt-5.6-sol，窗口258400；确认来源为结束后的原生运行设置。
