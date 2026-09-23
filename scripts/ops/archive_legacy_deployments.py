#!/usr/bin/env python3
"""归档线上旧发布残留，默认只预览；原位恢复时拒绝覆盖现有文件。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone

ROOTS = {'main': Path('/root/energy_tag_agent'), 'delivery': Path('/root/delivery_insight_ai')}
PATTERNS = {
    'main': ('frontend-dist.pre-*', 'frontend-dist.old-*', 'frontend-dist.context-previous',
             'frontend-dist.source-build-broken-*', 'server.pre-*', 'server.delivery-*', '.deploy-*'),
    'delivery': ('agent-stage-*', 'agent-backup-*', 'prd-stage-*', 'prd-backup-*', '._*'),
}


def inventory(path):
    files = sorted(path.rglob('*')) if path.is_dir() else [path]
    digest, size, count = hashlib.sha256(), 0, 0
    for file in files:
        if file.is_symlink():
            raise RuntimeError('候选包含符号链接，需单独核查: ' + str(file))
        if not file.is_file():
            continue
        digest.update(str(file.relative_to(path) if file != path else file.name).encode())
        with file.open('rb') as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                digest.update(chunk)
                size += len(chunk)
        count += 1
    return {'sha256': digest.hexdigest(), 'bytes': size, 'files': count}


def active_paths():
    paths = []
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            paths.extend(proc.joinpath('cmdline').read_bytes().decode(errors='replace').split('\0'))
            for entry in [proc / 'cwd', proc / 'exe', *proc.joinpath('fd').glob('*')]:
                try:
                    paths.append(os.readlink(entry))
                except OSError:
                    pass
        except OSError:
            pass
    return paths


def save(path, data):
    tmp = path.with_suffix('.next')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--archive-root', default='/root/di-agent-archives')
    parser.add_argument('--restore', type=Path)
    args = parser.parse_args()
    if args.restore:
        data = json.loads(args.restore.read_text())
        moved = [row for row in data['items'] if row.get('moved')]
        for row in moved:
            if Path(row['source']).exists():
                raise RuntimeError('恢复目标已存在: ' + row['source'])
            if inventory(Path(row['destination'])) != row['inventory']:
                raise RuntimeError('归档内容已变化: ' + row['destination'])
        if args.apply:
            for row in reversed(moved):
                Path(row['destination']).rename(row['source'])
                row['moved'] = False
                save(args.restore, data)
        print(json.dumps({'restore': len(moved), 'applied': args.apply}))
        return
    archive = Path(args.archive_root) / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    active = active_paths()
    items = []
    for label, root in ROOTS.items():
        candidates = sorted({p for pattern in PATTERNS[label] for p in root.glob(pattern)})
        for source in candidates:
            if source.is_symlink() or any(str(source) in value for value in active):
                raise RuntimeError('文件仍在使用或为链接，停止归档: ' + str(source))
            items.append({'source': str(source), 'destination': str(archive / label / source.name),
                          'inventory': inventory(source), 'moved': False})
    data = {'created_at': datetime.now(timezone.utc).isoformat(), 'items': items}
    if args.apply and items:
        archive.mkdir(parents=True, mode=0o700)
        manifest = archive / 'manifest.json'
        save(manifest, data)
        for row in items:
            src, dst = Path(row['source']), Path(row['destination'])
            if inventory(src) != row['inventory']:
                raise RuntimeError('检查后文件发生变化，停止归档: ' + str(src))
            dst.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dst)
            row['moved'] = True
            save(manifest, data)
    print(json.dumps({'applied': args.apply, 'items': len(items),
                      'bytes': sum(row['inventory']['bytes'] for row in items),
                      'archive': str(archive) if args.apply and items else None}, ensure_ascii=False))


if __name__ == '__main__':
    main()
