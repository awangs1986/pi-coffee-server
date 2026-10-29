"""Fixed local transport. Kernel peer identity is authority; bodies are never logged."""
import json
import ctypes
import os
from pathlib import Path
import signal
import socket
import stat
import struct
import subprocess
import sys
import threading
import uuid

LIMIT = 1024 * 1024


def fail(code):
    return json.dumps({'schema': 1, 'ok': False, 'error': {'code': code}}, separators=(',', ':')).encode() + b'\n'


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate field')
        value[key] = item
    return value


def peer(connection):
    pid, uid, gid = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    if pid <= 0 or uid < 0 or gid < 0:
        raise ValueError('invalid peer')
    return {'pid': pid, 'uid': uid, 'gid': gid}


def read_line(stream):
    data = stream.readline(LIMIT + 1)
    if not data.endswith(b'\n') or len(data) > LIMIT:
        raise ValueError('frame limit')
    return data


def private_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1 or info.st_size > 65536:
            raise ValueError('unsafe config')
        with os.fdopen(fd, 'rb', closefd=False) as source:
            raw = source.read(65537)
        if len(raw) > 65536:
            raise ValueError('config limit')
        return json.loads(raw, object_pairs_hook=unique)
    finally:
        os.close(fd)


def serve(config_path):
    config = private_json(config_path)
    if config['schema'] != 1 or config['serviceUid'] != os.getuid() or not isinstance(config['hostUid'], int):
        raise ValueError('wrong service identity')
    target = Path(config['socket'])
    parent = target.parent.lstat()
    if not target.is_absolute() or target.parent.resolve() != target.parent or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o007:
        raise ValueError('unsafe socket directory')
    if not all(isinstance(config[name], str) and Path(config[name]).is_absolute() for name in ('node', 'handler')):
        raise ValueError('fixed handler required')
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    startup_profile = os.environ.get('PI_COFFEE_ORDINARY_STARTUP_PROFILE')
    if startup_profile:
        import importlib.util
        spec = importlib.util.spec_from_file_location('coffee_ordinary_startup', Path(__file__).with_name('ordinary-backup-start.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # Publish the public name only after the actual bound inode has a
        # durable owner receipt. link(2) refuses an existing unknown endpoint.
        temporary = target.parent / ('.k' + uuid.uuid4().hex[:6])
        if temporary == target:
            # Keep the staged bind private even when randomness matches the
            # configured public basename; do not rely on another random draw.
            temporary = temporary.with_name('.k' + ('1' if temporary.name[2] == '0' else '0') + temporary.name[3:])
        listener.bind(str(temporary))
        os.chmod(temporary, 0o660)
        module.record_listener_socket(startup_profile, config_path, str(target), str(temporary))
        os.link(temporary, target)
        temporary.unlink()
        descriptor = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        module.record_listener_socket(startup_profile, config_path, str(target))
    else:
        listener.bind(str(target))  # Historical operator mode never replaces an endpoint.
        os.chmod(target, 0o660)
    identity = target.lstat()
    listener.listen(8)
    listener.settimeout(0.5)
    stopping = threading.Event()
    slots = threading.BoundedSemaphore(4)

    def stop(_signal, _frame):
        stopping.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def handle(connection):
        try:
            credentials = peer(connection)
            if credentials['uid'] not in config.get('allowedUids', [config['hostUid']]):
                connection.sendall(fail('peer_identity_mismatch'))
                return
            if config.get('trustModel') == 'host-root':
                # The worker reads the actual accepted socket. No caller or
                # stdin envelope can manufacture kernel peer identity.
                environment = {key: value for key, value in os.environ.items() if key in ('PATH', 'LANG', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS')}
                environment['HOME'] = config['privateRoot']
                environment['PI_COFFEE_BACKUP_PEER_FD'] = str(connection.fileno())
                child = subprocess.Popen([config['node'], config['handler'], config_path], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=environment, pass_fds=(connection.fileno(),), start_new_session=True)
                child.wait()
                return
            connection.settimeout(5)
            source = connection.makefile('rb')
            request = json.loads(read_line(source), object_pairs_hook=unique)
            if not isinstance(request, dict) or '_peer' in request:
                connection.sendall(fail('invalid_request'))
                return
            request['_peer'] = credentials
            environment = {key: value for key, value in os.environ.items() if key in ('PATH', 'LANG', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS')}
            environment['HOME'] = config['privateRoot']
            child = subprocess.Popen([config['node'], config['handler'], config_path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=environment, start_new_session=True)
            child.stdin.write(json.dumps(request, separators=(',', ':')).encode() + b'\n')
            child.stdin.close()
            sent = 0
            connected = True
            while True:
                line = child.stdout.readline(LIMIT + 1)
                if not line:
                    break
                sent += len(line)
                if len(line) > LIMIT or not line.endswith(b'\n') or sent > config.get('responseLimit', LIMIT):
                    child.kill()
                    if connected:
                        connection.sendall(fail('response_limit'))
                    break
                if connected:
                    try:
                        connection.sendall(line)
                    except (OSError, TimeoutError):
                        # Control disconnect is not cancellation of a durable job.
                        connected = False
                        if request.get('operation') == 'hold-recovery-pins':
                            child.terminate()
                            break
            child.wait()
        except Exception:
            try:
                connection.sendall(fail('invalid_request'))
            except OSError:
                pass
        finally:
            connection.close()
            slots.release()

    try:
        while not stopping.is_set():
            try:
                connection, _ = listener.accept()
            except socket.timeout:
                continue
            if not slots.acquire(blocking=False):
                connection.sendall(fail('broker_busy'))
                connection.close()
                continue
            threading.Thread(target=handle, args=(connection,), daemon=True).start()
    finally:
        listener.close()
        try:
            current = target.lstat()
            if (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                target.unlink()
        except FileNotFoundError:
            pass


def client(path, expected_uid, maximum=LIMIT, streaming=False):
    target = Path(path)
    info = target.lstat()
    if not target.is_absolute() or not stat.S_ISSOCK(info.st_mode) or info.st_uid != expected_uid or info.st_mode & 0o007 or target.parent.resolve() != target.parent:
        sys.stdout.buffer.write(fail('peer_identity_mismatch'))
        return 1
    request = read_line(sys.stdin.buffer)
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(1800)
    try:
        connection.connect(path)
        if peer(connection)['uid'] != expected_uid:
            sys.stdout.buffer.write(fail('peer_identity_mismatch'))
            return 1
        current = target.lstat()
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            sys.stdout.buffer.write(fail('peer_identity_mismatch'))
            return 1
        connection.sendall(request)
        source = connection.makefile('rb')
        total = 0
        while True:
            line = source.readline(LIMIT + 1)
            if not line:
                break
            total += len(line)
            if len(line) > LIMIT or not line.endswith(b'\n') or total > maximum:
                sys.stdout.buffer.write(fail('response_limit'))
                return 1
            sys.stdout.buffer.write(line)
            if streaming:
                sys.stdout.buffer.flush()
            if not streaming:
                break
        return 0
    finally:
        connection.close()


try:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(4, 0, 0, 0, 0) != 0 or libc.prctl(38, 1, 0, 0, 0) != 0:
        raise ValueError('process protection unavailable')
    if sys.argv[1] == 'serve' and len(sys.argv) == 3:
        serve(sys.argv[2])
    elif sys.argv[1] == 'client' and len(sys.argv) == 4:
        raise SystemExit(client(sys.argv[2], int(sys.argv[3])))
    elif sys.argv[1] == 'client-stream' and len(sys.argv) == 5 and 0 < int(sys.argv[4]) <= 2 * 1024 * 1024 * 1024:
        raise SystemExit(client(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), True))
    else:
        raise ValueError('invalid operation')
except Exception:
    sys.stdout.buffer.write(fail('transport_unavailable'))
    raise SystemExit(1)
