# Specification freshness audit — 2026-10-01

Scope: current Server main at `394b779` plus GitHub Server #19 takeover implementation.
Compared maintained specifications to the public interfaces, browser controllers,
adapters and tests. Historical reviews/ADRs are dated evidence, not silently rewritten
as if newer decisions existed at their original publication date.

| Area | Current contract and evidence | Outcome |
| --- | --- | --- |
| Agent selection | Work Pi ↔ Codex via menu/consent/fresh native session; Chat stays Pi; Claude unchanged. `server.ts`, `native/factory.ts`, `takeover-controls.js`, `test/takeover.test.ts` | Added `agent-takeover.md`; corrected NE-06/NE-19/NE-AC02, NB-03, workspace/storage/protocol/sidebar wording; marked ADR-0013 and Backlog amendment. |
| Queue controls | Host-owned pending instructions support cancel/edit/promote; already delivered native steering cannot be retracted. `input-queue.ts`, `queue-controls.js`, HTTP/WS tests | `input-queue.md` current; removed conflicting informational-only paragraph in `native-agent-browser.md`. |
| Context display | Chinese labels; Pi attribution estimate vs Codex native totals; unavailable categories are not zero. `context-status.js`, adapters, native-agent tests | Corrected old English display labels in the leading `context-usage.md` contract; kept native totals/preset/compaction section. |
| Context controls | Default 272k, model maximum warning; Codex native remote compaction, Pi manual experimental Handoff and native automatic compaction | Existing `context-usage.md` and `manual-handoff.md` remain current. Takeover is a separate cross-engine operation, not a rename of compaction. |
| Attachments and files | Paste stays a browser draft until Send; no automatic artifact gallery; latest-turn edited-file summary starts collapsed, cumulative Diff separate | `task-storage.md` and `arena-navigation.md` match current controller and transfer/turn-snapshot tests. |
| Skills | Web manages native VM installations by Agent; collection selection/select-all, native disable/restore, Pi/Codex slash completion | `skill-management.md` matches implementation; updated active-Agent wording and pinned Pi reference. No cross-engine Skill copying during takeover. |
| Test computer | One Windows SSH endpoint with optional same-machine WSL, logo-menu configuration and conditional pointer | `test-runners.md` matches `runners.ts`/`runner-cli.ts`; remains distinct from SSHME. |
| Local assistance | Explicit `/sshme`, confirmed user computer address, Linux/macOS/Windows, separate scoped credentials and dispatch | `sshme.md` matches Host/Web/controller tests. No Windows-only assumption or reuse of test-server configuration. |
| Environment guidance | One English runtime instruction applies even to Pi Chat; no project AGENTS.md rewriting | `session-environment.md` current; corrected zero-system claims in context/Skills/Gitea integration specs. |
| Source/storage boundary | GitHub Server owns Host/Web/adapters, Pi repository owns versioned plugins; ordinary independent clones and upgrade-safe task bundles | Repository map and ADR-0021 remain authority. Added source-boundary notes to copied Pi specs, without claiming Server owns current plugin internals. |

This audit does not certify every old research note, roadmap milestone or external
Pi plugin document as a current release specification. Dated history remains for
traceability. `docs/index.md` points to the maintained contracts; Issue #19 carries
actual test/deployment evidence. Native compatibility remains pinned-version and
capability dependent; successful takeover does not guarantee zero information drift.
