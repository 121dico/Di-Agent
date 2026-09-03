#!/bin/bash
# 启动开发环境：数据库 + 后端 + 前端
set -e

GO_BIN="${GO_BIN:-go}"
if ! command -v "$GO_BIN" >/dev/null 2>&1; then
  if command -v go.exe >/dev/null 2>&1; then
    GO_BIN="go.exe"
  else
    echo "go/go.exe not found in PATH" >&2
    exit 127
  fi
fi

echo "启动 PostgreSQL..."
docker compose up -d postgres

echo "等待数据库就绪..."
DB_USER="${DI_AGENT_DB_USER:-di_agent}"
DB_PASSWORD="${DI_AGENT_DB_PASSWORD:-di_agent}"
DB_NAME="${DI_AGENT_DB_NAME:-di_agent}"
until docker compose exec -T postgres pg_isready -U "$DB_USER" -q || \
  docker compose exec -T postgres pg_isready -U agenthub -q; do # [brand-compat]
  sleep 1
done

# PostgreSQL 初始化变量只在空卷首次生效；已有旧卷继续使用其物理身份。
if ! docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -Atqc 'SELECT 1' >/dev/null 2>&1; then
  if docker compose exec -T postgres psql -U agenthub -d agenthub -Atqc 'SELECT 1' >/dev/null 2>&1; then # [brand-compat]
    DB_USER="agenthub" # [brand-compat]
    DB_PASSWORD="agenthub" # [brand-compat]
    DB_NAME="agenthub" # [brand-compat]
    echo "检测到升级前的 PostgreSQL 数据卷，保留现有物理数据库身份"
  else
    echo "数据库身份不可用：既未找到 canonical 数据库，也未找到可兼容的旧数据卷" >&2
    exit 1
  fi
fi
echo "数据库就绪"

echo "运行迁移..."
for f in src/backend/migrations/*.sql; do
  PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -f "$f"
done

echo "启动后端服务..."
(
  cd src/backend
  "$GO_BIN" run ./cmd/server
) &
BACKEND_PID=$!

echo "启动前端开发服务器..."
(
  cd src/frontend
  npm run dev
) &
FRONTEND_PID=$!

echo "开发环境已启动 (后端 PID: $BACKEND_PID, 前端 PID: $FRONTEND_PID)"
echo "按 Ctrl+C 停止所有服务"

cleanup() {
  echo "停止服务..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  docker compose down
}
trap cleanup EXIT INT TERM

wait
