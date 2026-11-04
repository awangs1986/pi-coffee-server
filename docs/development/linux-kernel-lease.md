# Linux service kernel primitives

`acquireFileLease(path, 'exclusive' | 'shared')` is a synchronous, nonblocking public job seam. It returns `undefined` on contention and a lease with synchronous `assertHeld()` / idempotent `release()` otherwise. The Node process owns an actual Linux flock on a CLOEXEC file descriptor. Controller death releases it without stale PID/age heuristics. Callers must never unlink or replace the lock file to reclaim it.

The parent directory must already be private, canonical and owned by the running service identity. The file must be a private, regular, single-link no-follow file. Identity checks detect replacement; this does not make a caller-controlled directory a safe lock authority. Use a service-owned directory inaccessible to untrusted writers. A final authority assertion and atomic publication must remain in the same synchronous admission segment.

`hardenCurrentProcess()` applies process-local `PR_SET_DUMPABLE=0` and `PR_SET_NO_NEW_PRIVS=1`; `processProtection()` reports actual kernel values. Invoke hardening only for opted-in managed processes. A subsequent exec can reset dumpability, so the process that holds secrets must harden itself after exec. `kernelPeerCredentials(fd)` reads Linux `SO_PEERCRED` from a connected Unix socket; it does not accept an asserted peer identity.

The small N-API C implementation is built by `scripts/build-linux-kernel.mjs` during `npm run build`, using the compiler and headers from the selected Node installation. Linux is required for these primitives. Unsupported platforms or missing kernel/build support fail explicitly; there is no file-directory-lock fallback or supported-flag bypass. The binary is a build artifact, not checked into source.

`test/linux-file-lease.test.ts` exercises independent jobs, competing shared/exclusive lifetimes, abrupt controller death, descriptor CLOEXEC, symlink/replacement rejection and actual same-UID procfs denial against a separately hardened synthetic secret-holder process. These tests do not install service UIDs or claim host-root isolation.
