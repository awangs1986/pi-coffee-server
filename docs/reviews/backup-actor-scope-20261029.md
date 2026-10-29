# Backup actor and routed scope repair

Candidate follow-up to the independent Standards, Spec and Security review of
`7b783e4`, under Server #130/#140/#141. Source validation is separate from release
or production activation.

The authenticated Gitea login is an actor; the selected Host directory is a data
scope. They need not be equal: `alice` can own `gitea-2`, and an ordinary `bob`
may be explicitly routed to a scope named `awangs`. That directory name never
confers administrator identity.

Web now forwards the authenticated login on both HTTP and WebSocket transports.
BrowserBridge and HostClient retain it independently of the route; each browser
frame rechecks the authenticated principal and the exact route. The Host does
not substitute its user/scope header when an actor is absent. `defaultUser` is
routing configuration, not an authenticated backup administrator.

The shared recovery coordinators use a request-local trusted actor/own-scope
context, established after Host bearer/header validation. Main authorizes reader
status, request and cancellation against that current pair. There is no observed
login-to-scope map, grant cache or browser-supplied ownership field. Administrator
operations retain their explicit manage privilege and the configured managed
scope allowlist. Individual restore status/request/cancel use reader/request
privileges just as account recovery already did; differing actor/scope strings
do not turn a reader operation into management. Current broker/destination role,
revision, approval and publication checks remain independent and unchanged.

The historical private maintenance listener receives its own context from the
already validated private operator profile/peer boundary, with exact profile
revalidation before actions. An OS UID alone does not issue an administrator
role. No source custody, native permissions, key policy, cut or publication gate
is relaxed.

## Evidence and retained failures

`backup-routed-authorization` uses actual compiled main, real RestoreCoordinator
and AccountRecoveryCoordinator, actual Web OAuth callback/session cookies, HTTP
and WebSocket transport. Only the remote Gitea identity provider is synthetic;
no model or external identity provider is contacted. Initial REDs reproduce a
numeric reader's status returning 500 and an ordinary administrator-looking alias
receiving the WS retention field. The repaired paths pass.

Additional cases cover concurrent per-scope reads, foreign operation-ID cancel,
spoofed browser actor/scope headers and bodies, current route revocation closing
an existing WS, genuine administrator numeric/legacy routes, unmanaged-scope
refusal, and direct private Host requests with no actor. Requested/admin-revised
operations are real durable coordinator records. No native restore publication
is claimed by this authorization-only fixture.

The focused auth/transport/coordinator regression passed 26 tests in 11 files,
zero skips, in 31.71 seconds. The first post-fix run exposed a fixture action
spelled `account-request` instead of the public `account-restore-request`; a later
concurrent request fixture hit the intentional shared restore write lock. Those
logs are retained; corrected fixtures keep concurrent reads but serialize their
initial durable requests. Existing direct-Host test personas now send explicit
actor headers, and test policy callbacks grant administrator reads explicitly
instead of depending on the removed actor/scope inequality heuristic.

The backup Browser probe now logs in through synthetic OAuth and uses real signed
cookies. Its previous `defaultUser` persona was an unauthenticated fixture, not
production login evidence. Account plan native-binding/shared-dependency preview
assertions remain in the probe. Exact Browser and mutation results are recorded
in the private handoff and final integration record.
