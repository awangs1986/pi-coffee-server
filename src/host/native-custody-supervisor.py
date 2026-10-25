"""Own a native process tree until every adopted descendant exits naturally.

The record is custody evidence, not proof that unrelated clients cannot write a
store. Never signals descendants for backup. Missing/partial records fail closed.
"""
import ctypes
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import uuid


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
        value = {'schema': 1, 'id': identity, 'state': state, 'boot': boot, 'pid': os.getpid(), 'birth': birth}
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
    native = subprocess.Popen([command['executable'], *command['args'], *sys.argv[1:]], env=environment)
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
    publish('quiescent')
    return native_status if native_status >= 0 else 128 - native_status


try:
    sys.exit(main())
except Exception:
    # No native paths, command arguments or credentials in Host diagnostics.
    sys.stderr.write('Native writer custody unavailable\n')
    sys.exit(78)
