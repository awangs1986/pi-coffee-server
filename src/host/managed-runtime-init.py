"""PID namespace init: wait for every descendant, never just the RPC parent."""
import ctypes
import os
import signal
import subprocess
import sys

ctypes.CDLL(None, use_errno=True).prctl(4, 0, 0, 0, 0)  # PR_SET_DUMPABLE, init has no secrets
native = None
pending = []
def forward(signum, _frame):
    if native is None:
        pending.append(signum)
    elif native.poll() is None:
        native.send_signal(signum)
for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(signum, forward)
native = subprocess.Popen(sys.argv[1:])
for signum in pending:
    forward(signum, None)
status = None
while True:
    try:
        pid, value = os.waitpid(-1, 0)
        if pid == native.pid:
            status = os.waitstatus_to_exitcode(value)
            native.returncode = status
    except InterruptedError:
        continue
    except ChildProcessError:
        break
sys.exit(status if status is not None and status >= 0 else 78)
