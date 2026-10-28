# Current PI Coffee topology

Reviewed 2026-10-26 against Server `1db8ab3` (v0.56). The current two-user
installation runs Web, the primary workbench Host and native Agent CLIs on one
Linux VM under one OS account. Web and Host remain separate user services.
The [same-VM migration](../deployment/same-vm-migration.md) records the accepted
cutover; [ADR-0020](../adr/0020-unified-github-authority.md) establishes shared
execution and [ADR-0021](../adr/0021-pi-only-source-authority.md) owns source boundaries.
Separate Web machines and per-user VMs are optional deployment alternatives,
not prerequisites for the current product.

## Physical deployment and logical roles

```text
User browsers (LAN or configured public Web origin)
                    |
       +------------v----------------------------------+
       | One Linux VM / one OS account                 |
       |                                               |
       | Web service: UI, Gitea OAuth, scoped gateway   |
       |          | authenticated HTTP / WebSocket     |
       | Host service: user registries, tasks, files,   |
       |               native Agent adapters           |
       |          | native CLI processes               |
       | Pi / Codex / Claude / Cursor / Grok           |
       |          | durable task and native stores     |
       +-----------------------------------------------+
           |                |                 |
         Gitea           GitHub          Model providers
    identity / repos   optional repos    native engine auth
```

Gitea is an external identity/repository service in the current installation;
co-locating Web and Host does not require moving Gitea or hosting a model server.
Native engine availability is discovered through adapters and configured commands.
Each conversation selects its engine; `PI_COFFEE_AGENT` is not a single-engine
restriction for the entire Host. Pi-specific Relay use remains explicitly
configured and does not become a compulsory proxy for other engines.

The two services use their configured local/private HTTP/WS endpoints even on
one machine. Existing Host LAN binding is preserved; same-VM deployment does
not imply that every listener has already moved to loopback. Host-to-Web OAuth
renewal uses the local Web endpoint. Browser login callbacks still use the public
Web origin. Use [the single-VM templates](../../deploy/single-vm/README.md) for
service setup; retain the migration runbook for rollback and source fencing.

## Identities and isolation

- Gitea authenticates Web participants. Web selects an administrator-configured
  route and forwards its scope on authenticated HTTP/WS; the browser cannot
  choose another participant's scope.
- Route-file shared mode derives `gitea-<numeric-id>`. An explicit
  `legacyDefault` route retains the existing owner's unscoped registry. Older
  signed-cookie deployments may retain login-name keys; those are compatibility
  cases, not instructions to rename current data directories.
- A fresh fully scoped setup uses `PI_COFFEE_SHARED_HOST=1` on Web and
  `PI_COFFEE_REQUIRE_USER=1` on Host. The current legacy-owner installation must
  continue accepting its default scope until an explicit data migration.
  Follow [legacy-owner onboarding](../deployment/unified-release.md#shared-host-onboarding-with-a-legacy-owner),
  rather than enabling REQUIRE_USER indiscriminately.
- Host keeps each scope's conversations, locks, file grants, GitHub credentials
  and broadcasts separate. Gitea repository credentials and Git author identities
  are configured per participant. GitHub project bindings and explicit GitHub
  access for Gitea Work tasks are defined in [the account contract](../spec/github-accounts.md).
- Native provider login belongs to the OS owner's CLI configuration. Separate Web
  accounts do not imply separate model subscriptions or native home directories.
  Explicitly shared machine Skills are another documented shared resource.

This is application-level separation and soft Agent guidance between trusted
participants. Unrestricted processes sharing an OS account can access that
account's files; directory names and prompts do not provide an OS security sandbox.
Separate OS identities/VMs remain an option when that stronger boundary is required.

## Data ownership on the shared machine

Host owns durable task data and native execution. Web owns login/routing and
bounded control metadata; it forwards conversation/file bodies without becoming
a second durable transcript/archive store. These are process responsibilities,
not a prohibition on storing Host data on the same physical disk as Web.

Configured task bundles use
`<TASK_ROOT>/<mapped-account>/projects/<conversation-id>/`: both Chat and Work
have a workspace, attachments and other task-owned directories. Work uses an
independent clone and task branch; the platform does not allocate worktrees.
Native histories remain in their native stores. Exported `history/conversation.json`
is a display/export snapshot, not a native session restore file. Existing paths
remain authoritative. See [task storage](../spec/task-storage.md) and
[conversation workspaces](../spec/conversation-workspaces.md).

## Lifecycle and failures

| Event | Current behavior / boundary |
| --- | --- |
| Browser disconnect or Web-only restart | Host execution survives while its process is alive; Browser reconnects and resynchronizes. Route-file Web sessions are in memory, so a Web restart can require Gitea login. |
| Host restart | Durable metadata/history is retained; interrupted work is recorded. Native resume support does not promise continuation of an interrupted tool or automatic replay of unconfirmed instructions. |
| VM reboot | Both Web and Host stop together. Enabled user services plus lingering provide startup; successful startup still requires valid configuration and health checks. |
| Gitea unavailable | New login and identity revalidation can fail. An existing cookie does not guarantee access until its nominal expiry; route-file sessions periodically revalidate identity. |
| Provider outage | The engine reports its native/provider error; existing task data remains on Host. |
| Shared VM/storage failure | Both application services share the failure domain. Restore requires the documented data/configuration backup, not only a Git checkout. |

Deployment stops the old Web before activating its replacement. Only one Web
entrypoint should serve the configured origin. Independent service lifecycles
still allow Web-only updates when compatible. Background/queued work must be
considered before Host restarts. See [release procedures](../deployment/unified-release.md)
and [state backup](../deployment/state-backup.md).

## Source evidence and remaining operational boundaries

| Claim | Maintained evidence |
| --- | --- |
| Numeric scope and legacy owner routing | `src/web/identity.ts`, `test/identity.test.ts`, `test/shared-gitea-onboarding.test.ts` |
| Scope-local Host services and native adapters | `src/main.ts` (`createScope`, `scopeForUser`), `src/host/server.ts`, `src/host/native/factory.ts` |
| Task paths and per-task credentials | `src/host/task-storage.ts`, `src/host/workspaces.ts`, `test/github-project-authorization.test.ts` |
| Same-machine service deployment and safe migration | `deploy/single-vm/`, `scripts/migrate-web.py`, `test/web-migration.test.ts` |

The [2026-10-26 audit](../reviews/topology-freshness-20261026.md) records live
observations separately from source support. It also retains legacy service/route
cleanup as an unresolved operational item. Optional remote Host support is not a
claim that all historical machines or routes have been decommissioned.
