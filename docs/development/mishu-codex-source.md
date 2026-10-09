# Codex Luna MISHU source candidate — 2026-10-09

Parent [#84](https://github.com/awangs1986/pi-coffee-server/issues/84), slices
[#85–#91](mishu-codex-tickets.md), [current contract](../spec/mishu-codex-secretary.md).
Source implementation is distinct from main publication, package installation and
production activation. This candidate does not claim a complete background report loop.

## What changed

Browser and Host no longer reject all Codex sources as Pi-only. Existing Codex
Chat/Work can explicitly select MISHU, confirm scoped contacts and message mode,
then contact existing targets through native `coffee_mishu` stdio MCP. The owner
prefers `gpt-6-luna`; actual model/effort remain native per-thread choices.

Host reuses the scoped ledger, exact bindings, receipts, task briefs and target
capability checks. A per-user foreground admission creates the source capability;
model-supplied user/source/thread/turn identities are rejected. Capabilities expire
on terminal state, superseding delivery, disable, deselection and lifecycle revoke.
Checks after asynchronous reads and before commit prevent expired calls from
creating new work. Durably admitted messages leave the caller's invocation context
and continue through Host delivery, with current grant/binding checks.

Codex `/mishu-setup` and the visible MISHU settings button are application controls.
One-use, source-bound setup tickets expire after 10 minutes. The model cannot set
contacts, execute setup or enable notifications. `/mishu`, `/mishu-tasks` and
`/mishu-disable` also use Browser/Host; unsupported report/history/reminder commands
are explained rather than silently sent to the native model. Active selected
sources use follow-up queueing; steering is gated because an active native turn
cannot safely rotate the MCP capability/configuration.

The adapter reads only the bound thread's original native first metadata record,
checks thread ID/cwd, preserves its original baseline and appends one current role
packet through native `baseInstructions`. User developer guidance is preserved.
A private role-used marker precedes native application; failed tool discovery still
requires restoration. Deselect/reopen restores the original native instructions.
Ordinary threads never selected as secretary retain their previous startup path.
MCP approval applies only to this one-tool service; every call still passes Host
admission/grant checks. Other native tool and target permission rules are unchanged.

## Native evidence and failed approaches

Read official [app-server](https://learn.chatgpt.com/docs/app-server) and
[MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) guidance.
Generated the actual installed **0.159.1** experimental schema. `dynamicTools` is
available at thread/start but absent from this version's thread/resume schema;
existing threads are not replaced to obtain it. The MCP route is native and
supports idle unloading/resuming the same saved thread.

The authenticated native catalog contained `gpt-6-luna`. Initial real runs exposed
three differences that protocol fixtures alone missed:

- Disabled MCP tables still require a valid transport. Fixed and regressed.
- Resume developer instructions and per-turn collaboration mode metadata did not
  make Luna identify the application role. The original-baseline-plus-current-role
  path was separately proven, then adopted and tested through Browser.
- Tool discovery/name and native approval policy must agree. The bridge's native
  name is `mcp__coffee_mishu__mishu`; its one-tool approval policy is explicit.

The actual Browser/Web/Host/Codex run passed, using Luna as secretary, native Codex
as one target, and real native Pi RPC with a synthetic provider as the other.
This does not claim a real paid Pi provider model invocation. No user's existing
conversation was cleared, changed or used as a test target.

Private evidence: `/home/awang/tmp/verify-mishu-codex-Ta3Hq7/`:
`evidence.json`, three setup viewport screenshots and `native-receipts.png`.
The source thread stayed unchanged, both receipts settled, model-visible inbox
contained `PI_CONTACT_OK` and `CODEX_CONTACT_OK`, and Browser reported no errors.
Evidence contains isolated synthetic content and stays outside Git/Issues.

## Acceptance coverage

| Criteria | Candidate verdict | Evidence/boundary |
| --- | --- | --- |
| C01 | PASS for native Codex Chat; Work public seam verified separately | Real Luna identity; same thread/model; fixture preserves original native guidance and retires identity after disable/deselect/inventory failure |
| C02 | PASS | Real Browser 1280×900, 390×640, 390×320; selection, cancel/Escape, explicit confirmation, retained contacts and settings button |
| C03 | PASS for Pi/Codex contact paths | Native source tool calls, settled Host receipts, original target replies in inbox; native model and same binding |
| C04–C05 | PARTIAL | Public source tests use shared register/observe/stop ledger and reject source identity forgery; complete competition, all target engines and native dispatch acceptance remain separate |
| C06–C08 | UNAVAILABLE | All-tool-free summaries and original-summary output recovery not proven; manual facts remain available, auto reminders are disabled |
| C09–C10 | PARTIAL | Cross-account rejection, binding checks, terminal expiration during awaited admission, disable/deselect and inventory-failure restoration covered; complete Fork/takeover/restart matrix and historical note-only UI remain unmet |
| C11 | PARTIAL | Pi/Codex contacts covered; Codex durable dispatch rejected honestly; online run observation differs from unknown restart recovery; five-engine installed matrix remains unmet |
| C12 | PARTIAL | Native Codex executes source role/tools; no hidden Pi source fallback; actual source checks recorded separately from package/main/production activation |

The fixture checks include HTTP/WS and the real stdio MCP bridge. A deliberately
paused authorization read went RED when a source settled during it, then GREEN
with post-await/commit checks. An unavailable MCP inventory after role application
retains the restoration marker and returns to original identity on deselection.
The test factory verifies the existing Codex Work setup path as well as Codex Chat.

Verification commands:

```bash
npm run check
node scripts/probe-mishu-codex.mjs
MISHU_REAL_CODEX=1 CODEX_COMMAND=/path/to/codex node scripts/probe-mishu-codex.mjs
```

Keep #88/#89 report gates and unmet lifecycle/install criteria open. This source
candidate does not update plugin artifacts, publish main or restart production.
