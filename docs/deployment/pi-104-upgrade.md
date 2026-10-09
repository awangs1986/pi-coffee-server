# Pi 1.0.4 consumer upgrade candidate

Tracking: [Server #67](https://github.com/awangs1986/pi-coffee-server/issues/67),
[Pi #11](https://github.com/awangs1986/pi-coffee/issues/11),
[MISHU #2](http://gitea:3000/awangs/pi-coffee-mishu/issues/2).
Source policy: [Pi 1.0.4 contract](https://github.com/awangs1986/pi-coffee/blob/main/docs/spec/pi-104-native-integration.md).

Use official Pi coding-agent/agent-core/ai/tui 1.0.4, upstream pi-subagents 0.76.1,
pi-web-access 0.37.0, typebox 1.3.36 and current optional pi-antigravity 0.9.0.
Pin independent immutable artifacts: Harness 0.3.3, Coffee LSP 0.4.7, experimental
Handoff 0.2.0-experimental.6 and the owner's independent MISHU 0.1.7. The existing
MISHU authorization/personality, current-request coordination and Host/Web/native
adapters are retained. Its planned persistent-tracking work remains outside this upgrade.

## Native compatibility

Pi 1.0.4 changes wildcard/hidden-tool prompt handling and fixes native MCP shutdown
and codemode image handling. Keep native root discovery and current active-tool
boundaries; the release does not enable MCP, codemode or additional tools. Verify
the upstream child executes Pi 1.0.4, reports active work, cancels and settles.
Verify official synchronous Serper retrieval remains bounded and recoverable;
Chat stays zero-system and MISHU tools stay inactive until their own explicit setup.
Validate LSP queries/automatic diagnostics, Handoff success/failure and reconnect.

## Azure configuration migration

Pi 1.0.3 renamed provider `azure-openai-responses` to `azure`. Run the reviewed
native registration script only as part of a later authorized configuration switch:

```sh
node scripts/configure-native-pi.mjs /absolute/agent-directory
```

The script preflights all renames, creates private, non-overwritten
`.before-pi104` backups of existing auth/models/settings/search files, and migrates
provider keys in auth/models plus defaultProvider, enabledModels and
modelThinkingLevels references. Preserve credential values, custom endpoints,
model/thinking choices, independent extensions and package resource filters.
Conflicting old/new entries stop before changing any native configuration; resolve
them explicitly rather than silently choosing credentials. Equivalent entries
can be deduplicated. Repeat execution retains the first backups.

The `azure-openai-responses` **API** identifier and `AZURE_OPENAI_*` environment
variables are unchanged. Deployment configurations using the old provider must
also rename `PI_COFFEE_PROVIDER` and Azure entries in `PI_COFFEE_PI_ALLOWED_MODELS`.
Existing native sessions retain their historical provider; upstream documents
model fallback and lost prompt cache on resume. Do not rewrite original sessions
or imply a seamless historical provider/cache migration. Non-Azure defaults remain unchanged.

## Checks and release order

Run `npm ci && npm run check` in an independent clone. The source-map-js lock entry
must resolve to official patched 1.2.2; inspect the complete npm audit. The native
HTTP/RPC tests use synthetic local providers and exercise actual plugin loading,
child processes, LSP, Handoff and MISHU authorization. They do not establish model
autonomy, production browser acceptance or Handoff semantic fidelity.

The new Coffee/MISHU release URLs are not published by this PR. Candidate
verification seeds native npm's cache with locally packed artifacts and exact
lock integrity. This establishes package installability, not release availability.

1. Merge the Pi plugin PR and MISHU PR; mirror the exact source ancestry.
2. Publish each namespaced/versioned immutable tarball, checksums and source
   manifest. Never overwrite tags/assets. Verify consumer lock hashes against
   downloaded artifacts; candidate tarballs must match byte for byte.
3. Merge the Server PR only after all four artifact URLs are available. Merge
   GitHub first and fast-forward Gitea to the identical main SHA.
4. Separately stage a release and terminal runtime using their native preparation
   scripts. MISHU remains Host-managed per selected Chat rather than globally
   activated in terminal registration.
5. Deploy only after active turns/queues/work settle and the planned service
   impact has been authorized. Preserve private configs, original sessions/task
   directories, previous artifacts and a readiness-triggered rollback. Verify
   native versions and health; Web asset/UI acceptance remains separate.

The owner requested PR delivery and will merge/deploy. This change does not update
main, publish releases, switch the terminal runtime or restart any running service.
