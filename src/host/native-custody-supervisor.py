"""Own a native process tree until every adopted descendant exits naturally.

The record is custody evidence, not proof that unrelated clients cannot write a
store. Never signals descendants for backup. Missing/partial records fail closed.
"""
import ctypes
import fcntl
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import uuid


def assert_group_lock(identity, descriptor):
    if set(identity) != {'schema', 'path', 'dev', 'ino', 'uid', 'parentDev', 'parentIno'} or identity['schema'] != 1:
        raise ValueError('Invalid source lock identity')
    path = Path(identity['path'])
    parent = path.parent.lstat()
    named = path.lstat()
    current = os.fstat(descriptor)
    if path.resolve() != path or path.parent.resolve() != path.parent or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077 or (parent.st_dev, parent.st_ino) != (identity['parentDev'], identity['parentIno']):
        raise ValueError('Source lock parent changed')
    if not stat.S_ISREG(current.st_mode) or current.st_nlink != 1 or current.st_uid != os.getuid() or current.st_mode & 0o077 or (current.st_dev, current.st_ino, current.st_uid) != (identity['dev'], identity['ino'], identity['uid']) or stat.S_ISLNK(named.st_mode) or (named.st_dev, named.st_ino) != (current.st_dev, current.st_ino):
        raise ValueError('Source lock changed')


def assert_group_binding(root, identity):
    path = root.parent / 'group-lock.json'
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(descriptor)
        named = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 65536 or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino):
            raise ValueError('Invalid source lock binding')
        with os.fdopen(descriptor, closefd=False) as value:
            if json.load(value) != identity:
                raise ValueError('Source lock binding changed')
    finally:
        os.close(descriptor)


def acquire_group_lock(identity):
    # Nonblocking: capture must be revoked at the Host admission seam before
    # launch. This foundation never waits behind a backup or signals writers.
    descriptor = os.open(identity['path'], os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        assert_group_lock(identity, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
        assert_group_lock(identity, descriptor)
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def main():
    root = Path(os.environ['PI_COFFEE_CUSTODY_DIR'])
    identity = os.environ['PI_COFFEE_CUSTODY_ID']
    if str(uuid.UUID(identity)) != identity or root.name != identity:
        raise ValueError('Invalid custody identity')
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid() or root.resolve() != root:
        raise ValueError('Invalid custody directory')
    command_path = root / 'command.json'
    command_info = command_path.lstat()
    if not stat.S_ISREG(command_info.st_mode) or command_info.st_mode & 0o077 or command_info.st_uid != os.getuid() or command_info.st_size > 65536:
        raise ValueError('Invalid native command')
    command = json.loads(command_path.read_text())
    if command['schema'] != 1 or command['id'] != identity or not isinstance(command['executable'], str) or not isinstance(command['args'], list) or not all(isinstance(x, str) for x in command['args']):
        raise ValueError('Invalid native command')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER, before spawning
        raise OSError(ctypes.get_errno(), 'Native subreaper unavailable')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    own_stat = Path('/proc/self/stat').read_text()
    birth = own_stat[own_stat.rindex(')') + 2:].split()[19]

    def publish(state):
        value = {'schema': 1, 'id': identity, 'state': state, 'boot': boot, 'pid': os.getpid(), 'birth': birth, **({'groupLock': command['groupLock']} if 'groupLock' in command else {})}
        temp = root / (str(uuid.uuid4()) + '.tmp')
        descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, root / 'state.json')
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    group_lock = None
    group_identity = command.get('groupLock')
    if group_identity is not None:
        assert_group_binding(root, group_identity)
        group_lock = acquire_group_lock(group_identity)

    native = None
    native_signal_fd = None
    native_exited = False
    pending = []

    def forward(signum, _frame):
        if native_exited:
            return
        if native_signal_fd is None:
            pending.append(signum)
        else:
            try:
                signal.pidfd_send_signal(native_signal_fd, signum)
            except ProcessLookupError:
                pass

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, forward)
    publish('active')
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('Native process identity signalling unavailable')
    environment = {k: v for k, v in os.environ.items() if not k.startswith('PI_COFFEE_CUSTODY_')}
    arguments = [command['executable'], *command['args'], *sys.argv[1:]]
    descriptors = []
    managed_lock = None
    if os.environ.get('PI_COFFEE_MANAGED_PROFILE'):
        import importlib.util
        spec = importlib.util.spec_from_file_location('coffee_managed_profile', Path(__file__).with_name('managed-native-profile.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        arguments, descriptors, managed_lock = module.prepare(os.environ['PI_COFFEE_MANAGED_PROFILE'], root, arguments[0], arguments[1:])
        environment = {'PATH': '/usr/bin:/bin'}
    native = subprocess.Popen(arguments, env=environment, pass_fds=descriptors)
    for descriptor in descriptors:
        os.close(descriptor)
    native_signal_fd = os.pidfd_open(native.pid)
    for signum in pending:
        forward(signum, None)
    native_status = None
    while True:
        try:
            pid, status = os.waitpid(-1, 0)
            if pid == native.pid:
                native_exited = True
                native_status = os.waitstatus_to_exitcode(status)
                native.returncode = native_status
                os.close(native_signal_fd)
        except InterruptedError:
            continue
        except ChildProcessError:
            break
    if native_status is None:
        raise RuntimeError('Native exit not observed')
    # Durable completion precedes releasing either source lock. A killed
    # supervisor leaves an active/prepared receipt, never known quiescence.
    if group_identity is not None:
        assert_group_binding(root, group_identity)
        assert_group_lock(group_identity, group_lock)
    publish('quiescent')
    if group_lock is not None:
        os.close(group_lock)
    if managed_lock is not None:
        os.close(managed_lock)
    return native_status if native_status >= 0 else 128 - native_status


try:
    sys.exit(main())
except Exception:
    # No native paths, command arguments or credentials in Host diagnostics.
    sys.stderr.write('Native writer custody unavailable\n')
    sys.exit(78)
