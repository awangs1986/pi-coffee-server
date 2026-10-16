#!/usr/bin/env python3
"""Offline, operator-owned Web migration. Commands are argv arrays, never shell text."""
import argparse
import fcntl
import json
import os
import subprocess
from pathlib import Path


def migrate(config, state_dir, action):
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    def save(phase):
        temp = state_dir / 'state.tmp'
        with temp.open('w') as out:
            json.dump({'phase': phase}, out)
            out.flush()
            os.fsync(out.fileno())
        temp.replace(state_dir / 'state.json')
    def call(side, operation):
        command = config[side][operation]
        if not isinstance(command, list) or not command or not all(isinstance(x, str) for x in command):
            raise RuntimeError('Invalid operator command')
        # Never print child output: controllers may handle private configuration.
        result = subprocess.run(command, capture_output=True, timeout=420)
        if result.returncode:
            raise RuntimeError(side + ':' + operation + ' failed')
        return json.loads(result.stdout) if operation == 'status' else None
    def down(side):
        status = call(side, 'status')
        if status.get('active') is not False or status.get('fenced') is not True:
            raise RuntimeError(side + ' is not confirmed stopped and fenced')
    def rollback():
        save('rollback-target-fence')
        call('target', 'fence')
        down('target')  # An unreachable target is NOT proof of shutdown.
        save('rollback-source-start')
        call('source', 'activate')
        call('source', 'verify')
        save('rolled-back')
    with (state_dir / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if action == 'rollback':
            rollback()
            return
        if action == 'preflight':
            call('source', 'preflight')
            call('target', 'preflight')
            down('target')
            return
        previous = state_dir / 'state.json'
        if previous.exists():
            phase = json.loads(previous.read_text())['phase']
            if phase == 'complete':
                down('source')
                call('target', 'verify')
                return
            if phase != 'rolled-back':
                raise RuntimeError('Interrupted migration: run rollback before retrying')
        call('source', 'preflight')
        call('target', 'preflight')
        down('target')
        save('source-fencing')
        try:
            call('source', 'fence')
            down('source')
            save('target-starting')
            call('target', 'activate')
            call('target', 'verify')
            down('source')
            save('complete')
        except Exception:
            rollback()
            raise


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('action', choices=['preflight', 'migrate', 'rollback'])
    args = parser.parse_args()
    try:
        migrate(json.loads(Path(args.config).read_text()), Path(args.state_dir), args.action)
        print(json.dumps({'ok': True, 'action': args.action}))
    except Exception as error:
        # Exception text is limited to our own labels, never command output.
        print(json.dumps({'ok': False, 'errorType': type(error).__name__}))
        raise SystemExit(1)
