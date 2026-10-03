# Workbench T1–T4 delivery

Scope: [Server #42](https://github.com/awangs1986/pi-coffee-server/issues/42).
Base: `fd73ed614a73a29280db0a756d43aaf84efe8d8a`.

## Behavior and evidence

| Task | Result | Verification |
| --- | --- | --- |
| T1 conversation actions | Sidebar updates defer during action-button gestures and open menus. Agent questions leave navigation available; Escape outside the question does not cancel it or abort the turn. | Red/green controller tests plus built-page pointer-down/update/pointer-up, pending question/menu interaction, Escape and switch/reopen. Narrow viewport checked. |
| T2 compact welcome | Small chibi cat maid based on the original character, short greeting, no page-wide hit target or Enter interception. | Built-page dimensions and screenshot; controller dismissal, identity and reduced-motion tests. |
| T3 running cat | Reuse existing black pixel geometry in sidebar and active-task status indicators; retain connection/attention meanings. | Built-page animation and reduced-motion assertions; screenshots. |
| T4 testing guidance | Each account's configured testing target is delivered once per configuration revision at the next user-input boundary in each conversation. Chat and Work share this discovery; updates do not start a turn or connect automatically. | Host HTTP/WS save/change/clear plus ordinary prompt and explicit steering. Real Pi Chat/Work provider-boundary test preserves native prompts/tools and carries the pointer. |
| T4 explicit SSHME | Only explicit case-insensitive Web command opens confirmation. API configuration/credentials are scoped by user and conversation, including the reserved ID of a new task. | HTTP isolation across users/conversations, guarded confirmation/cancellation, password redaction, OS routing, browser dialog. |

The general testing pointer never contains SSHME information. The assistance
pointer is emitted only after explicit confirmation and a successful SSH test.
No SSHME instruction is injected into default native prompts, tools or Skills.
Existing account-level assistance files remain untouched and are not reused.
This is application scope isolation on the existing shared OS identity, not a new
filesystem sandbox. Native Fork intentionally preserves source history, including
previously supplied connection references; history is not silently rewritten.
The new task receives no copied assistance configuration through the API.

The targeted security review found no authentication or credential-disclosure
blockers. Its Escape and steering findings were corrected and rechecked. No
native Pi/Codex/Claude account, model policy or authentication is changed.

## Repeatable checks

Run `npm run check` (93 files / 739 tests at implementation verification).
Then run `node scripts/probe-workbench-t1-t4.mjs` after building. It starts an
isolated Web/Host with a native RPC fixture, captures screenshots and a JSON
verdict, and stops its processes. No paid model or user SSH connection is used.
`PI_COFFEE_BROWSER_EXECUTABLE` can select an installed Chromium binary;
`PI_COFFEE_VERIFY_DIR` selects the evidence directory, otherwise it uses a
private disk-backed directory beneath the VM home cache. Actual Windows/macOS
remote execution is not claimed by these transport/UI tests.

Development evidence: `/home/awang/tmp/coffee-t1-t4/ui-evidence/` and
`/home/awang/tmp/coffee-t1-t4/check-final.log`. Fresh-clone check, source mirror
identity, served assets and activation status belong to the linked Issue.
