# Agent Host Interface

The canonical interface is owned by Host in this GitHub repository, under [ADR-0020](adr/0020-unified-github-authority.md):

- [wire protocol](./protocol.md)
- [protocol implementation](../src/shared/protocol.ts)

PI Coffee Server is a transparent Adapter at this seam:

1. Gitea identity selects one administrator-controlled `hostUrl` and `hostToken`.
2. `/ws` frames are forwarded without parsing or translating Agent event types.
3. `/api/workspace` requests are authenticated and forwarded to the same Host.
4. Closing a browser connection only detaches its Host transport; it does not cancel a Host session.
5. Gateway-generated transport errors use the current `v: 1` error envelope. All Agent behavior and validation remain owned by the Host.

The current consumer baseline is Host protocol `v: 1`. A Host change is compatible
when the existing browser vocabulary continues to work and unknown future frames
can pass through this gateway unchanged. For separate running services, deployment order is:

1. build Web and Host from the same verified GitHub commit; deploy the backward-compatible Host;
2. run the gateway smoke against that Host;
3. deploy Server;
4. remove old Host behavior only after every deployed Server has moved forward.

## Independent checkout workflow

[ADR-0012](./adr/0012-owner-privileges-and-gitea-checkouts.md) keeps Checkout/Git/Gitea code API operations in Host. Web displays Host-provided synchronization and PR state; platform login is distinct from Git credentials. Status/checkpoint/PR actions use independent clones rather than platform worktrees. T0–T4 completion is recorded in [the implementation evidence](reviews/t0-t4-implementation-20260921.md); it is historical deployment evidence, not a reason to repeat VM migration. Current configured layout follows [task storage](spec/task-storage.md).


## Conversation directories (2026-09-22)

The UI consumes Host `capabilities.chatWorkspaces`, `workspaceKind`, creation state,
absolute display cwd, actual branch and last remote check. New Chat needs no Project;
new Work selects Project/start branch and calls `conversation` with a stable creation ID.
The `branches` action supplies the remote picker. Failed creation retries reuse the ID.
All file bytes, including original inline images, go through the scoped streaming gateway
into the owning VM inbox before a prompt can reference them. No central file persistence.
Archive retains running work and files; permanent cleanup explicitly covers local files
and history, retains remote objects and legacy global data, and requires the exact ID.
The protocol additions and lifecycle guarantees are defined by Agent `docs/protocol.md`.

## Deployed native engines (2026-09-23)

The [Agent native-engine SPEC](./spec/native-agent-engines.md) owns the implemented additive contract for engine selection, native Session bindings, capabilities and common presentation Events. The Agent Host remains responsible for native transport, configuration and lifecycle; the gateway continues to forward the existing public HTTP/WebSocket traffic without interpreting engine protocols or handling provider authentication. Legacy Pi compatibility was verified during the staged M5 rollout.

The [Browser Shell companion](./spec/native-agent-browser.md) preserves the existing layout and scopes all Pi-specific controls to Pi. Agent delivery: [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48). Server delivery: [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6). The [M5 evidence](./reviews/native-agents-m5-20260923.md) records the deployed native support and its capability limits.

## Native Agent capability extension

The Host owns the additive `nativeProtocol: 1` contract on the existing `v: 1`
envelope. The Browser sends this flag in `open`; legacy Hosts remain Pi-compatible.
Task creation passes `engine` (`pi`, `codex`, `claude`, `cursor`, `grok`) and preserves it on retries.
Only the Host binds native IDs. `opened.engine` and `opened.capabilities` determine
which controls appear. A missing native capability means unavailable.

`GET /api/engines` is authenticated and forwarded read-only to the same fixed
User VM route as `/api/workspace`. No CLI, credential inspection, native protocol
parser or provider call belongs in the gateway. The Host returns safe local
readiness states and reasons; upstream authorization may still fail on a turn.

Native run, message, tool, pending-input and background-state events use the same
Task-scoped event envelope. Stable item IDs update existing cards; repeated cursors
are ignored, while pending native request IDs are deduplicated separately. Stop
acknowledgement is not terminal evidence. Unsupported Pi controls are hidden.
Read the [canonical Host protocol](./protocol.md)
and [native runbook](./deployment/native-agents.md)
for field definitions, recovery and the version-pinned capability matrix.

## Web-managed Skills

`POST /api/skills` uses the fixed authenticated Host route and origin checks.
See [Browser contract](spec/skill-management.md) and the linked canonical Host
contract for scoped `list`, `detail`, `install`, `update`, `enable`, `disable`
and idle `reload` actions. Machine-level mutations are restricted to the configured
VM owner; project scope belongs to one owned Work checkout. Gateway stores no Skill files, repository credentials
or enabled-state registry. A legacy Host's 404 is shown as unavailable.
