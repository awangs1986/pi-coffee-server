#!/usr/bin/env python3
"""Private consistent state backups; restore only to a new, empty staging path."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path


def inventory(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if path.name == 'manifest.json' and path.parent == root:
            continue
        key = str(path.relative_to(root))
        if path.is_symlink():
            result[key] = {'link': os.readlink(path)}
        elif path.is_file():
            digest = hashlib.sha256()
            with path.open('rb') as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
            result[key] = {'sha256': digest.hexdigest(), 'size': path.stat().st_size}
    return result


def verify(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    if manifest.get('version') != 1 or manifest['files'] != inventory(root):
        raise RuntimeError('Backup verification failed; retain it for inspection')
    return manifest


def create(config, destination):
    # The operator supplies a deterministic check for stopped writers. Running
    # services must not be inferred safe merely because no user is typing.
    subprocess.run(config['quiesceCheck'], check=True, capture_output=True, timeout=30)
    roots = config['roots']
    if not roots or any(not label.replace('-', '').replace('_', '').isalnum() for label in roots):
        raise ValueError('Use explicit labelled backup roots')
    for value in roots.values():
        source = Path(value)
        if not source.is_absolute() or not source.exists() or source.is_symlink():
            raise ValueError('Backup root must exist and be an absolute non-symlink path')
        if destination.resolve().is_relative_to(source.resolve()):
            raise ValueError('Backup destination must be outside source roots')
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    # An interrupted snapshot has no committed manifest and cannot pass verify.
    for label, value in roots.items():
        source = Path(value)
        if source.is_dir():
            shutil.copytree(source, destination / label, symlinks=True)
        else:
            shutil.copy2(source, destination / label)
    subprocess.run(config['quiesceCheck'], check=True, capture_output=True, timeout=30)
    manifest = {'version': 1, 'roots': roots, 'files': inventory(destination)}
    path = destination / 'manifest.json'
    with path.open('x') as file:
        json.dump(manifest, file)
        file.flush()
        os.fsync(file.fileno())
    verify(destination)


def restore(source, destination):
    verify(source)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Restore requires a new destination; live paths are never overwritten')
    shutil.copytree(source, destination, symlinks=True)
    destination.chmod(0o700)
    verify(destination)


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['create', 'verify', 'restore'])
    parser.add_argument('--config')
    parser.add_argument('--source')
    parser.add_argument('--destination')
    args = parser.parse_args()
    try:
        if args.action == 'create':
            create(json.loads(Path(args.config).read_text()), Path(args.destination))
        elif args.action == 'restore':
            restore(Path(args.source), Path(args.destination))
        else:
            verify(Path(args.source))
        print(json.dumps({'ok': True, 'action': args.action}))
    except Exception as error:
        print(json.dumps({'ok': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
