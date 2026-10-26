# Scripts

项目所有构建、测试、启动操作统一通过本目录下的脚本执行。

## build.sh — 构建

```bash
bash scripts/build.sh
```

- 编译后端 Go 二进制 → `bin/server`
- 构建前端 Vite 产物 → `src/frontend/dist/`

## test.sh — 测试

```bash
bash scripts/test.sh              # 运行全部测试
bash scripts/test.sh -run TestFoo # 运行指定测试
bash scripts/test.sh -v           # 详细输出
```

- 运行 `src/backend/internal/...` 下所有 Go 测试
- 额外参数会透传给 `go test`

## dev.sh — 开发环境

```bash
bash scripts/dev.sh
```

- 启动 PostgreSQL（docker compose）
- 等待数据库就绪并运行迁移
- 启动后端 `go run` + 前端 `npm run dev`
- Ctrl+C 停止所有服务

## 注意事项

- 所有脚本从项目根目录执行，内部自行 cd 到子目录
- 不要手动 cd 到 `src/backend` 再运行 go build/test，工作目录不会在命令间保持

## ops/ — 线上维护

### 头像发布验证

```bash
# 发布前：以仓库原始头像清单逐文件核对 dist，缺失或内容不一致即退出 1。
python3 scripts/verify_avatar_release.py src/frontend/dist
# 发布后：再逐文件验证线上 HTTP 200、图片 MIME 和内容哈希。
python3 scripts/verify_avatar_release.py src/frontend/dist --base-url http://10.190.43.41:8080
python3 scripts/test_verify_avatar_release.py
```

脚本只读、不发布、不写线上文件。不能用只有 `index.html` 和 `assets/` 的包代替完整 Vite dist；`public/avatars/` 也必须随包发布。`--source-dir` 可指定经核验的源头像目录，默认是仓库 `src/frontend/public/avatars`。

`python3 scripts/ops/archive_legacy_deployments.py` 预览旧发布残留；`--apply` 可恢复归档，`--restore <manifest.json>` 预览恢复。
目录职责和发布检查见 [线上目录与发布规则](../doc/operations/production-layout.md)。
