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

## Automatic OAuth renewal (2026-10-09, Server #105)

Web requests `offline_access` alongside the existing repository and identity scopes.
The callback preserves the expiring access token, refresh token and both absolute
expiry timestamps in the authenticated user's private Host store. Non-expiring
responses remain supported. Only the existing account identity fields are returned
by browser account APIs; expiry credentials and revision fences are never spread
into public metadata.

Web retains the OAuth App client secret. Host uses the administrator-configured
`PI_COFFEE_GITHUB_REFRESH_URL` (the Web origin plus `/internal/github-refresh`) to
exchange a refresh token over authenticated service transport. This endpoint accepts
no browser cookies or Origin and requires a configured Host bearer grant; routed
Hosts must also match the configured user scope. It is independent of browser login
lifetime and does not extend the Gitea browser session. Redirects are forbidden,
requests have deadlines and bounded bodies/concurrency, and errors contain no
upstream credential payload. Production uses the existing trusted LAN transport;
remote public transport must use HTTPS.

Host refreshes on demand within one minute of access-token expiry. Forge API clients
resolve their selected account's token for each request, including an API client
created before expiry. Managed Git credential helpers and gh wrappers obtain only
the access token from a private per-user Unix socket capability. They never receive
the App secret or refresh token in their environment or command arguments. The
broker descriptor is private (0600) and lives beside the private account store;
it contains no GitHub credential. Without a live broker an expired credential fails
closed. No VM-global or other-account fallback is allowed.

Concurrent requests for the same credential revision share one renewal. Successful
rotation verifies the numeric GitHub identity and atomically stores both new tokens
and expiry timestamps. Rebinding gets a new revision; deletion or rebind wins over
an older renewal, including a rejected one. Revoked renewal explicitly requires
reconnection and is not retried indefinitely; transient failures keep the existing
refresh credential and impose a thirty-second retry delay. Missing refresh grants
from older installations require one explicit Web reauthorization. No background
model task is needed to renew, and new service processes recover the stored rotation.

GitHub currently expires access tokens after eight hours and refresh tokens after
six months without use. Each successful renewal issues a new refresh token, so
regular use can avoid repeated human authorization. Revocation still requires
reconnection. Reference: [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

Acceptance: OAuth HTTP callback persistence and no Browser credential disclosure;
real Git credential/gh subprocesses and preexisting forge clients coalesce on expiry;
restart recovery; cross-user rejection; in-flight rebind/delete and rejected-renewal
fencing; wrong-identity rejection; terminal revocation and transient retry bounds;
unauthenticated, browser, wrong-route and malformed service request rejection.
Fixture coverage is not a claim that a newly authorized real account has renewed.
