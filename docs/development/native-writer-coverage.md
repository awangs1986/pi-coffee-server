# Native writer launch coverage

Native launch custody is independent of a managed execution profile and of
whole-source enrollment. A concrete `PhysicalWriterFence` records its exact
`NativeWriterCustody` and lock; `TrustedSourceAuthority.writerFence()` exposes its
physical owner through module-private instance provenance. This does not turn an
unenrolled or stale source into a qualified source.

`RpcPiSessionFactory` and `CodexSessionFactory` record their actual construction
custody privately. Pi also records its actual writer fence. A similarly shaped
object, a different custody object or lock, and a caller Boolean cannot stand in
for this binding. The factories snapshot their option object so a later change
to the caller's object cannot replace the selected custody.

## Codex construction API

`NativeAgentFactory` accepts `codexSessionOptions(id, cwd, onBound, environment?,
preparation?)`. It returns `BoundCodexOptions`, preserving native CLI/home/model,
sandbox/approval options and the existing instructions, MISHU, mapping,
allow-empty-recovery and other configuration hooks.

The factory constructs the concrete `CodexSessionFactory` internally. It writes
`nativeCustody`, `cwd`, `onBound`, `envForSession` and `preparation` after the
returned options, so JavaScript callers cannot replace those bound fields. The
same builder is used by ordinary creation, reset, native fork, takeover and
handoff preparation/seed/reopen paths. CLI version/authentication probes also
admit through the actual bound custody before preparing their command.

The existing `codexSessionFactory` callback remains supported as an execution
fallback, but it has no launch coverage: arbitrary factory creation and methods
can bypass custody. Its invocation marks unknown coverage before calling it.
This remains true even when it happens to return a concrete custodied factory.
Configuration callbacks are trusted Host code, not user input. They must not
start untracked source writers; their arbitrary side effects are not made safe
or enrolled by this API. Source-authority admission/delegation still applies.

## Metadata and main migration

Pass the concrete existing `legacyCodex` factory for native catalog, listing and
bound-thread summaries. When `codexSummary` / `codexListings` callbacks are absent,
`NativeAgentFactory` uses that concrete factory's `summaryForCwd` and native
listing methods under actual writer admission. Native titles remain available.
Arbitrary metadata callbacks remain executable but mark source coverage unknown.
Known Pi and Codex history-file readers remain reads and do not revoke a cut.

For main integration, replace the constructor-returning `codexSessionFactory`
callback with `codexSessionOptions` and retain its existing configuration hooks.
Keep the concrete `legacyCodex`; remove the metadata wrapper callbacks. Supply
the exact same outer writer fence to Pi and NativeAgentFactory, and the same
actual custody to Pi, Codex and CLI command launch configuration. Apply this to
managed profiles as well when they require launch coverage: the managed fence
still rejects unknown native writers. No restriction is added to ordinary
physical-fence execution; unsupported or mismatched paths execute with unknown
capture coverage.

This slice does not edit main, enrollment, repository keys or exporter wiring.
It does not relocate native homes or change native tools/network/permissions.
Deferred engines stay executable; source-touching paths have unknown coverage.
Captured descendants do not prove the absence of external daemon, service-manager
or remote writers. Those remain the source authority's separate contract.

## Verification limit

The regression uses actual Pi and pinned Codex 0.159.1 to create/resume, reset and
fork native sessions without provider turns. Handoff/takeover tests create real
preparation runtimes then cancel before any model turn; they do not claim a
complete model-mediated handoff or takeover. Existing history/configuration and
native titles are checked through native interfaces. Source-authority provenance
is tested with an unenrolled source that correctly remains unknown after native
execution succeeds.
