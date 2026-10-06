# Sidebar change navigation and review

Start with [the current navigation contract](../spec/arena-navigation.md) and its
linked Issue. [CONTEXT.md](../../CONTEXT.md) distinguishes Conversation, Run,
Display Index, native binding and Browser identity.

| Behavior | Source entry | Public acceptance |
| --- | --- | --- |
| Date buckets, recent activity and stable ordering | `public/sidebar.js`; workspace merge in `public/app.js` | `test/shell-logic.test.ts`, actual controller in `test/local-first-app.test.ts`, `scripts/probe-sidebar-activity.mjs` |
| Completion versus unread attention | `src/host/session.ts`, `src/host/workspaces.ts`, registry wiring in `src/host/server.ts` | public WS in `test/host-server.test.ts`, scoped HTTP in `test/sidebar-http.test.ts`, `scripts/probe-completion-icon.mjs` |
| Busy menus, focus and scroll | `public/sidebar-interaction.js`; list rendering in `public/app.js` | `test/sidebar-interaction.test.ts`, `scripts/probe-sidebar-scroll.mjs` |
| Account revocation and delayed metadata | `whoAmI`/`loadWorkspace` in `public/app.js` | held auth/workspace and active-menu controller regressions in `test/local-first-app.test.ts` |
| Pins, groups and archive membership | `public/app.js`, `src/host/workspaces.ts` | `test/native-agents.test.ts`, `test/sidebar-http.test.ts`, existing group/pin browser probes |

## Reviewer lifecycle matrix

Review current behavior across these cases, using existing tests before adding new
ones: fresh/new task; admitted run; streaming/tool updates; waiting question;
settled while attached/detached; viewed completion; idle retirement; browser/Web
reconnect; Host restore after settled/running; new run; interruption; reset/takeover;
account switch during held reads, open menu or pointer/drag; grouped/ungrouped;
pinned/archived; offset/equal/invalid timestamps.

Use durable native run status for completion and unread attention for review
needs. Use real conversation activity for date/order, not file telemetry. Keep
navigation local while metadata/control readiness synchronizes independently.
Identity revocation removes old account state and visible DOM immediately, even
if ordinary rendering is deferred. These are cross-file judgement checks for the
reviewer; mechanical syntax checks belong in ESLint and CI, not new AGENTS prose.
