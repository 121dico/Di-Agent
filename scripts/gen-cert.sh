#!/bin/bash
# 生成自签名 HTTPS 证书（用于局域网部署解锁浏览器安全上下文 API，如剪贴板复制）
# 用法: bash scripts/gen-cert.sh [IP地址]
#   不传 IP 时自动取本机主网卡地址
# 产物: src/backend/certs/server.crt + server.key（config.yaml 引用）

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/src/backend/certs"
mkdir -p "$CERT_DIR"

IP="${1:-}"
if [ -z "$IP" ]; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
fi
if [ -z "$IP" ]; then
  echo "ERROR: 无法自动获取本机 IP，请手动传入: bash scripts/gen-cert.sh <IP>" >&2
  exit 1
fi

echo "生成自签名证书，SAN: IP:${IP}, IP:127.0.0.1, DNS:localhost"
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -subj "/CN=agenthub-local" \
  -addext "subjectAltName=IP:${IP},IP:127.0.0.1,DNS:localhost" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

chmod 600 "$CERT_DIR/server.key"
echo "完成: $CERT_DIR/server.crt"
echo "config.yaml 参考:"
echo "  server:"
echo "    tls_port: 8443"
echo "    tls_cert: certs/server.crt"
echo "    tls_key: certs/server.key"
