# Repository-free Codex Chat — Server #98

Baseline: GitHub/Gitea Server main `040efb831092eb0079a0a12480d1bd72225b7d4a`.
Implementation branch: `feat/codex-repository-free-chat-20261008`.
Scope: ordinary repository-free Pi/Codex Chat; MISHU source changes remain separate.

## Behavior and red-to-green evidence

- Host HTTP creation previously returned409 for Codex Chat; it now creates an
  independent user-scoped directory without Project/clone and retains the engine
  on retries. Claude/Cursor/Grok remain Work-only; Pi remains the default.
- Browser creation previously disabled Codex; Host-advertised Chat engine choices
  now allow Codex. Draft Luna/model changes are acknowledged before the first
  message; rejected settings retain unsent text. Older Host metadata stays Pi-only.
- Production Host bootstrap initially injected Work environment text into Codex
  Chat. Its real HTTP/WS regression now verifies native guidance is retained while
  automatic Work guidance is absent across creation and restart.
- Context clear previously rejected Codex. Host now prepares empty native context,
  preserves settings/files, commits a fenced binding and retains old native IDs.
  Repeated accepted operations are idempotent; stale bindings are rejected.
- Empty Codex context-preset changes previously failed the durable binding check.
  Explicit expected-binding replacement now retains the original ID and settings.

The first canonical run caught an unintended fallback Codex config-read request
when no instruction callback was configured (14 failures). Retaining callback
absence fixed the regression; native-engine/MISHU checks then passed44 tests.
Subsequent canonical verification passed116 files /899 tests and six Chromium
probes. Additional final public-seam verification passed167 tests across Codex
Chat HTTP, the Browser controller and Codex adapter after native-history changes.

## Installed native boundary

Native Codex0.159.1 actually refuses to reopen an unmaterialized empty thread;
rename does not establish a durable rollout. An empty500K thread can also report
an exact missing-source-rollout lineage instead of unmaterialized history.
Protocol fixtures initially missed both cases; they now model them explicitly.

Only Host-proven empty Codex Chat can recover missing native empty context. Its
durable marker is revoked before any prompt admission. Native authentication,
transport errors and lost nonempty/unknown/Work history never trigger replacement.
Fresh native sessions treat only exact ID-bound pre-input empty-history responses
as empty. No vendor transcript file is rewritten and no input is replayed.

`node scripts/probe-codex-chat-native.mjs` passed with the installed0.159.1 CLI:
empty recovery, Luna/medium/500K preservation and rejected recovery after revocation.
It uses an isolated native home and performs zero model turns. This does not prove
real-account Luna availability or billing acceptance.

## Browser and release boundaries

`node scripts/probe-codex-chat.mjs` passed in actual Chromium at1280 and390 widths:
Codex Chat, Luna selection, no Project and exactly one first prompt. Its HTTP/WS
responses are synthetic; the production Host/native fixture is a separate test.
The canonical Browser plan also retains the current streaming responsiveness probe.

Production Web/Host have not been restarted or deployed. Source publication,
independent review, fresh-clone verification and live activation have separate
verdicts; no MISHU artifact or branch is replaced by this change.


## Independent review follow-up

Standards found no hard breach and one task-lookup duplication. Bootstrap now
uses scoped `lookupByCwd`, avoiding unrelated GitHub account enumeration. Spec
review found an older unmaterialized-history exception that could hide resumed
history loss and let context settings replace an admitted thread. A public adapter
fault-injection regression failed before the guard and now requires fresh or durably proven unused native context and no native input for
either exact empty-history response. The adapter proof is revoked before native
input, and the Host marker remains the authority when present. Accepted request
identities remain fenced across clear.
Security found no new exploitable issue; unchanged dependencies retain the MCP SDK
and development source-map advisories already addressed on the separate MISHU
candidate branch. This change does not change package artifacts or their versions.
