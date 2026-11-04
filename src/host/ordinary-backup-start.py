"""Operator-owned fixed service launch. No network enrollment or arbitrary argv.

Private policy enrollment is trusted startup configuration, not application
administrator authority. The latter remains in the unchanged policy fields.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import sys
import time
import uuid

MAX = 131072


class Refused(Exception):
    pass


def need(condition, code='startup_configuration_invalid'):
    if not condition:
        raise Refused(code)


def unique(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value)
        value[key] = item
    return value


def encode(value):
    raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    need(len(raw) <= MAX, 'startup_record_limit')
    return raw


def canonical(path):
    need(isinstance(path, str) and Path(path).is_absolute() and os.path.realpath(path) == path)
    return Path(path)


def private_directory(path):
    path = canonical(str(path))
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077)
    return path


def private_bytes(path):
    path = canonical(str(path))
    private_directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077 and info.st_nlink == 1 and info.st_size <= MAX)
        raw = os.read(fd, MAX + 1)
        need(len(raw) == info.st_size and len(raw) <= MAX)
        return raw
    finally:
        os.close(fd)


def read_json(path):
    return json.loads(private_bytes(path), object_pairs_hook=unique)


def atomic(path, raw):
    path = Path(path)
    private_directory(path.parent)
    temp = path.parent / (str(uuid.uuid4()) + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as out:
            out.write(raw)
            out.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temp, path)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def lock(path, inherited=False, timeout=0):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and not info.st_mode & 0o077 and info.st_nlink == 1)
    deadline = time.monotonic() + timeout
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(fd)
                raise Refused('startup_already_active')
            time.sleep(0.02)
    os.set_inheritable(fd, inherited)
    return fd


def bounded_proc(path):
    with open(path, 'rb') as source:
        raw = source.read(65537)
    need(len(raw) <= 65536, 'startup_process_unreadable')
    return raw


def process_identity(pid):
    need(type(pid) is int and pid > 0)
    raw = bounded_proc('/proc/%d/stat' % pid).decode()
    fields = raw[raw.rindex(')') + 2:].split()
    status = bounded_proc('/proc/%d/status' % pid).decode()
    match = re.search(r'^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)', status, re.M)
    need(match and len(set(match.groups())) == 1 and fields[0] not in ('Z', 'X'), 'startup_process_unreadable')
    return {'pid': pid, 'uid': int(match.group(1)), 'birth': fields[19], 'boot': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def assert_dead(identity):
    need(isinstance(identity, dict) and set(identity) == {'pid', 'uid', 'boot', 'birth'} and identity['uid'] == os.getuid(), 'startup_slot_changed')
    if identity['boot'] != Path('/proc/sys/kernel/random/boot_id').read_text().strip():
        return
    try:
        current = process_identity(identity['pid'])
    except FileNotFoundError:
        return
    need(current['birth'] != identity['birth'], 'startup_already_active')


def executable(path):
    path = canonical(path)
    info = path.stat()
    need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o022 and os.access(path, os.X_OK))
    return str(path)


def release_file(root, name):
    path = canonical(str(root / 'dist' / 'src' / name))
    info = path.stat()
    need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o022)
    return str(path)


def observed_listener(config, settings, python, listener):
    path = canonical(settings['socket'])
    private_directory(path.parent)
    before = path.lstat()
    need(stat.S_ISSOCK(before.st_mode) and before.st_uid == os.getuid() and not before.st_mode & 0o007, 'startup_listener_unavailable')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(3)
        connection.connect(str(path))
        pid, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        identity = process_identity(pid)
        need(uid == os.getuid() and identity['uid'] == uid, 'startup_listener_mismatch')
        command = bounded_proc('/proc/%d/cmdline' % pid).decode().rstrip('\0').split('\0')
        need(command == [python, listener, 'serve', config['keyConfig']], 'startup_listener_mismatch')
        after = path.lstat()
        need((before.st_dev, before.st_ino) == (after.st_dev, after.st_ino) and process_identity(pid) == identity, 'startup_listener_changed')
    return {'listener': identity, 'workerCommand': [settings['node'], settings['handler'], config['keyConfig']]}, {'path': str(path), 'dev': after.st_dev, 'ino': after.st_ino, 'ctimeNs': after.st_ctime_ns, 'pid': pid}


def application(policy, client):
    need(policy.get('schema') == 1 and type(policy.get('revision')) is int and policy['revision'] >= 1 and policy['revision'] == client['authorityRevision'], 'startup_authority_stale')
    actor = policy.get('actors', {}).get(client['actor'], {})
    need(client['actor'] == policy.get('administrator') and actor.get('role') == 'administrator' and client['dataScope'] in actor.get('scopes', []) and client['dataScope'] in policy.get('scopes', []), 'startup_actor_denied')


def transaction(root, entries, config_hash):
    journal = root / 'transaction.json'
    value = {'schema': 1, 'configurationDigest': config_hash, 'entries': entries, 'entriesDigest': hashlib.sha256(encode(entries)).hexdigest()}
    atomic(journal, encode(value))
    apply_journal(root, config_hash, {row['path'] for row in entries})


def apply_journal(root, config_hash, allowed):
    journal = root / 'transaction.json'
    if not journal.exists():
        return
    value = read_json(journal)
    need(value.get('schema') == 1 and value.get('configurationDigest') == config_hash and isinstance(value.get('entries'), list) and 1 <= len(value['entries']) <= 3, 'startup_journal_changed')
    entries = value['entries']
    need(value.get('entriesDigest') == hashlib.sha256(encode(entries)).hexdigest(), 'startup_journal_changed')
    need(len({row['path'] for row in entries}) == len(entries) and all(set(row) == {'path', 'before', 'after'} and row['path'] in allowed for row in entries), 'startup_journal_changed')
    for row in entries:
        current = private_bytes(row['path']).decode()
        need(current in (row['before'], row['after']), 'startup_policy_changed')
    for row in entries:
        current = private_bytes(row['path']).decode()
        need(current in (row['before'], row['after']), 'startup_policy_changed')
        if current != row['after']:
            atomic(row['path'], row['after'].encode())
    journal.unlink()
    parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def arguments(config, role, release):
    if role == 'key':
        return [release_file(release, 'host/backup-unix-peer.py'), 'serve', config['keyConfig']]
    if role == 'host':
        return [release_file(release, 'main.js'), 'host']
    if role == 'scheduler':
        return [release_file(release, 'backup-cli.js'), 'schedule-daemon', '--root', config['backupRoot'], '--broker-profile', config['brokerProfile']]
    operation = config.get('operator', {})
    commands = {'status': {'scope'}, 'configure': set(), 'export': {'output'}, 'verify': {'recovery'}, 'run': {'selection'}, 'recover': set(), 'rotate': set(), 'schedule-configure': {'policy'}, 'schedule-tick': set(), 'schedule-status': {'scope'}, 'retention-preview': {'scopes', 'time-zone'}, 'retention-status': {'scope'}, 'retention-execute': {'plan', 'revision', 'digest'}}
    name, options = operation.get('command'), operation.get('options')
    need(name in commands and isinstance(options, dict) and set(options) == commands[name] and all(isinstance(v, str) and '\0' not in v for v in options.values()))
    return [release_file(release, 'backup-cli.js'), name, '--root', config['backupRoot'], '--broker-profile', config['brokerProfile'], *[part for k, v in options.items() for part in ('--' + k, v)]]



def record_listener_socket(profile, key_config, socket_path, temporary=None):
    """Called by the fixed listener after bind, before accepting any client."""
    config = read_json(profile)
    need(config.get('schema') == 1 and config.get('keyConfig') == key_config)
    root = private_directory(config['root'])
    guard = lock(root / 'policy.lock', timeout=5)
    try:
        need(not (root / 'transaction.json').exists(), 'startup_journal_pending')
        state = read_json(root / 'state.json')
        current = process_identity(os.getpid())
        need(state.get('roles', {}).get('key') == current and state.get('listener', {}).get('listener') == current, 'startup_slot_changed')
        settings = read_json(key_config)
        need(settings['socket'] == socket_path and state['listener']['workerCommand'] == [settings['node'], settings['handler'], key_config])
        expected = [config['python'], release_file(canonical(config['releaseRoot']), 'host/backup-unix-peer.py'), 'serve', key_config]
        need(bounded_proc('/proc/self/cmdline').decode().rstrip('\0').split('\0') == expected, 'startup_listener_mismatch')
        if temporary is not None:
            need(Path(temporary).parent == Path(socket_path).parent and re.fullmatch(r'\.k[a-f0-9]{6}', Path(temporary).name))
        info = canonical(temporary or socket_path).lstat()
        need(stat.S_ISSOCK(info.st_mode) and info.st_uid == os.getuid())
        state['listenerSocket'] = {'path': socket_path, 'dev': info.st_dev, 'ino': info.st_ino, 'ctimeNs': info.st_ctime_ns, 'pid': current['pid']}
        if temporary is not None:
            state['listenerSocket']['temporary'] = temporary
        atomic(root / 'state.json', encode(state))
    finally:
        os.close(guard)


def main():
    need(len(sys.argv) == 3 and sys.argv[2] in ('host', 'scheduler', 'cli', 'key'))
    profile, role = sys.argv[1:]
    raw = private_bytes(profile)
    config = json.loads(raw, object_pairs_hook=unique)
    required = {'schema', 'root', 'releaseRoot', 'node', 'python', 'keyConfig', 'sourcePolicy', 'brokerProfile', 'backupRoot'}
    need(isinstance(config, dict) and required <= set(config) <= required | {'operator'} and config['schema'] == 1)
    for key in required - {'schema'}:
        canonical(config[key])
    root = private_directory(config['root'])
    release = canonical(config['releaseRoot'])
    node, python = executable(config['node']), executable(config['python'])
    listener = release_file(release, 'host/backup-unix-peer.py')
    settings = read_json(config['keyConfig'])
    need(settings.get('schema') == 1 and settings.get('trustModel') == 'host-root' and all(settings.get(k) == os.getuid() for k in ('serviceUid', 'sourceUid', 'hostUid')))
    need(settings.get('node') == node and settings.get('handler') == release_file(release, 'backup-key-worker.js'))
    need(isinstance(settings.get('socket'), str) and len(os.fsencode(settings['socket'])) <= 100)
    client = read_json(config['brokerProfile'])
    need(client.get('schema') == 1 and client.get('socket') == settings.get('socket') and client.get('serviceUid') == os.getuid())
    command = arguments(config, role, release)
    environment = dict(os.environ)
    if role == 'host':
        for key, value in {'PI_COFFEE_BACKUP_ROOT': config['backupRoot'], 'PI_COFFEE_BACKUP_BROKER_CLIENT': config['brokerProfile']}.items():
            need(environment.get(key, value) == value, 'startup_environment_mismatch')
            environment[key] = value
    if role == 'key':
        environment = {key: value for key, value in environment.items() if key in ('PATH', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS')}
        environment['PYTHONNOUSERSITE'] = '1'
        environment['PI_COFFEE_ORDINARY_STARTUP_PROFILE'] = str(canonical(profile))
    role_lock = lock(root / (role + '.lock'), inherited=True)
    global_lock = lock(root / 'policy.lock')
    state_path = root / 'state.json'
    if not state_path.exists():
        atomic(state_path, encode({'schema': 1, 'roles': {}, 'listener': None}))
    policy_paths = [settings['authorityFile'], config['sourcePolicy'], str(state_path)]
    need(len(set(policy_paths)) == 3)
    digest = hashlib.sha256(raw).hexdigest()
    apply_journal(root, digest, set(policy_paths))
    originals = {path: private_bytes(path) for path in policy_paths}
    policy, source, state = [json.loads(originals[path], object_pairs_hook=unique) for path in policy_paths]
    application(policy, client)
    # Source application revocation remains enforced by the exporter and capture
    # authority. It must not prevent existing repository access after restart.
    need(source.get('schema') == 1 and type(source.get('revision')) is int and source['revision'] >= 1 and isinstance(source.get('actors'), dict), 'startup_source_policy_invalid')
    need(state.get('schema') == 1 and isinstance(state.get('roles'), dict) and isinstance(policy.get('hostClients'), list) and isinstance(source.get('sourceProducers'), list), 'startup_slot_changed')
    previous = state['roles'].get(role)
    if previous is not None:
        assert_dead(previous)
        if role != 'key':
            need(previous in policy['hostClients'], 'startup_enrollment_changed')
            policy['hostClients'].remove(previous)
    current = process_identity(os.getpid())
    if role != 'key':
        policy['hostClients'].append(current)
        try:
            grant, socket_record = observed_listener(config, settings, python, listener)
        except (FileNotFoundError, ConnectionRefusedError, TimeoutError):
            if role not in ('host', 'scheduler'):
                raise
            grant, socket_record = None, state.get('listenerSocket')
            print(json.dumps({'warning': 'backup_listener_unavailable'}), file=sys.stderr)
    else:
        grant = {'listener': current, 'workerCommand': [node, settings['handler'], config['keyConfig']]}
        socket_record = state.get('listenerSocket')
    previous_listener = state.get('listener')
    if grant is not None and previous_listener != grant:
        if previous_listener is not None:
            assert_dead(previous_listener['listener'])
            need(previous_listener in source['sourceProducers'], 'startup_enrollment_changed')
            source['sourceProducers'].remove(previous_listener)
        if grant not in source['sourceProducers']:
            source['sourceProducers'].append(grant)
    need(len(policy['hostClients']) <= 32 and len(source['sourceProducers']) <= 32, 'startup_enrollment_limit')
    if role == 'key':
        target = canonical(settings['socket'])
        if target.exists():
            info = target.lstat()
            expected = {'path': str(target), 'dev': info.st_dev, 'ino': info.st_ino, 'ctimeNs': info.st_ctime_ns, 'pid': previous['pid']} if previous else None
            staged = socket_record and socket_record.get('temporary')
            if staged:
                need(Path(staged).parent == target.parent and re.fullmatch(r'\.k[a-f0-9]{6}', Path(staged).name), 'startup_socket_unowned')
                # Linking/unlinking changes ctime, so a durable pre-link receipt
                # binds the inode and private stage name instead of final ctime.
                expected['ctimeNs'], expected['temporary'] = socket_record['ctimeNs'], staged
            need(previous is not None and socket_record is not None and socket_record == expected and stat.S_ISSOCK(info.st_mode) and info.st_uid == os.getuid(), 'startup_socket_unowned')
            # The inherited role lease excludes another managed key listener.
            # Only this exact inode from the proven-dead instance is removable.
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                probe.settimeout(3)
                try:
                    probe.connect(str(target))
                except ConnectionRefusedError:
                    pass
                else:
                    raise Refused('startup_socket_active')
            again = target.lstat()
            need((again.st_dev, again.st_ino, again.st_ctime_ns) == (info.st_dev, info.st_ino, info.st_ctime_ns), 'startup_socket_unowned')
            target.unlink()
        if socket_record and socket_record.get('temporary'):
            stage = canonical(socket_record['temporary'])
            need(stage.parent == target.parent and re.fullmatch(r'\.k[a-f0-9]{6}', stage.name), 'startup_socket_unowned')
            if stage.exists():
                staged_info = stage.lstat()
                need(previous is not None and socket_record['pid'] == previous['pid'] and stat.S_ISSOCK(staged_info.st_mode) and staged_info.st_uid == os.getuid() and (staged_info.st_dev, staged_info.st_ino) == (socket_record['dev'], socket_record['ino']), 'startup_socket_unowned')
                stage.unlink()
        socket_record = None
    state['roles'][role] = current
    if grant is not None:
        state['listener'], state['listenerSocket'] = grant, socket_record
    need(private_bytes(profile) == raw and all(private_bytes(path) == original for path, original in originals.items()), 'startup_policy_changed')
    entries = [{'path': path, 'before': originals[path].decode(), 'after': encode(value).decode()} for path, value in zip(policy_paths, [policy, source, state])]
    transaction(root, entries, digest)
    if grant is not None:
        need(process_identity(grant['listener']['pid']) == grant['listener'], 'startup_listener_changed')
    os.close(global_lock)
    # The role lease survives exec; PID/birth, cwd, HOME and native privileges do too.
    program = python if role == 'key' else node
    os.execve(program, [program, *command], environment)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': str(error) if isinstance(error, Refused) else 'startup_failed'}), file=sys.stderr)
        raise SystemExit(1)
