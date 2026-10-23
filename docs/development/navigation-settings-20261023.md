# Navigation and confirmed settings — 2026-10-23

Candidate version: 0.53. This source candidate preserves the owner-supplied running
cat asset from ab67a5c. It has not been published or deployed by this change.

## Scope

- Distinct folder headers and tree indentation; hide empty visible groups without
  deleting persisted metadata. Empty destinations remain in the move selector and
  the logo's Manage groups menu retains empty-only deletion.
- Local settings drafts with Confirm; outside/Escape/navigation cancels. New-Agent
  catalog discovery does not start a native task. Existing-Agent takeover retains
  separate drift consent. Billing consent precedes mutations. Native model,
  effort, capacity and speed changes wait for authoritative state in sequence;
  failure stops the remaining sequence and does not claim atomic rollback.
- One MISHU parent entry with all static/dynamic actions in its secondary menu.
  Viewport positioning and keyboard return retain access on narrow displays.
- No Host execution, native provider authentication or MISHU authorization changes.

## Evidence

`npm run check` passed: 165 test files, 1,274 tests and all 16 configured Browser
probes. `scripts/probe-navigation-settings.mjs` exercises the real controller at
1280px and 390px: folder projection, hidden empty groups, submenu dismissal,
engine/model draft edits and explicit confirmation, with zero page errors.
Controller tests cover cancellation, conversation changes, serialized native
settings, rejected model changes, existing display-mode behavior and group moves.
The existing billing/takeover tests now explicitly click Confirm before consent.

The first broad run also encountered the previously observed runtime-temp crash
reclamation timing failure. The subsequent canonical run passed that test without
changing runtime cleanup. This UI change does not claim to fix that intermittency.
All acceptance uses synthetic transports/native fixtures; no live provider turns
or production service restarts were performed.

Related contracts: [navigation](../spec/arena-navigation.md#confirmed-settings-and-folder-hierarchy-2026-10-23),
[MISHU](../spec/mishu.md), and existing Server issues #50, #33 and #59.
Publication, fresh-clone release verification and production activation remain
separate steps under the release runbook.
