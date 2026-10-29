# Completed native lifecycle witness

Source candidate for Server #130/#131, under the accepted trusted Host root boundary.
This witness is one input to source enrollment; it does not enroll a source by
itself, attest unrelated producers, or replace recovery graph materialization.

`readNativeSourceHandoff({custody, fence})` is passive. It rebuilds an opaque
module-owned capability from durable current-boot native history observations and
completed custody receipts. `verifyNativeSourceHandoff(token, {fence, lease,
stores})` requires the actual exclusive capture lease issued by that exact
physical fence, rechecks all evidence, and matches the enrolled native stores.
A copied lease, caller-created token, constructor, engine name, or completed
no-op launch is insufficient.

The ordinary Pi adapter observes actual RPC entries and session identity and
checks the native session header. The ordinary Codex adapter observes actual
paginated history and `thread/read` identity and checks the rollout header;
store roots come from Codex's configured native/sqlite root resolver. Both
persist only identity and filesystem metadata, never transcript contents. The
observer uses private adapter maps, so calling the persistence helper with an
arbitrary object does not create an observation or a close request.

The existing normal adapter stop path records close intent before stopping the
native runtime. The supervisor seals the exact launch command, observation and
close-intent digests into its terminal receipt after every descendant exits and
before releasing SH. Natural exit 0 is accepted. SIGTERM termination (-15) and
the pinned Pi RPC's explicit SIGTERM shutdown exit 143 require the sealed normal
close intent. Current-boot SIGKILL, unrequested SIGTERM, a missing custodian, a mismatched boot field,
changed root identity and changed receipts cannot establish a witness. Backup
never starts or stops a session to obtain evidence. Native credentials, HOME,
permissions, namespace and network policy remain unchanged.

Each nonempty `engine + roots set` group needs an observed binding in its merged
inventory. Multiple scopes sharing that store do not require reopening every
archived task. Pi roots are sessionDir and the effective agentDir; Codex roots
are resolved nativeHome and sqliteHome. Empty groups need no observed binding.
The authority must independently census producers and materialize the entire
recovery graph while retaining the same exclusive lease. A same-boot Host
restart may recover completed evidence. The boot-epoch extension below permits
prior local custody to end across an actual kernel boot change, while requiring
a new current-boot native lifecycle; it never inherits an old witness.

Validation uses synthetic data with real pinned Pi/Codex read/resume, no provider
request or model turn, and isolated systemd units. The targeted seam tests cover
successful passive reopen, active/no-history/no-op refusal, fake capabilities,
wrong binding/root groups, receipt/observation/command/boot/root changes, abnormal
termination, and merged store inventories. Custody/factory/physical-fence/source-
authority regressions also run. Mutation probes removing the exact lease check
and the observation digest check each fail the corresponding seam test. This
component evidence is not production enrollment, deployment or end-to-end backup
acceptance.

## Boot epoch and deleted historical bindings

New custody launches use command/receipt schema2. The Host reads the actual
kernel boot ID into the durable command and prepared receipt; prepared, active
and terminal receipts bind the exact command digest, boot, launch ID and source
lock identity. The supervisor refuses a prepared command from another boot.
The reader validates the binding before treating a schema2 prior-boot record as
locally ended. A changed receipt.boot alone cannot disguise a current lost
custodian or live orphan. Schema1 records with an unverifiable prior boot,
malformed records and lost current-boot custodians remain unknown. There is no
caller boot override or migration that guesses an old receipt's boot.

Local process lifetime ending does not establish source consistency. Handoff
still requires an actual current-boot ordinary native history/normal-close
lifecycle for every nonempty current store group, the exact real EX lease and
the authority's complete graph and producer checks. Prior-boot active, prepared
or abnormal records remain intact and contribute to `priorBootReceiptDigest`;
they cannot supply a current native observation. `kernelBoot` and the entire
preserved ledger are bound into `receiptDigest`. Authority pending local work,
delegations and other unresolved observations are unaffected by this change.

Every sealed historical observation and close-intent digest is still checked.
The verifier checks native header and live root identities only for selected
current-boot candidates whose binding belongs to the caller's current inventory.
A legitimately deleted old binding therefore does not poison the remaining
store. A missing source cannot itself serve as a witness, and complete recovery
graph materialization must still reject any required missing binding. This does
not authorize removal of ledger files or skipping corrupt historical evidence.

Validation explicitly labels synthetic previous-boot ledger fixtures. They
exercise command/receipt integrity, refusal to launch stale prepared commands,
old-observation refusal followed by real current Pi read/close, and preservation
of old receipts. No machine was rebooted and no production boot override exists.
The authority owner separately exercises actual task deletion and composed
remaining-task checkpoint/requalification.

## Ledger growth: known cost and proposed follow-up

The current reader scans and hashes the entire receipt ledger: O(total receipts)
per state/handoff verification. Ordinary Git adds one receipt per command. This
slice does not bound that cost, prune receipts, compact history or introduce an
index. No performance threshold failure has been measured in this slice.

A future index requires a separately reviewed, crash-tested protocol:

1. Register active launches durably before returning a launcher; absence from an
   index must never be inferred from a partial prepare. Completion is recorded
   only after terminal receipt fsync and descendant exit, before SH release.
2. Seal an immutable epoch only under the exact real EX lease after auditing all
   included records. Retain original receipt bytes, individual digests, boot
   identities, abnormal/uncertain dispositions and a digest chain to the prior
   epoch. Unresolved authority operations are never cleared by sealing.
3. Commit the archive manifest and active-index generation atomically with a
   journal and directory fsync. A crash before publication reads the old ledger;
   an inconsistent or missing index fails closed, rather than forgetting writers.
4. Migrate an existing ledger through an explicit complete audit, keeping original
   files. Define and test archive-integrity revalidation and cache invalidation
   before claiming reduced steady-state cost; startup/full-audit cost may remain
   linear. An index or checksum summary alone is not a new known-source issuer.

That protocol is a proposal, not an implemented scalability guarantee. No
historical records are silently dropped by the boot-boundary correction.
