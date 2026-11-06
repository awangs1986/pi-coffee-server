# Explicit cross-user conversation references

Status: implementation candidate, 2026-11-06. Not yet deployed.
Tracking: [Server #162](https://github.com/awangs1986/pi-coffee-server/issues/162).

## Owner decision

The two routed participants may explicitly read another participant's dialogue
into their current Conversation by sending `/cross-user <conversation-id>`.
This is a read-only snapshot import, not opening or controlling the source Agent.
A bare ID, ordinary task URL, normal HTTP/WS traffic and native commands retain
account isolation. This is a narrow exception to ordinary account-scoped access.

## Contract

- The Web command applies to an existing, idle destination Conversation. Pi and
  Codex share the same Web implementation; other engines can use the same command
  when their source has a verified passive history reader.
- Web requires a valid Gitea route-file login, its configured Origin and POST.
  The operator must enable `PI_COFFEE_CROSS_USER_READ=1` together with shared-Host
  routing. Default is disabled. The approved policy permits all participants
  routed to that exact Host URL/token pair to exchange explicit references.
- The Browser supplies only destination and source Conversation IDs. Web resolves
  the source through administrator-owned routes; it never accepts a caller-chosen
  account scope, filesystem path, Host address or credential. Sources on another
  Host are outside this version. More than eight peer routes is refused.
- The destination must belong to the caller. Exactly one other routed account
  must contain the requested active task; missing, archived, removed, preparing
  and ambiguous sources fail without a fallback. Routing/login is revalidated
  before the result is returned. Normal files, attachments and mutations remain
  inaccessible across accounts.
- Host uses its existing passive native-history adapter. It does not open an
  interactive session, create/fork/resume a source Agent, send a model turn, or
  access source repository credentials. Unknown native history fails explicitly.
- Import only user/assistant text, with source account ID, Conversation ID and
  snapshot time. Omit thinking and tool records; do not read attachment contents.
  Dialogue may itself contain sensitive text: this feature shares that text and
  does not promise automatic secret redaction. It grants no access to referenced
  files or credentials.
- Bound imports to the most recent 200 dialogue entries and 48,000 UTF-16 code
  units. Report truncation in both the prompt and Web notice; never claim a
  complete transcript when earlier content was omitted. No model summarizer runs.
- Imported messages are quoted historical data, not executable instructions. The
  current Agent is asked to acknowledge the reference and await the next request,
  rather than continue the source task. Only this explicit user turn carries the
  reference; no permanent system prompt or automatic per-turn injection is added.
- Fetch and send at most once per explicit submission. Preserve the command on
  failure. Discard delayed results after account/task/selection/draft changes,
  new attachments or a newly busy destination. A retry requires another user
  submission. Existing prompt delivery uncertainty handling remains authoritative.
- A successful import becomes part of the destination's native history. Disabling
  sharing later prevents new reads; it cannot retract previously imported text.

## Implementation and acceptance

Web: `public/cross-user.js`, composer/slash registration in `public/app.js`,
`src/web/cross-user.ts`, route authorization in `src/web/identity.ts` and
`src/web/server.ts`. Host: scoped `/api/conversation-reference`,
`src/host/conversation-reference.ts`; passive readers remain adapter-owned.
The private Host route is not exposed as a generic Web forwarding route.

HTTP tests use real Host/Web routing and synthetic Pi JSONL histories with an
invalid native executable to prove no runtime startup. Cover authentication,
Origin, destination ownership, disabled sharing, malformed IDs, ambiguity,
source availability, ordinary isolation and text filtering. Browser-controller
regressions cover Pi/Codex submission and delayed responses after navigation.
No production participant history is needed for implementation acceptance.
Publication, operator configuration and deployment evidence must be recorded
separately from these source checks.
