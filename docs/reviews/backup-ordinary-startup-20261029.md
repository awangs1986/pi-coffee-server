# Ordinary backup startup candidate — 2026-10-29

Server #130 / #131 / #132 / #138 / #141; source candidate, not installation.
The [startup contract](../deployment/ordinary-backup-startup.md) describes fixed
key/Host/scheduler/CLI roles, exact process enrollment, application authorization,
private policy transactions and staged socket publication.

The initial fourteen focused tests passed with synthetic private data and actual fixed
listener/worker, Node CLI, Host HTTP and independent scheduler processes.
They include real SIGKILL during policy publication and socket publication,
role/revision/private-file/command refusal, same-UID impostor refusal, preservation
of an unknown live socket, and ordinary task creation during a key-service outage.
Host HOME/environment and its inherited no-new-privileges state are preserved.
Source actor revocation remains intact while existing-repository access continues.
Three targeted mutation probes were detected and restored: administrator role,
actual listener command identity and transaction preimage/revocation checks.

The socket is bound at a private random staging name. Its exact inode and owner
receipt is durable before link(2) exposes the public name without replacement.
Recovery proves old process death and refuses unknown or live endpoints. A source
or repository consistency claim is never derived from socket ownership.

Operator edits must coordinate through policy.lock; private before/after journal
comparison is not a CAS against arbitrary editors ignoring that lock. The key
service uses a minimal process environment, while ordinary Host/native execution
keeps its existing environment and privileges. Actual source authorization and
all repository operations still check current policy independently.

Private evidence uses the `ordinary-startup-` log prefix. The initial missing API,
source-policy coupling and key-outage startup REDs are retained. An impostor
fixture EPIPE and an incomplete copied fault release were test setup failures,
not product RED evidence. No provider call, production restart, backup, restore,
service installation or physical disk operation occurred. Final integration,
canonical checks, Browser acceptance and fresh checkout remain separate gates.


Earlier slice checks: `npm run build` passed. The actual Restic-enabled run of
`ordinary-backup-startup`, `trusted-root-key-service` and `backup-key-broker`
passed 25 tests in 3 files, no skips, in 59.96 seconds. The startup file contains
14 cases; the other 11 retain trusted-root and historical managed broker behavior.
These checks precede the final integration merge and do not replace its gates.


## Distinct staging-name follow-up

The key listener now guarantees that its `.k` plus six-hex staging basename differs
from the configured public basename. If the random name matches, it changes the
first hex digit deterministically before `bind`; it does not depend on another
random draw. The existing staging-name grammar and publication sequence remain
unchanged.

An actual fixed-listener fault case uses a synthetic `.k000000` public endpoint,
forces randomness to that same name only in the isolated copied release, and
SIGKILLs that process immediately before `link(2)`. Against the prior code the
public socket already existed (expected false, observed true). With the guard,
the public socket remains absent, the durable temporary name is different, and a
normal fixed-key restart reclaims the owned stage and serves the real CLI again.
This is a runtime boundary test, not a mocked successful publication result.

`npm run build` passed. The Restic/Codex-enabled run of
`ordinary-backup-startup`, `native-owned-audit`, `trusted-root-key-service` and
`backup-key-broker` passed **37 tests in 4 files, zero skips**, in 71.47 seconds.
The startup file now contains 15 cases; the other files contain 11, 4 and 7 cases
respectively. The prior 25-test record above remains historical evidence.

Private evidence in `/home/awang/tmp/backup-implementation-130/`:
`ordinary-startup-stage-collision-red.log`,
`ordinary-startup-stage-collision-build.log`, and
`ordinary-startup-stage-collision-green.log`.
The isolated unit used one test worker, CPUQuota=200%, MemoryMax=4G,
IOWeight=10 and TasksMax=256. No production service, data or hardware was changed.
