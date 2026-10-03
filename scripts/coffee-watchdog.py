#!/usr/bin/env python3
"""Local service recovery with a durable circuit breaker; no external dependencies."""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = '1.0.0'
DEFAULTS = {'failureThreshold': 3, 'restartLimit': 3, 'restartWindowSeconds': 1800,
            'cooldownSeconds': 300, 'healthyResetSeconds': 600, 'probeTimeoutSeconds': 3}
MAX_OBSERVATION_GAP_SECONDS = 90  # Three ordinary timer periods; missed samples are not health evidence.


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}, sort_keys=True), flush=True)


def load_config(path):
    value = json.loads(Path(path).read_text())
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('targets'), list) or not value['targets']:
        raise ValueError('Expected version 1 and non-empty targets')
    policy = {**DEFAULTS, **value.get('policy', {})}
    if set(policy) != set(DEFAULTS) or any(type(v) is not int or v < 1 for v in policy.values()):
        raise ValueError('Invalid watchdog policy')
    if policy['restartLimit'] > 10 or policy['probeTimeoutSeconds'] > 10:
        raise ValueError('Restart/probe policy exceeds safety bound')
    ids = set()
    for target in value['targets']:
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', target['id']) or target['id'] in ids:
            raise ValueError('Invalid or duplicate target id')
        ids.add(target['id'])
        if not re.fullmatch(r'pi-coffee-[a-z0-9-]+\.service', target['unit']):
            raise ValueError('Expected a PI Coffee service unit')
        if target.get('manager') not in ('user', 'system') or target.get('role') not in ('host', 'web'):
            raise ValueError('Invalid target manager/role')
        url = urllib.parse.urlsplit(target['healthUrl'])
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.fragment:
            raise ValueError('Invalid credential-free health URL')
    return {**value, 'policy': policy}


def read_state(path):
    if not path.exists():
        return {'version': 1, 'targets': {}, 'pausedUntil': 0}
    value = json.loads(path.read_text())
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('targets'), dict):
        raise ValueError('Invalid watchdog state; retain it and investigate')
    if not isinstance(value.get('pausedUntil', 0), (int, float)) or not math.isfinite(value.get('pausedUntil', 0)):
        raise ValueError('Invalid maintenance state')
    for item in value['targets'].values():
        if not isinstance(item, dict) or not isinstance(item.get('attempts', []), list):
            raise ValueError('Invalid target state; recovery disabled')
        if any(type(n) not in (int, float) or not math.isfinite(n) or n < 0 for n in item.get('attempts', [])):
            raise ValueError('Invalid restart budget; recovery disabled')
        if type(item.get('circuitOpen')) is not bool or type(item.get('failures')) is not int or item['failures'] < 0:
            raise ValueError('Invalid target failure state')
        item.setdefault('incidentAttempts', len(item['attempts']))
        if type(item['incidentAttempts']) is not int or item['incidentAttempts'] < 0:
            raise ValueError('Invalid incident budget')
        for field in ('lastAttemptAt', 'healthySince', 'lastReminderAt', 'checkedAt'):
            if field in item and (type(item[field]) not in (int, float) or not math.isfinite(item[field]) or item[field] < 0):
                raise ValueError('Invalid recovery timestamp')
    return value


def save_state(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.state-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def systemctl(executable, target, *arguments):
    command = [executable] + (['--user'] if target['manager'] == 'user' else []) + list(arguments)
    return subprocess.run(command, text=True, capture_output=True, timeout=10, check=False)


def service_status(executable, target):
    result = systemctl(executable, target, 'show', target['unit'], '--no-pager',
                       '--property=LoadState,ActiveState,SubState,Result,MainPID,NRestarts')
    if result.returncode:
        raise RuntimeError('service manager unavailable')
    data = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if data.get('LoadState') != 'loaded':
        raise RuntimeError('configured service is not loaded')
    return data


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def probe(target, timeout):
    # Ignore proxy environment: the configured endpoint belongs to this machine.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(target['healthUrl'], timeout=timeout) as response:
            data = json.loads(response.read(8193))
            if response.status == 200 and isinstance(data, dict) and data.get('ok') is True and data.get('role') == target['role']:
                return True, 'ok'
            return False, 'unexpected-health-response'
    except (OSError, ValueError, urllib.error.URLError):
        return False, 'health-unreachable-or-invalid'


def check(config, state, path, executable, now):
    if now < state.get('pausedUntil', 0):
        emit('maintenance', until=state['pausedUntil'])
        return
    if state.get('pausedUntil', 0):
        state['pausedUntil'] = 0
        for item in state['targets'].values():
            item['failures'] = 0
            item.pop('healthySince', None)
    policy = config['policy']
    for target in config['targets']:
        item = state['targets'].setdefault(target['id'], {'attempts': [], 'incidentAttempts': 0, 'failures': 0, 'circuitOpen': False})
        previous_check = item.get('checkedAt', now)
        if now < previous_check or now-previous_check > MAX_OBSERVATION_GAP_SECONDS:
            item.pop('healthySince', None)
            item['failures'] = 0
        item['checkedAt'] = now
        item['attempts'] = [stamp for stamp in item['attempts'] if stamp > now-policy['restartWindowSeconds']]
        previous = item.get('status')
        try:
            service = service_status(executable, target)
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            item.pop('healthySince', None)
            item.update(status='manager-unavailable', healthy=False, failures=0)
            emit('manager-unavailable', target=target['id'])
            continue  # An observation failure is never evidence that a restart is safe/useful.
        item['service'] = service
        healthy, reason = probe(target, policy['probeTimeoutSeconds']) if service['ActiveState'] == 'active' else (False, 'service-not-active')
        item['healthy'] = healthy
        if healthy:
            item['failures'] = 0
            item.setdefault('healthySince', now)
            if not item['circuitOpen'] and now - item['healthySince'] >= policy['healthyResetSeconds']:
                item['incidentAttempts'] = 0
            item['status'] = 'healthy-circuit-open' if item['circuitOpen'] else 'healthy'
        else:
            item.pop('healthySince', None)
            if service.get('Result') == 'start-limit-hit':
                item.update(circuitOpen=True, reason='systemd-start-limit')
            if item['circuitOpen']:
                item['status'] = 'circuit-open'
            elif service['ActiveState'] in ('activating', 'deactivating', 'reloading'):
                item['failures'] = 0
                item['status'] = 'transitioning'  # Never race systemd's own start/stop/restart job.
            elif now < item.get('lastAttemptAt', 0) + policy['cooldownSeconds']:
                item['status'] = 'cooldown'
            else:
                item['failures'] += 1
                item['reason'] = reason
                item['status'] = 'suspect'
                if item['failures'] >= policy['failureThreshold']:
                    attempts = item['attempts']
                    # Both the rolling budget and this unresolved incident are bounded.
                    recent = sum(stamp > now-policy['restartWindowSeconds'] for stamp in attempts)
                    if item['incidentAttempts'] >= policy['restartLimit'] or recent >= policy['restartLimit']:
                        item.update(circuitOpen=True, status='circuit-open', reason='restart-budget-exhausted')
                    else:
                        action = 'restart' if service['ActiveState'] == 'active' else 'start'
                        item['attempts'].append(now)
                        item['incidentAttempts'] += 1
                        item.update(lastAttemptAt=now, failures=0, status='recovery-requested')
                        save_state(path, state)  # Charge the budget BEFORE issuing the external action.
                        try:
                            result = systemctl(executable, target, '--no-block', action, target['unit'])
                            item['commandExit'] = result.returncode
                        except (OSError, subprocess.TimeoutExpired):
                            item['commandExit'] = -1
                        if item['commandExit']:
                            item.update(status='recovery-command-failed', reason='service-manager-command-failed')
                        emit('recovery-requested', target=target['id'], action=action,
                             attempt=item['incidentAttempts'], exit=item['commandExit'])
        if item['status'] != previous:
            emit('state', target=target['id'], status=item['status'], reason=item.get('reason'))
        elif item['status'] == 'circuit-open' and now-item.get('lastReminderAt', 0) >= 1800:
            emit('circuit-open', target=target['id'], reason=item.get('reason'))
            item['lastReminderAt'] = now
    save_state(path, state)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', action='version', version=VERSION)
    parser.add_argument('--config', required=True)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--systemctl', default='/usr/bin/systemctl', help=argparse.SUPPRESS)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check')
    commands.add_parser('status')
    pause = commands.add_parser('pause')
    pause.add_argument('--seconds', type=int, default=900)
    commands.add_parser('resume')
    rearm = commands.add_parser('rearm')
    rearm.add_argument('target')
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        directory = Path(args.state_dir)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = directory/'state.json'
        if args.command == 'status':
            # Atomic replacement makes snapshots readable while a check holds the action lock.
            emit('status', watchdogVersion=VERSION, **read_state(path))
            return 0
        with (directory/'watchdog.lock').open('a') as lock:
            deadline = time.monotonic()+15
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if args.command == 'check':
                        emit('already-running')
                        return 0
                    if time.monotonic() >= deadline:
                        emit('management-busy', command=args.command, applied=False)
                        return 3
                    time.sleep(0.05)
            state = read_state(path)
            now = time.time()
            if args.command == 'check':
                check(config, state, path, args.systemctl, now)
            elif args.command == 'pause':
                if not 1 <= args.seconds <= 86400:
                    raise ValueError('Pause must be between 1 second and 24 hours')
                state['pausedUntil'] = now+args.seconds
                for item in state['targets'].values():
                    item['failures'] = 0
                    item.pop('healthySince', None)
                save_state(path, state)
                emit('maintenance', until=state['pausedUntil'])
            elif args.command == 'resume':
                state['pausedUntil'] = 0
                for item in state['targets'].values():
                    item['failures'] = 0
                    item.pop('healthySince', None)
                save_state(path, state)
                emit('resumed')
            elif args.command == 'rearm':
                if args.target not in {target['id'] for target in config['targets']}:
                    raise ValueError('Unknown target')
                backup = directory/f'rearm-{time.time_ns()}.json'
                if path.exists():
                    backup.write_bytes(path.read_bytes())
                    backup.chmod(0o600)
                state['targets'][args.target] = {'attempts': [], 'incidentAttempts': 0, 'failures': 0, 'circuitOpen': False}
                save_state(path, state)
                emit('rearmed', target=args.target)
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        emit('watchdog-error', error=type(error).__name__, recovery='disabled; inspect config/state and journal')
        return 2


if __name__ == '__main__':
    sys.exit(main())
