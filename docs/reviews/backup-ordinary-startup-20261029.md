# Ordinary backup startup candidate — 2026-10-29

Server #130 / #131 / #132 / #138 / #141; source candidate, not installation.
The [startup contract](../deployment/ordinary-backup-startup.md) describes fixed
key/Host/scheduler/CLI roles, exact process enrollment, application authorization,
private policy transactions and staged socket publication.

Fourteen focused tests pass with synthetic private data and actual fixed
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


Final slice checks: `npm run build` passed. The actual Restic-enabled run of
`ordinary-backup-startup`, `trusted-root-key-service` and `backup-key-broker`
passed 25 tests in 3 files, no skips, in 59.96 seconds. The startup file contains
14 cases; the other 11 retain trusted-root and historical managed broker behavior.
These checks precede the final integration merge and do not replace its gates.
