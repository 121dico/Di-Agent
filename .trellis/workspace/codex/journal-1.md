# Journal - codex (Part 1)

> AI development session journal
> Started: 2026-06-09

---



## Session 1: 修复并部署 Agent 内网复制命令

**Date**: 2026-09-03
**Task**: 修复并部署 Agent 内网复制命令
**Branch**: `price_sensitive`

### Summary

修复内网 HTTP 下连接命令复制假成功；增加前端剪贴板与后端服务器 URL 回归测试；发布新前端到 10.190.52.164 并同步双远端及服务器工作副本。真实点击粘贴因远端测试账号无效需已有账号复验。

### Main Changes

- 安装器在解压前把 daemon 包根符号链接移动为同目录唯一备份，并在解压失败时安全回滚。
- 新增隔离式 shell 回归测试，覆盖普通安装、符号链接迁移保全、损坏归档回滚和分发副本一致性。
- 更新后端质量规范，提交并同步两个 `price_sensitive` 远端，服务器在线脚本与仓库哈希一致。
- 在真实 Mac 上重装 launchd 服务；失效旧 Key 被替换后，`computer-1400` 连接并上报 Claude、Codex、ZCode。

### Git Commits

| Hash | Message |
|------|---------|
| `9e5278950343eff5047f55380ebac17465629bcd` | (see git log) |

### Testing

- [OK] `/bin/bash scripts/test-install.sh`
- [OK] `/bin/bash -n scripts/test-install.sh scripts/install.sh src/backend/downloads/install.sh`
- [OK] 真实服务器 daemon bundle 隔离安装
- [OK] 在线脚本真实安装、launchd 进程、WebSocket ESTABLISHED 和远端连接状态

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: 修复并部署 daemon 符号链接安装

**Date**: 2026-09-03
**Task**: 修复并部署 daemon 符号链接安装
**Branch**: `price_sensitive`

### Summary

修复 macOS tar 无法穿过旧 daemon 开发符号链接的问题，新增成功迁移与失败回滚测试，同步并部署服务器在线脚本，在真实 Mac 上安装并验证 launchd、WebSocket 连接及三个 CLI 候选注册。

### Main Changes

- Established `Di Agent` as the canonical UI, prompt, package, module, storage, environment, daemon, and documentation brand.
- Added audited compatibility migration for legacy state, localStorage, MCP configuration, and environment variables.
- Fixed LAN HTTP clipboard fallback and rebuilt the daemon bundle without symlinks.
- Deployed and verified the production server, then migrated this Mac's daemon, sessions, database role, and Docker services.

### Git Commits

| Hash | Message |
|------|---------|
| `5d23a58de2ba682123b5cf1e1c5b1d1e9e0c27ed` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 完成 Di Agent 全量品牌迁移与线上部署

**Date**: 2026-09-03
**Task**: 完成 Di Agent 全量品牌迁移与线上部署
**Branch**: `price_sensitive`

### Summary

统一 Di Agent 品牌、修复内网复制和无符号链接安装包，部署生产服务，迁移本机 daemon/数据库/容器并建立兼容审计。

### Main Changes

- 将全局导航改为 244px 展开 / 72px 收起的显式两态布局，移除整条侧栏 hover 自动展开。
- 顶部 D 标识在 hover/focus 时切换为收起图标；收起态直接显示展开图标。
- 保留全部导航、设置、账户、退出、活动态和未读提示，并为紧凑态补充 Tooltip 与可访问名称。
- 使用本地存储记忆用户选择，处理无效值和存储不可用场景，并适配 reduced motion。
- 修正展开态账户图标轴线以及收起态底部网格的 intrinsic width 溢出。

### Git Commits

| Hash | Message |
|------|---------|
| `71a767f` | (see git log) |
| `b3be08a` | (see git log) |

### Testing

- [OK] Brand audit, macOS installer contract, Windows installer contract, frontend, Electron, Node daemon, Go daemon, focused backend, production health/readiness, and live macOS install.
- [OK] Full backend suite has one pre-existing status-code assertion mismatch: traversal is rejected with 404 instead of the expected 403.

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Codex 与 ZCode Desktop 运行时适配上线

**Date**: 2026-09-03
**Task**: Codex 与 ZCode Desktop 运行时适配上线
**Branch**: `price_sensitive`

### Summary

支持 Codex/ZCode Desktop-only 运行、流式事件、单卡 CLI/Desktop 选择与精确运行时持久化；修复 daemon 离线包符号链接和注册后空任务；完成 0.4.0 打包、双远端推送及 10.190.52.164:8080 生产部署。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `dc49fec` | (see git log) |
| `3585589` | (see git log) |

### Testing

- [OK] 前端 42 个测试文件、184 项测试通过。
- [OK] GlobalRail 聚焦回归测试 5/5 通过。
- [OK] TypeScript 构建和 Vite 生产构建通过。
- [OK] 在 1440px、1024px、390px 实际页面验证收放、状态记忆、导航、Tooltip、键盘焦点和控制台。
- [OK] 三轮独立代码、产品和端到端复核最终均无待处理发现。

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 完成侧边栏显式收放交互

**Date**: 2026-09-03
**Task**: 完成侧边栏显式收放交互
**Branch**: `price_sensitive`

### Summary

将 Di Agent 全局侧边栏改为可记忆的 244px/72px 显式收放；补充 D 图标 hover/focus 变形、紧凑态完整导航与 Tooltip、可访问性、reduced motion 和单元测试，并完成三轮独立代码/产品/E2E 复核。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `6ee6d6a` | (see git log) |
| `0217086` | (see git log) |
| `0424edf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
