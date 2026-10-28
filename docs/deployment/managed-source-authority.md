# Managed source Host and independent model authentication

**Historical candidate architecture, not the accepted deployment direction.**
The owner chose to preserve native permissions on 2026-10-28. Mandatory
confinement and retirement of unrestricted execution conflict with that choice.
These instructions describe existing experimental code; they are not an
activation path for a completed #130 feature. See the
[permission reconciliation](../reviews/backup-native-permission-20261028.md).

This documents experimental managed-architecture software in draft #130. No service identities, permissions, credentials or production services are installed by a source checkout. The existing unprotected Host keeps its previous behavior. The protected profile trusts the kernel and human OS-root administrator; it does not claim protection from that administrator.

## Experimental principals and startup

Use a dedicated no-login/no-sudo executor UID with a canonical private 0700 source parent, a separate backup-key UID, and a separate model-auth UID. The executor has no supplementary groups. Model-auth workers may use the executor's primary group for their 0750 endpoint directories and 0660 sockets while keeping credential homes 0700. The namespace receives only the exact authenticated provider socket inode; sibling files, credentials, key sockets and Host controls are absent. Kernel SO_PEERCRED authenticates service identities before entering the user namespace. No host network, SSH, bus, sudo, CONNECT, Upgrade or generic URL proxy is exposed.

Start the standalone worker with the release's Node executable:

```
node dist/src/provider-broker-worker.js --config /absolute/private/provider.json
```

The worker hardens itself before reading configuration or credentials and refuses the executor UID, unexpected UID/groups, noncanonical files, writable configuration or unsupported grants. Example structures are in `deploy/provider-broker/`. They are examples, not installation scripts. Configure one fixed account/provider/model allowlist per endpoint. Separate account endpoints select separate private auth roots. Requests choose an allowlisted model; they cannot choose an account, provider, credential path or upstream URL.

`PI_COFFEE_MANAGED_PROFILE_FILE` enables the source Host. Its trusted JSON has `schema:1`, `executorUid`, `legacyHostUid`, `keyUid`, `sourceParent`, `sourceSocket`, `legacyAdmissionSocket`, and immutable `runtimeRoots`. The roots include the selected Node and native runtimes and reviewed Pi package dependencies. `PI_COFFEE_BACKUP_BROKER_CLIENT` is mandatory and contains IPC-only key-service client configuration. A complete structure is in `deploy/source-managed/profile.example.json`; resolve every runtime root to its canonical immutable location. Control socket directories live outside the 0700 data parent so their separately authorized service UIDs can traverse them. Peer-checked sockets use mode0660 because the fixed IPC client rejects world-accessible sockets; install their traversal/shared-primary-group permissions explicitly while keeping source and key data roots mode0700. A configured profile does not qualify itself: live identity, process protection, directory identity, retirement handshake and real namespace probes must all pass.

Use `scopeProviderTransports` keyed by canonical data scope for private account grants. Each scope maps `pi` and/or `codex` to `{provider,models,socket,serviceUid,port}`. The model list contains exact original native IDs; the port is an internal loopback port between 1024 and 65535. An explicitly configured `providerTransports` map is a fallback only for an operator's intentionally shared model account. Unmapped engines cannot launch. A grant's service UID must differ from executor and backup-key UIDs. The source Host projects its provider/model allowlist into both adapters and checks native state before dispatch. Ordinary mode retains existing defaults.

All writable managed source paths live under `sourceParent/scopes/<scope>/`. Each account has its own public Pi configuration directory. Host runner credentials, GitHub account storage and Codex mapping bookkeeping stay under unmounted `sourceParent/authority/scopes/<scope>/`, outside native source grants. Legacy work/project/chat overrides cannot escape this layout. HOME, PI_CODING_AGENT_DIR, CODEX_HOME and CODEX_SQLITE_HOME must resolve within granted namespace destinations. Runtime mounts are read-only. The separate unfenced transfer listener is disabled in protected mode; authenticated Host task uploads retain the Host writer fence. SQL paths supplied by native configuration still require the native recovery adapter's explicit closure validation.

## Experimental authentication

Pi1.1.0 uses its actual `ModelRuntime.create` and `getAuth` implementation with explicit private auth/models paths, network catalog refresh disabled, and a minimum OAuth validity deadline. Each request reloads current configuration and credentials; native credential storage serializes refresh and persists rotated refresh tokens. The supported transport APIs are `openai-completions`, `openai-responses`, and `openai-codex-responses`. A model or auth-derived base URL that differs from the fixed grant is refused. Other API families require an additional reviewed mapping.

The provider endpoint exposes a fixed authenticated `/_coffee/models` projection containing only approved model IDs, names, costs, input/reasoning limits and safe compatibility booleans. API keys, arbitrary headers, URLs and paths are excluded. The Pi extension loads this projection and registers the same original provider/model IDs with a namespace loopback base URL and a nonsecret placeholder JWT. No private `models.json` or auth file is copied into native execution. Pi extension hook exceptions are swallowed by the pinned runtime, so Host admission and the broker's model allowlist are the authorization gates.

Codex support is pinned to 0.159.1. The credential worker uses that exact CLI's `config/read` and `getAuthStatus` public RPC, allowing native code to own OAuth refresh and token rotation. It does not reimplement OAuth from a newer source checkout. Supported file-backed auth is API key or ChatGPT OAuth; a custom Responses provider may use its exact configured `env_key` and `requires_openai_auth=false`. Private static provider headers are respected. `env_http_headers`, keyring-only credentials, additional auth modes, provider/schema changes and other native versions require explicit support and are refused. Failed refresh or an expired returned token is never sent upstream. A trusted optional `refreshUrl` uses the native override; tests point it only to an isolated synthetic HTTP server. No caller supplies it.

The native Codex overlay preserves the configured provider ID and all model/tier/context selections while replacing transport/base URL and authentication with placeholders. The independent worker supplies current real authorization and account headers outside the namespace. WebSocket provider transport is disabled; HTTP event streams remain streamed with bounded resources and backpressure. These are transport/auth tests, not a claim that any production provider accepted a model message.

## Natural source windows and retirement

The old Host can expose `PI_COFFEE_NATIVE_ADMISSION_SOCKET` with `PI_COFFEE_NATIVE_ADMISSION_UID` set to the new executor UID. A fresh challenge causes the exact live admission policy used by native factories and platform writer fences to retire future unrestricted admission. Already admitted work finishes naturally. The response requires a drained policy plus real quiescent descendant custody; idle RPC state, a marker, restart, unchanged hashes or a caller receipt cannot substitute. Unknown custody stays unknown.

The managed authority checks that old process's PID, UID quartet, boot and birth identity on every qualification. Losing that owner invalidates qualification. Control socket parents are canonical and not writable by another UID; controls use kernel peer authentication. The source export endpoint accepts named scope/task/checkpoint identities and streams verified sealed material, never a caller-selected source path.

After qualified startup, source-owned maintenance automatically attempts one bounded checkpoint per pass (default 60 seconds). A source admission revision makes a prior cut eligible for refresh; unchanged cuts avoid repeated copying, with a six-hour freshness refresh. Active native descendants keep the source waiting. Natural exit allows sealing. New source work revokes a capture and wins immediately. No model request, idle-forcing signal or task restart is used. Daily repository scheduling consumes these sealed points; it does not copy live files.

Publication uses a distinct group lease. Once irreversible recovery publication begins, new group writers are refused until the trusted physical work settles. Direct logical invalidation retains the physical exclusive lock. `publicationFd` may be inherited only by a trusted importer helper through an explicit stdio slot, so Host death cannot release a lock still protecting a running importer. Capture leases never expose that descriptor to native/model children. Durable restart reconciliation remains required before adopting affected tasks.

## Evidence and installation limits

Synthetic tests cover actual socket pinning, namespace stream transport, secret/proc/bus denial, detached writers, source retirement, automatic busy-to-cold sealing, model allowlists, API-key rotation and native OAuth rotation/failed-refresh refusal. Actual Pi SDK traffic reaches only a local synthetic error fixture. Actual Codex0.159.1 read/resume and credential RPC are exercised without a production provider request. Dedicated service-UID installation and existing production source enrollment have not been performed.

Existing unrestricted roots cannot be adopted using provenance markers or matching hashes. A supported cold enrollment must establish an actual OS-enforced read-only/exclusive old export after natural drain or a separately approved maintenance window, validate the Pi/Codex graph, and publish a reviewed import into the new private backing roots. The trusted maintenance implementation and its remaining installation/acceptance gates are described in [cold legacy enrollment](cold-legacy-enrollment.md). Its typed Pi/Codex relocation, concrete source/key IPC archive composition and durable account recovery do not by themselves prove that a production cold snapshot or service-principal installation has passed acceptance. Never restart, kill or migrate existing tasks merely to satisfy qualification.

## Host Git operations in protected mode

Workspace diff reads, snapshot/index writes, clone, fetch and checkpoint push use
mandatory native custody too. Repository configuration cannot execute a helper as
the source Host. The managed executor refuses executable config, external Git
metadata, shared Git directories and alternate object stores; source-grant and
namespace enforcement also applies if a repository changes during validation.
Configuration input and parsed output are bounded at 1 MiB. Missing custody fails
closed instead of invoking privileged Git.

GitHub HTTPS and the account's configured Gitea HTTP(S) remote use a temporary
Host-owned smart-HTTP endpoint for that command and exact repository. Read commands
can use upload-pack; push alone can use receive-pack. The socket is mounted only
into that command's namespace, never the account source grant. Selected GitHub
authorization is rechecked for every upstream request; Gitea verifies the configured
account identity. Credentials remain outside the workspace and native namespace.
Caller authorization headers, arbitrary paths, other services and redirects are
refused. The endpoint closes when the command finishes or fails. Local repositories
inside source grants remain supported. SSH, external Git transports and executable
repository helpers are outside this managed Host Git path. Native Pi/Codex direct
Git and gh do not inherit this command endpoint or the Host's private wrappers.
Native local Git still runs with ordinary user configuration under its mandatory
namespace; direct native Git/gh forge network operations remain unavailable under
the existing provider-only network policy. This change restores Host Workspaces
actions and does not claim native terminal forge access. That remaining restriction
is an unresolved acceptance gap against Server #130 decision 38 (native features
must not be disabled to establish a guarantee), not an approved scope exemption.

Tests exercise genuine Git smart-HTTP clone and checkpoint push against synthetic
local infrastructure, authenticated Host diffs/checkpoint, concurrent scoped
endpoints, live authorization removal, redirect refusal and absence of the endpoint
in an ordinary concurrent native namespace. They do not contact GitHub/Gitea with
production credentials or establish production network acceptance.
