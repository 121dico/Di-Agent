# 聊天文本分词

只统计每条完整用户文字和 Agent 公开回复，不含模板、特殊 token、工具、思考或附件正文。按当前确认模型词表重分词，不是计费或原始生成 token IDs。无匹配词表时界面明确估算。

DeepSeek V4 Pro / Flash 官方词表相同。固定来源：https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/b5968e9190ef611bbf34a7229255be88a0e937c1/tokenizer.json
SHA256: `8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf`。MIT 许可见 LICENSE.deepseek。

在独立虚拟环境安装 `pip install -r tokenizers/requirements.txt`，服务设置 `DI_AGENT_TOKENIZER_PYTHON` 为其 Python 绝对路径。服务工作目录为 src/backend。无运行时、超时或未知模型会回退为标注估算，不发送用户文字到第三方。并发分词最多两个进程、8 秒超时；缓存至多32批结果，只保存摘要和计数。
