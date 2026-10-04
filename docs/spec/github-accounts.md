# User-scoped GitHub authorizations

Accepted owner decision, 2026-10-03. [Server #36](https://github.com/awangs1986/pi-coffee-server/issues/36).
Supersedes ADR-0022's shared GitHub token and VM Git credential policy for production main.

## Identity and ownership

Gitea remains the only PI Coffee login. One authenticated Gitea user may connect
several GitHub.com accounts through GitHub OAuth. Browser/Web account APIs never
accept a caller-selected Gitea user. Web resolves the authenticated route; Host
selects its corresponding user scope. Account metadata is visible only in that
scope. Reconnecting the same numeric GitHub identity updates its credential;
disconnecting and reconnecting the same identity preserves task binding IDs.

Web owns the OAuth App client configuration and short-lived, one-use transactions.
Transactions expire after ten minutes and bind to both Gitea identity and browser
session cookie, with state and PKCE. Web exchanges the code and forwards the token
only to the authenticated Host transport. Browser responses, workspace metadata,
URLs, logs and native prompts must not contain tokens. Host stores private account
records outside task workspaces (directory 0700, files 0600, atomic replacement).

## Project and task binding

The Logo menu contains **Code hosting accounts** (Chinese UI: 代码托管账号): connect,
check, refresh and disconnect. The repository picker first requires an explicit
GitHub account, then lists that account's repositories. The same repository may be
registered through different accounts; options identify the selected account.
A GitHub Project records its account ID, copied into each new Conversation. Task
reload, native Agent changes and takeover preserve it. Other users' account IDs
cannot grant access, because resolution happens inside the current user store.

Unbound legacy GitHub projects are retained. The account menu can explicitly bind
one to an authorized account after its tasks/background work are idle. This also
binds its previously unbound tasks and reconnects idle native sessions. Existing
bound projects cannot silently switch accounts; reconnect the same GitHub identity
or add a separate project with another account. No shared token is auto-imported.

Legacy binding displays progress while its request is pending, then confirms the
project name and selected GitHub login after refreshing the project/account lists.
Removing a successfully bound project from the legacy picker is not sufficient
feedback. Failed binding remains visible and leaves the project available for retry.

## Execution

Host repository lists, repository verification and PR operations use the selected
account. Git transport and Pi/Codex/Claude runtime environments use task-scoped
Git/gh wrappers and credential helpers. GitHub SSH URL forms are normalized to
HTTPS for managed Git operations; standalone SSH assistance is a separate feature.
Git receives a private HOME and ignores system/global Git credential configuration,
including VM .netrc. Existing Git author name/email are copied without copying
credentials. Gitea transport continues using the configured Host Gitea credential;
this change does not introduce per-user Gitea transport grants.

`gh` uses an isolated config directory. A task-local `BASH_ENV` restores managed
Git settings and tool PATH after login-shell profiles; VM startup files are not modified. Native processes receive no usable global
GitHub token. The wrapper reads the current account credential on every invocation;
Git asks its helper for each operation. Missing/unbound/disconnected authorization
fails closed, without trying another account or VM login. `gh auth login`, account
switching and token printing must be managed through Web instead. In-flight requests
already authorized before disconnect cannot be recalled; future invocations fail.
Disconnect removes PI Coffee's local grant; it does not revoke grants in unrelated
applications. GitHub's own Authorized OAuth Apps settings can revoke the upstream app.

Model-provider login remains native and independent. No Pi-only plugin is required.
This prevents accidental credential crossover in the managed execution path; shared
Linux UID, unrestricted Bash and sudo remain a trusted-owner model. Absolute tool
paths, manually supplied credentials and arbitrary VM access are not a hostile-user
security boundary. Strong isolation requires separate OS execution identities/VMs.

## Activation and acceptance

Configure Web `PI_COFFEE_GITHUB_CLIENT_ID`, `PI_COFFEE_GITHUB_CLIENT_SECRET` and the
existing `PI_COFFEE_PUBLIC_URL`. Register the callback as
`<PI_COFFEE_PUBLIC_URL>/auth/github/callback`. Missing OAuth configuration keeps the
management UI readable and explains why Connect is disabled. Old
`PI_COFFEE_GITHUB_TOKEN` is no longer a production authorization source.
GitHub Enterprise OAuth is not included in this GitHub.com change.

Before production cutover, back up service configuration, pause the watchdog and
allow active work to finish. The owner removes legacy Codex GitHub connectors and
VM GitHub credentials separately; do not log out the model-provider account. Native
processes must be recreated for the new execution environment. Existing tasks retain
files/history and require explicit binding where necessary.

Acceptance is at HTTP/WS, browser-controller and actual Git/gh subprocess seams:
multiple accounts per user; cross-user denial; OAuth state replay/session mismatch;
no browser token disclosure; explicit picker selection; durable task binding;
concurrent account identity; missing/revoked authorization with hostile ambient
credentials; native environment propagation; preserved Gitea/model integration.
Real GitHub consent and repository write verification require an operator-configured
OAuth App. Fixture success alone is not evidence of production OAuth activation.

### Destination-specific Git admission (2026-10-04, Server #44)

Managed Git authorization checks the operation's selected destination, not every
remote configured in the caller's current directory. Pure local clones and
Gitea operations remain usable without a GitHub binding, including inside a
historical GitHub checkout. Actual GitHub destinations require the selected live
binding and retain legacy-header rejection and isolated credential helpers.
Resolve explicit targets, default branch remotes, push URLs, fetch groups and
Git URL rewrites using config-only Git probes. Parse option operands separately
for each subcommand (for example, `push -u` takes no value, while `clone -u` does).
Clone-local `-c` URL rewrites participate in target resolution before transport.
