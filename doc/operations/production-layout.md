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

## 双边工作树整合（2026-10-13）

本地与线上都有未提交修改时，构建来源是逐项融合后的候选，不是任一方目录的整包覆盖。先冻结线上/本地/共同 Git 基线并记录哈希，备份应用和数据库；语义冲突保留线上行为，未合入部分明确记录。配置、数据库、上传文件和 Delivery `runtime/` 不参加源码融合。

- `/root/energy_tag_agent/RELEASE.json`：当前成功发布的简要版本指针。
- `/root/energy_tag_agent/.releases/<release_id>/manifest.json`：选定源码、运行产物 SHA256、保留/延期功能与测试结果。
- 同批次 `previous/`、`previous-files.json`：本次替换前的运行文件与源码，可回滚；`verification.json` 仅在运行指纹和健康检查通过后生成。
- `.release-backups/<batch>/`：仅服务器可读的完整应用/数据库备份；不进入 Git。既有历史归档不自动删除。
- `frontend-dist/release.json`：供浏览器核对的非敏感版本信息，不包含配置、账户或凭据。

发布前重新验证冻结哈希和活动任务；发现并发线上修改或正在执行的任务立即停止发布。保留旧哈希静态资源以兼容已打开的页面。Delivery 实际运行目录与仓库副本分别核对，运行副本已一致时只补齐仓库，不重启 Delivery。

## 2026-10-19 Cooper 接入发布

当前验收版本 `managed-mcp-20261019T101750Z`，daemon 0.4.10。完整的本次融合候选为 `.scratch/managed-mcp-20261019T095454Z/candidate/`，以服务器实际源码和产物指纹为准；根工作区仍有既有未提交差异，不能从根目录直接全量构建覆盖线上。新功能源码已在该候选与服务器保存，不覆盖根工作区不相关修改。

本次包含两段发布：`managed-mcp-20261019T095454Z` 增加目录与本机桥，`managed-mcp-20261019T101750Z` 补齐权限注册及运行产物。后者 manifest 记录最终后端哈希，父发布记录 daemon 包和完整新增源码。见 [Cooper 发布及验收记录](./releases/managed-mcp-cooper-20261019.md)。没有提交或推送 Git。
