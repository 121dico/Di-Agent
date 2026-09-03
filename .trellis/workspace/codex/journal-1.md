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

(Add details)

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
