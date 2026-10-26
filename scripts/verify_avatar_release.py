#!/usr/bin/env python3
"""只读检查发布头像；不修改构建产物或线上文件。"""

import argparse
import hashlib
from pathlib import Path
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # 登录页等重定向不能作为原始静态资源发布成功的证据。
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dist_dir", type=Path, help="待发布 frontend dist 根目录")
    parser.add_argument("--source-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] / "src/frontend/public/avatars")
    parser.add_argument("--base-url", help="可选：已发布站点根 URL")
    parser.add_argument("--timeout", type=float, default=10, help="每次 HTTP 请求超时秒数")
    args = parser.parse_args()
    if args.base_url:
        url = urlsplit(args.base_url)
        if url.scheme not in ("http", "https") or not url.netloc or url.username or url.password or url.query or url.fragment:
            parser.error("base URL must be HTTP(S), without credentials, query or fragment")
    if args.timeout <= 0:
        parser.error("timeout must be positive")
    sources = sorted(path for path in args.source_dir.rglob("*") if path.is_file())
    if not sources:
        print("FAIL source avatar directory is missing or empty")
        return 1
    failed = False
    opener = build_opener(NoRedirect())
    for source in sources:
        relative = source.relative_to(args.source_dir)
        target = args.dist_dir / "avatars" / relative
        expected = source.read_bytes()
        expected_hash = hashlib.sha256(expected).digest()
        if not target.is_file():
            print(f"FAIL missing avatar: {relative}")
            failed = True
        elif hashlib.sha256(target.read_bytes()).digest() != expected_hash:
            print(f"FAIL local hash mismatch: {relative}")
            failed = True
        if args.base_url:
            mime = {".png": "image/png", ".svg": "image/svg+xml"}.get(source.suffix.lower())
            if mime is None:
                print(f"FAIL unsupported avatar MIME: {relative}")
                failed = True
                continue
            request = Request(args.base_url.rstrip("/") + "/avatars/" + quote(relative.as_posix()),
                              headers={"Cache-Control": "no-cache", "Accept": mime})
            try:
                with opener.open(request, timeout=args.timeout) as response:
                    if response.status != 200:
                        raise ValueError(f"HTTP status {response.status}, expected 200")
                    if response.headers.get_content_type() != mime:
                        raise ValueError(f"MIME {response.headers.get_content_type()}, expected {mime}")
                    # 响应最多读取预期大小加一字节，避免错误页面或大响应无限占用内存。
                    if hashlib.sha256(response.read(len(expected) + 1)).digest() != expected_hash:
                        raise ValueError("HTTP hash mismatch")
            except (OSError, ValueError) as error:
                print(f"FAIL HTTP avatar {relative}: {error}")
                failed = True
    if failed:
        return 1
    print(f"PASS {len(sources)} avatar files: local hashes" + (" and HTTP status/MIME/bytes" if args.base_url else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
