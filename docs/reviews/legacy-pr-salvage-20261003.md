# Selective recovery of historical Gitea PRs

Tracking: [Server #31](https://github.com/awangs1986/pi-coffee-server/issues/31)
and [Pi #7](https://github.com/awangs1986/pi-coffee/issues/7).
This review starts from GitHub Server `68c1586afa7b5cc905cf3e175b019ed7520fe6f7`
and Pi `5d39297ec20231c3173b2f002a6281bfe6edca46`. Both Gitea main refs matched
those commits. Old PRs were fetched as refs and inspected; no old tree was merged.

## Disposition

| Historical Gitea PR | Pinned head | Decision against current main |
| --- | --- | --- |
| Server #5 frontend audit | `d923d3332dfd026970c86c7c471aa09fefb75b5d` | Recover the independently reproduced continuity fixes below on the current browser controller. |
| Pi #37 Chat/Work migration | `83f7e3d60b501319570e3e2608a66cb86a6497f0` | Already an ancestor of Pi main; no code to recover. |
| Pi #38 dual-VM acceptance | `b145578e1508695077f1c5efc9b4d09e7cfd5def` | Already an ancestor; historical evidence is not a reason to restore the old topology. |
| Pi #65 custom search evidence | `5653e575a20c07e119a597a92a71b0b19d39835f` | Superseded by official pi-web-access and current native result bounding. No isolated improvement justified restoring the assessor/store/tools. |
| Pi #68 Harness upgrade | `03ba7ea83e49cf94fab8a2ed317863b0f27be2ad` | LSP cancellation/framing/readiness/snapshots already have newer implementations; handoff core is already present. Automatic handoff/admission overrides are retired. Recover only the smaller Git discovery contract in Pi #7. |

The old #68 branch is stacked on #65; its incremental comparison was
`git diff gitea/pr-65...gitea/pr-68`, not the entire inherited search experiment.
Ancestry was checked with `git merge-base --is-ancestor` for #37/#38. Feature
coverage, not commit dates or an open PR label, determined the other decisions.

## Server #5 coverage

F identifiers refer to the historical `frontend-audit-20260922.md` at the pinned
head. The current cache, delivery outbox, question acknowledgement, grouped
sidebar, independent task clones and deferred attachment upload remain authoritative.

| Old finding | Current disposition |
| --- | --- |
| F01–03 collapsed/sidebar/header geometry | Current grid placement and compact layout retained; five current Chromium viewport probes passed. |
| F04 late creation | Reject success/failure/finalization from an obsolete selection or connection. |
| F05–06 first-send drafts | Retain the pending first message and newer edits; ignore duplicate submission while preparation is pending. |
| F07 task-local drafts/recall | Bounded page-memory text drafts by account/task; clear recall on reset. No durable draft or attachment cache is added. |
| F08 Chat Checks loader | State clearly that project Checks do not apply instead of leaving a permanent loader. |
| F09 stale sync after disconnect | Delayed HTTP cannot restore a confirmed sync badge after connection loss. |
| F10 late review errors | Guard current Checks results/errors; current Diff already guards its requests. Old `showWorkspacePreview` is uncalled, so no active-preview bug is claimed. |
| F11–12 IME/nested controls | Composition bypasses slash/confirmation shortcuts; row activation ignores nested action buttons. |
| F13 image decode/send race | Reserve the original before decoding; Send waits, and a removed original cannot reappear. |
| F14 cancelled upload | Validate selection occurrence and upload object membership after hashing/preparation and in callbacks. |
| F15 transfer failure | Preserve current explicit Send boundary; add bounded preparation/upload/confirmation waits and explicit failed-file retry. Old eager upload is excluded. |
| F16 uncertain delivery | Keep the newer request-correlated outbox and manual recovery; do not reinstate automatic replay. |
| F17 acknowledgements | Existing rename/question acknowledgements retained; stop notice requires a successful socket write. Legacy no-workspace delete flow is not changed or newly certified. |
| F18 expired auth | Existing authenticated identity revocation/sign-in behavior retained. |
| F19 scoped grants | Preserve owner-scoped tokens, refresh existing tool links and reject older poll grants after socket rotation. |
| F20 modal lifecycle | Shared topmost-modal focus, background isolation, focus return and IME handling for shell modals. |
| F21 preview placement | Current artifact links open a separate preview URL; do not revive the unused old panel preview or replace current Diff. |
| F22 short windows | Current layout passes long-draft/collapsed-sidebar probes at five widths/heights; no old menu/CSS tree copied. |
| F23 polling focus | Keep stable task-detail controls and restore equivalent sidebar action focus after metadata rebuilding. |
| F24 poll ordering | Per-resource request order plus user/task/selection/connection validation. |
| F25 context popover | Current native context dialog supersedes the old popover implementation. |

## Review axes and acceptance

**Standards:** independent review identified the confirmed-sync regression as a
violation of the current workspace disconnect contract. Shared selection guards
avoid independently drifting ID-only checks. The old source tree is not a
maintained implementation target.

**Spec:** independent review rejected the obsolete custom search, auto-handoff,
V5 worktree and layout replacements. Follow-up inspection found that the old
preview function has no current caller; that observation is not represented as a
reproduced bug. Current user/account/task boundaries and native engine ownership
are preserved.

**Security:** old unscoped `grant.scope === taskId` checks cannot be copied into
current owner-scoped transfers. Removed-upload checks concern same-user task
integrity; no cross-account bypass was demonstrated. No dependency or credential
change is part of the Server patch.

The controller regression loop initially failed 11 behavioral cases. Five more
failed in the attachment/focus pass, and two more failed in the grant/detail-focus
pass. The final file has 20 passing cases, including positive controls. Initial
missing generated vendor modules were a fixture setup failure and are not counted
as behavioral evidence. A complete check also caught four cache-test regressions caused
by an overstrict initial-identity guard; the guard was corrected without weakening
the existing cache tests.

Commands:

```sh
npm ci
npm run check
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome node scripts/smoke-frontend-continuity.mjs
```

The Chromium probe uses a synthetic loopback HTTP/WebSocket fixture and current
HTML/CSS/controller: task switching and text drafts, IME confirmation, modal Tab
and focus return, background Ctrl+K, five long-draft/collapsed-sidebar geometries
(1440×900, 1024×768, 650×650, 390×600, 390×480), and page-script errors. It sends no
model request and uses no real account, transcript or task directory. This is not
production deployment or real mobile-keyboard certification. The old PRs remain
unchanged; the new PRs carry only reviewed recovery from current main.
