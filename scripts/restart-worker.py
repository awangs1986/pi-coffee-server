#!/usr/bin/env python3
"""One operator-configured maintenance attempt, independent of Web/Host cgroups."""
import argparse
from contextlib import ExitStack
import stat
import fcntl
import json
import os
import pathlib
import signal
import subprocess
import time
import urllib.request
import urllib.parse
import uuid


def argv(value):
    if not isinstance(value, list) or not value or not all(isinstance(x, str) and x and '\0' not in x for x in value) or not os.path.isabs(value[0]):
        raise ValueError('invalid configuration')
    return value


def read_at(directory, name):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(descriptor, 'r', encoding='utf-8') as file:
        if not stat.S_ISREG(os.fstat(file.fileno()).st_mode):
            raise ValueError('invalid state file')
        return json.loads(file.read(8192))


def atomic_save(directory, owner, operation, name):
    temporary = 'operation.' + str(uuid.uuid4())
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
        os.fchmod(file.fileno(), 0o600)
        if os.geteuid() == 0:
            os.fchown(file.fileno(), owner.st_uid, owner.st_gid)
        json.dump(operation, file)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
    os.fsync(directory)


def save(directory, receipts, owner, operation):
    operation['updatedAt'] = int(time.time() * 1000)
    # Per-ID receipt is authoritative; the current file is only its pointer.
    atomic_save(receipts, owner, operation, operation['id'] + '.json')
    atomic_save(directory, owner, operation, 'operation.json')


def run(config_file):
    # Configuration is operator-owned; requests never supply argv, URLs or units.
    metadata = config_file.stat()
    if config_file.is_symlink() or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o022:
        raise ValueError('unsafe configuration')
    config = json.loads(config_file.read_text())
    root = pathlib.Path(config['stateDir'])
    if not root.is_absolute():
        raise ValueError('invalid state directory')
    with ExitStack() as resources:
        directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        resources.callback(os.close, directory)
        owner = os.fstat(directory)
        if owner.st_mode & 0o022:
            raise ValueError('unsafe spool')
        receipts_created = False
        try:
            os.mkdir('receipts', mode=0o700, dir_fd=directory)
            receipts_created = True
        except FileExistsError:
            pass
        receipts = os.open('receipts', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
        resources.callback(os.close, receipts)
        receipt_owner = os.fstat(receipts)
        if receipt_owner.st_uid not in [owner.st_uid, os.geteuid()] or receipt_owner.st_mode & 0o022:
            raise ValueError('unsafe receipt directory')
        if receipts_created and os.geteuid() == 0:
            os.fchown(receipts, owner.st_uid, owner.st_gid)
        lock_fd = os.open('worker.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        lock = resources.enter_context(os.fdopen(lock_fd, 'a'))
        if not stat.S_ISREG(os.fstat(lock.fileno()).st_mode):
            raise ValueError('unsafe lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = read_at(directory, 'operation.json')
        request = read_at(directory, 'request.json')
        identifier = current['id']
        if str(uuid.UUID(identifier)) != identifier.lower():
            raise ValueError('invalid operation ID')
        if identifier != request['id']:
            return
        try:
            operation = read_at(receipts, identifier + '.json')
        except FileNotFoundError:
            operation = current
        if operation['id'] != identifier or operation['owner'] != current['owner']:
            raise ValueError('invalid receipt')
        if current['phase'] in ['succeeded', 'failed']:
            # Repair a legacy/torn terminal publication without executing commands.
            if operation['phase'] not in ['succeeded', 'failed']:
                save(directory, receipts, owner, current)
            return
        if operation['phase'] in ['succeeded', 'failed']:
            atomic_save(directory, owner, operation, 'operation.json')
            return
        paused = []
        deadline = time.monotonic() + 900
        def interrupted(_signal, _frame):
            raise RuntimeError('interrupted')
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGINT, interrupted)
        def command(value):
            subprocess.run(argv(value), check=True, timeout=max(1, min(360, deadline - time.monotonic())), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            # Unknown outcome from a killed worker is not permission to repeat.
            if operation['phase'] != 'scheduled':
                operation['reason'] = 'interrupted_attempt'
                raise RuntimeError('interrupted attempt')
            if abs(int(time.time() * 1000) - operation['createdAt']) > 300000:
                operation['reason'] = 'expired_request'
                raise RuntimeError('expired request')
            targets = config['targets']
            if not isinstance(targets, list) or [target['role'] for target in targets] != ['host', 'web']:
                raise ValueError('Host then Web required')
            wait = config.get('healthTimeoutSeconds', 90)
            if not isinstance(wait, (int, float)) or not 1 <= wait <= 180:
                raise ValueError('invalid health timeout')
            # Validate every target before any service mutation.
            for target in targets:
                for key in ['restart', 'pause', 'resume']:
                    argv(target[key])
                url = urllib.parse.urlparse(target['healthUrl'])
                if url.scheme not in ['http', 'https'] or not url.hostname or url.username or url.password or url.path != '/healthz':
                    raise ValueError('invalid health URL')
            operation['phase'] = 'running'
            save(directory, receipts, owner, operation)
            for target in targets:
                operation['step'] = 'pause-' + target['role']
                save(directory, receipts, owner, operation)
                # Resume even after an ambiguous pause-command failure.
                paused.append(target)
                command(target['pause'])
            for target in targets:
                operation['step'] = 'restart-' + target['role']
                save(directory, receipts, owner, operation)
                command(target['restart'])
                operation['step'] = 'health-' + target['role']
                save(directory, receipts, owner, operation)
                until = min(deadline, time.monotonic() + wait)
                while True:
                    try:
                        with urllib.request.urlopen(target['healthUrl'], timeout=max(0.1, min(3, until-time.monotonic()))) as response:
                            body = json.loads(response.read(8192))
                            if response.status == 200 and body.get('ok') is True and body.get('role') == target['role']:
                                break
                    except Exception:
                        pass
                    if time.monotonic() >= until:
                        raise RuntimeError('health failed')
                    time.sleep(min(1, max(0, until-time.monotonic())))
            operation['phase'] = 'succeeded'
        except Exception:
            operation['phase'] = 'failed'
            operation.setdefault('reason', 'step_failed')
        finally:
            for target in reversed(paused):
                try:
                    command(target['resume'])
                except Exception:
                    operation['phase'] = 'failed'
                    operation['reason'] = 'watchdog_resume_failed'
            save(directory, receipts, owner, operation)
        if operation['phase'] != 'succeeded':
            raise RuntimeError('restart failed; inspect operator journal')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=pathlib.Path, required=True)
    try:
        run(parser.parse_args().config)
    except Exception:
        print('Restart attempt failed; no automatic retry.')
        raise SystemExit(1)
