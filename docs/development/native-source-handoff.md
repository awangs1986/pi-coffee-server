# Completed native lifecycle witness

Source candidate for Server #130/#131, under the accepted trusted Host root boundary.
This witness is one input to source enrollment; it does not enroll a source by
itself, attest unrelated producers, or replace recovery graph materialization.

`readNativeSourceHandoff({custody, fence})` is passive. It rebuilds an opaque
module-owned capability from durable same-boot native history observations and
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
close intent. SIGKILL, unrequested SIGTERM, a missing custodian, changed boot,
changed root identity and changed receipts cannot establish a witness. Backup
never starts or stops a session to obtain evidence. Native credentials, HOME,
permissions, namespace and network policy remain unchanged.

Each nonempty `engine + roots set` group needs an observed binding in its merged
inventory. Multiple scopes sharing that store do not require reopening every
archived task. Pi roots are sessionDir and the effective agentDir; Codex roots
are resolved nativeHome and sqliteHome. Empty groups need no observed binding.
The authority must independently census producers and materialize the entire
recovery graph while retaining the same exclusive lease. A same-boot Host
restart may recover completed evidence; a reboot does not inherit this witness.

Validation uses synthetic data with real pinned Pi/Codex read/resume, no provider
request or model turn, and isolated systemd units. The targeted seam tests cover
successful passive reopen, active/no-history/no-op refusal, fake capabilities,
wrong binding/root groups, receipt/observation/command/boot/root changes, abnormal
termination, and merged store inventories. Custody/factory/physical-fence/source-
authority regressions also run. Mutation probes removing the exact lease check
and the observation digest check each fail the corresponding seam test. This
component evidence is not production enrollment, deployment or end-to-end backup
acceptance.
