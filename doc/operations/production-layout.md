# 线上目录与发布规则

## 当前运行入口

| 内容 | 权威源码（仓库相对路径） | 线上运行路径 |
|---|---|---|
| React 页面（消息、智能体、报表、投放入口） | `src/frontend/src/` | `/root/energy_tag_agent/frontend-dist/` |
| Go API、WebSocket、同源投放代理 | `src/backend/` | `/root/energy_tag_agent/server` |
| 投放页面、样式及交互 | `src/delivery-analysis/app/` | `/root/delivery_insight_ai/app/` |
| 投放快照与接口 | `src/delivery-analysis/server/` | `/root/delivery_insight_ai/server/` |
| 投放持久快照与用户配置 | 运行时数据，不作为源码 | `/root/delivery_insight_ai/runtime/` |
| 历史发布及暂存文件 | 不作为当前源码 | `/root/di-agent-archives/<UTC时间>/` |

`doc/` 是产品、工程和运维文档；`docs/agents/` 是工作流配置；投放专属调查和 SQL 留在 `src/delivery-analysis/docs/` 和 `sql/`。这些目录用途不同，不按名称相似合并。`offline-model.js` 是离线导出构建产物，修改对应 server 源码后通过投放 build 命令更新。

## 整理与恢复

在服务器运行 `python3 scripts/ops/archive_legacy_deployments.py` 默认只预览；加入 `--apply` 才归档。脚本仅处理明确列出的旧发布和暂存名称，检查进程引用，记录大小、文件数和内容摘要；不清除业务数据、配置、当前构建和日志。

归档并非删除，不减少磁盘总占用。每次操作记录 `manifest.json`；恢复：

```sh
python3 scripts/ops/archive_legacy_deployments.py --restore /root/di-agent-archives/<批次>/manifest.json
# 核对后执行
python3 scripts/ops/archive_legacy_deployments.py --restore /root/di-agent-archives/<批次>/manifest.json --apply
```

## 发布约束

1. 本地完整工作区是当前构建来源。先记录 Git commit、未提交文件清单与产物 SHA256；只用 HEAD 构建会遗漏此前未提交的功能。
2. 服务器检出的源码可能落后于实际部署，不得直接从服务器旧源码重建替换线上版本。
3. 发布前逐文件比较涉及的线上源码与本地基线；若线上不同，先合并并复测，禁止整目录盲目覆盖。
4. 新的发布备份放到归档批次目录；活动入口保持稳定，`runtime`、数据库和上传目录不参与覆盖。
5. 变更投放数据接口要检查首屏响应大小，查询完整留痕只保留在快照/导出中；UI返回有界预览及总数。
6. 发布后验证健康检查、投放数据、电脑列表与浏览器导航；不要只验 HTTP 200。
