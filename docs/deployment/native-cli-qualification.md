# Native CLI qualification and rollback

A global CLI install does not update Host's pinned command. Stage a new immutable
version directory, retain the previous binary and wrapper, and record both before
activation. Preserve unrestricted Codex permissions, task-local models and native
login paths. Do not substitute a model or enlarge context limits to make a test pass.

For Codex, run the built adapter and metadata/schema probe:

```
npm run build
node scripts/probe-codex-compatibility.mjs /absolute/path/to/candidate/coffee-codex
npx vitest run test/codex-adapter.test.ts test/codex-chat-http.test.ts
```

The probe uses an isolated native home and does not create threads, execute model
turns or alter the production login. It checks initialization, model/Skill catalogs
and compact/resume/steer/token-usage protocol names. A successful probe does not
prove provider access, actual compaction or every optional API.
Use an explicitly scoped single existing-task check for provider-specific failures;
never create a concurrent batch to investigate capacity or authorization errors.

On 2026-10-17 npm latest was 0.163.0. It was installed separately and passed the
isolated probe. The previous live pin was 0.159.1. Actual activation must record
Host's effective command and new child version separately from installation.
Before activation take a consistent backup of task registries and native stores;
a binary rollback alone is not a native data-format rollback. Retain compatible
binaries and prefer forward repair over replacing newer user data with a backup.

For a compaction failure, collect only bounded metadata: task ID, CLI version,
model ID, nominal preset/effective window, native error code and time, plus whether
compaction completed. Preserve native records privately. 500K remains nominal and
the configured auto-compaction threshold remains 475K. Version age or a 500K
selection alone does not establish the cause of the earlier reported failure.
Latest-source provenance fields are not permission to infer precise context
categories from cumulative usage or parse another user's native sessions.

The verified Codex version must also appear in NativeAgentFactory's readiness
allowlist and the HTTP engine-discovery regression matrix. An isolated App Server
probe is insufficient: after activation, query the owner's authenticated
/api/engines endpoint and require Codex available=true with the expected version.
This metadata-only probe must not create a conversation or send a model turn.
The 0.163.0 entry was missing after its initial installation; this caused the Web
readiness gate to reject a compatible executable despite successful --version.
