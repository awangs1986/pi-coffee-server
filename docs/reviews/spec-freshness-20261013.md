# Weekly specification reconciliation — 2026-10-13

## Scope, authority and evidence

Window: 2026-10-06 through 2026-10-13, including the current local display-mode
candidate. Reviewed Server source is `e7f8ce5f75b07d5e153060c67c5713a4450060c5`,
based on published main `789a0d19555ad4adf639488e1b98a3d928046058`.
GitHub and Gitea main were fetched and both matched that published SHA. The local
candidate is preserved; it has not been represented as a remote main deployment.
Merge duplicates in the week's Git history are grouped by product behavior below,
not counted as separate features.

The independently owned Pi main was read as
`d89871ec6184f58a819c86667d490fe5a505873c`; MISHU main was read as
`3f408d5a8f58b0671d0121d6e8ed2d71d91a043b`. This audit changes Server-side contracts
and consumer references, not plugin-owned product source. Existing plugin
requirements and unfulfilled acceptance criteria retain their own authority.

Linked GitHub Issue reads were attempted but returned anonymous API rate-limit
errors. Checked-in issue-linked specs, implementation, tests and previously
recorded evidence supplied this audit; live Issue state was not re-verified.
The scoped publication credential was unavailable in the preceding feature task.
No fallback identity, new Issue, remote push or deployment is claimed here.

## Source, installation and deployment are different states

| Item | Recorded state | What it does not prove |
| --- | --- | --- |
| Last recorded Web/Host release | v0.22 / `1139720`, normal mode, 2026-10-13 acceptance in [#125](https://github.com/awangs1986/pi-coffee-server/issues/125#issuecomment-6151134729) | No new live process/asset check was run for this documentation task. |
| Published Server source | v0.23 / `789a0d1`, GitHub and Gitea identical; namespace repair | Published source is not active Host code. |
| Local Server candidate | v0.24 / `e7f8ce5`, Compact/Detailed display | Not published or deployed; matching Browser/Host activation is needed. |
| Cat Skills installation | Recorded 50 managed packages each for Pi/Codex at `c77c5a1`; metadata-only inventory/catalog checks completed | Installation does not activate new Server code, authorize other engines' installation, or prove every Skill's model behavior. |
| Model and plugin readiness | Native capabilities and configured credentials remain runtime facts | An installed package or cached model name does not establish current authentication, quota or provider availability. |

The two-user Gitea acceptance used real repository creation, clone, commit/push,
remote SHA and PR ownership. Its browser route test mocked only the OAuth code
exchange on loopback; it must not be described as a newly completed external
browser OAuth authorization. The one real Codex Fast turn was already completed
for #123; that historical one-turn grant is not reusable authorization.

## Week-to-spec coverage

The following table is the review map. Existing accurate sections were retained;
changed normative claims are listed in the disposition section below.

| Area and representative source | Current behavior and authoritative contract | Implementation / maintained evidence |
| --- | --- | --- |
| Model preview (`b3842a7`) | Immediately show this Conversation's last confirmed model/provider/effort; display caches do not set native configuration. [Switching](../spec/conversation-switching.md#last-confirmed-model-display-2026-10-06-server-68) | `public/conversation-models.js`, `test/conversation-models.test.ts`, `scripts/probe-conversation-models.mjs` |
| Pi model resume / Codex readiness (`38c3d97`) | Existing native Pi model wins over startup defaults; Codex local login readiness is separate from optional slow metadata and provider acceptance. [Native engines](../spec/native-agent-engines.md), [Pi recovery](../spec/conversation-switching.md#pi-process-lifetime-and-native-model-recovery--2026-10-07-server-92) | `src/host/pi-adapter.ts`, `src/host/codex-adapter.ts`, `test/pi-model-recovery.test.ts`, issue-linked readiness review |
| Sidebar recency (`0373d07`) | Last real conversation activity controls date buckets/order; tool telemetry does not reorder rows. Unpin returns to this order. [Navigation](../spec/arena-navigation.md#recent-conversation-order-2026-10-06-server-80-supersedes-54) | `src/host/workspaces.ts`, `public/sidebar.js`, maintained activity/scroll Chromium probes |
| Completion and read state (`8e81dd5`, `17c5998`) | Native settlement is durable; the coffee indicator means unread completion, shared per account across browsers. Reading older/cached content does not acknowledge a newer completion. [Navigation](../spec/arena-navigation.md#viewed-completion-acknowledgement--2026-10-08-server-100) | `public/completion-reads.js`, `test/completion-reads-http.test.ts`, completion-icon probe |
| Repository-free Codex Chat (`bf91d12`, #98) | Pi default, advertised Codex optional; scoped directory/attachments, retained native preferences, empty-context reset. Pi and Codex Chat can reset when Host supports it; Work cannot. [Native engines](../spec/native-agent-engines.md#repository-free-codex-chat--2026-10-08-server-98) | `src/shared/protocol.ts` `CHAT_ENGINES`, `src/host/server.ts`, `scripts/probe-codex-chat.mjs` |
| Word/HTML/local file output (`38c3d97`, `d7e0165`, `2aa5ca8`, `585a7ce`) | Bounded Word discovery during streaming, authorized ordinary downloads and native HTML visualization links; preserve code-frame Copy. [Task storage](../spec/task-storage.md) | `public/document-downloads.js`, `public/render.js`, `test/word-download-http.test.ts`, attachment-download and streaming probes |
| Attachment drafts (`42a374d`) | Original unsent Files belong to account plus Conversation; stale decoding/uploads cannot transfer them to another task/account. No send before explicit submission. [Task storage](../spec/task-storage.md#conversation-scoped-attachment-drafts-2026-10-09) | `public/app.js`, `test/local-first-app.test.ts`, attachment-drafts probe |
| Heartbeat and wake (`18952c4`, `008bd6c`, `0e64265`) | Visible Browser ping/deadline plus Web–Host liveness; hidden timers pause; focus/pageshow/resume reattach the selected task without prompt replay. [Switching](../spec/conversation-switching.md#connection-recovery-2026-10-08) | `public/socket-heartbeat.js`, `src/web/server.ts`, connection-recovery and idle-recovery probes |
| Answered questions (`585a7ce`) | Native-accepted answers are not replayed on reconnect while waiting for the next reply. [Protocol](../protocol.md#accepted-questions-are-not-replayed--2026-10-11-server-118) | `src/host/session.ts`, `src/host/server.ts`, question-replay probe |
| Scoped OAuth renewal (`20822aa`, #105) | Per-account expiry/refresh handling through authenticated bounded Web service transport; no shared-credential fallback or account switch. [GitHub authorization](../spec/github-accounts.md#automatic-oauth-renewal-2026-10-09-server-105) | `src/host/github-token.mjs`, `test/github-renewal.test.ts`, `test/github-oauth.test.ts` |
| Explicit restart (`1c22c03`, `a23a226`) | Web-local `/restart`, operator admission, explicit impact confirmation, durable receipt and bounded independent worker; works on LAN HTTP and never becomes an Agent prompt. [Restart](../spec/service-restart.md) | `public/restart.js`, `scripts/probe-restart.mjs`, restart contract's HTTP/worker tests |
| Formal versions / release gates (`1c4faed`, `f6ed741`, `a41649f`, `fe65a0f`) | Small +0.01 / large +0.10, synchronized metadata; independent Browser/Web/Host version identity, reviewed checks, GitHub-first mirror and exact-source fresh clone. [Versioning](../deployment/versioning.md), [workflow](../development/verification-and-release.md) | `scripts/bump-version.mjs`, `scripts/verify.mjs`, `scripts/publish.mjs`, developer verification tests |
| Pi 1.1.0 integration (`381eca1`) | Native cancellation is interruption, not success; preserve independent plugins, native tool/context boundaries and current adapters. [Upgrade contract](../deployment/pi-110-upgrade.md) | `package.json`, `package-lock.json`, `test/pi-package-integration.test.ts`; current pins below supersede the dated initial consumer selection |
| MISHU tracking/manager (`d9c97c6`, `fe6664f`) | Bounded task briefs, observation/dispatch/reporting and deterministic watch/rules/to-do; plugin owns product policy, Host owns trusted scope/state/native execution. [MISHU current status](../spec/mishu.md#current-source-status-2026-10-13) | `src/host/mishu.ts`, `mishu-watch.ts`, `mishu-reports.ts`, manager/dispatch/startup public tests |
| MISHU older contacts (`76e41d6`, plugin `3f408d5`) | 72-hour filter is for the directory only; explicit exact-ID selection may add older targets. Incremental selections and final authorization remain. [MISHU user flow](../spec/mishu.md#user-flow) | `test/mishu-old-contact-menu.test.ts`, [source ownership](../development/mishu-source-ownership.md) |
| Pi-only secretary / batch policy (`d445d18`, integrated by `4877035`) | Only Pi Chat is a secretary source; other engines are targets. Passive reads do not create turns; mass awakening requires explicitly scoped approval. [MISHU](../spec/mishu.md#pi-only-secretary-boundary-2026-10-12), [batch policy](../spec/batch-agent-execution.md) | `src/host/mishu.ts` source admission/recovery, bounded registry metadata reads |
| Codex speed / post-send promotion (`5119256`, `cf7a2f7`) | Standard/Fast native service tier with cost confirmation; busy sends queue first, then exact-row edit/cancel/promotion without duplicate prompts. [Speed](../spec/codex-speed-and-queued-input.md), [queue](../spec/input-queue.md) | `src/host/codex-adapter.ts`, `public/queue-controls.js`, #123's completed one-turn functional evidence |
| Complete two-user workbench (`4bc8080`, `8c2a584`, `1139720`) | Shared Host does not mean Chat-only access for the second account: own verified Gitea credentials, Git author, route and task folders support create/clone/push/PR. [Multi-user workbench](../spec/multi-user-workbench.md) | `test/shared-gitea-onboarding.test.ts`, `test/gitea-native-credentials.test.ts`, recorded #125 acceptance |
| Skill namespace and installation (`789a0d1`) | Preserve qualified native names and exact invocation paths; suffix menu search; installed content, explicit invocation and automatic discovery differ. [Skills](../spec/skill-management.md#codex-skill-namespaces-2026-10-13) | `src/host/codex/skills.ts`, `src/host/codex-adapter.ts`, recorded #126 installation/source evidence |
| Compact/Detailed (`e7f8ce5`, local only) | Default Compact omits process payloads before transmission; Detailed restores existing bounded cards. Per-account setting, independent native context, reliable questions/answers/queue/status across changes. [Delivery](../spec/conversation-delivery.md) | [Feature acceptance](conversation-display-20261013.md), `scripts/probe-conversation-display.mjs` |

## Reviewed consumer pins and upstream work

The package manifest and lockfile, not an upstream branch's name, determine the
Server's consumed runtime. At this baseline:

| Component | Consumed version |
| --- | --- |
| Native Pi packages | 1.1.0 |
| Harness | 0.3.3 |
| LSP | 0.4.7 |
| Context Handoff | 0.2.0-experimental.6 |
| MISHU | 0.3.0-manager.5 |
| Official Web access | 0.37.0 |
| Official Subagents | 0.76.1 |
| Optional Antigravity | 0.10.0 |

Pi's week covers 1.0.4 compatibility (`e5f05f1`) followed by 1.1.0 compatibility
(`3292a18`, merged at `d89871e`). MISHU's week includes bounded tracking, report
responsibility and recovery; clipped-reply/stop-state repairs (`d4eb1ed`);
manager and authorization/cancellation repair (`43e39e6`, `ba9d714`);
Pi 1.1 compatibility (`8bf0bff`); product-policy extraction (`7607045`); and
older-contact lookup (`3f408d5`). These consumer facts do not replace the independent
plugin specs, certify every E01–E05 experience target, or authorize bulk runs.

## Disposition of stale statements

| Location | Previous claim | Treatment and evidence |
| --- | --- | --- |
| `CONTEXT.md` MISHU / watchdog | Candidate Codex secretary and all persistent follow-up still planned | Replace with Pi-only source plus implemented bounded tracking/manager slices; preserve broader acceptance gaps. Host source admission and later integrated commits support this. |
| `arena-navigation.md` pins/reset | Unpin uses creation time; only Pi can clear Chat context | Use latest-activity order and capability-gated Pi/Codex reset. `workspaces.ts`, `CHAT_ENGINES` and Host reset admission are authoritative. |
| `arena-navigation.md` history | All history always contains expandable process groups | Qualify this as Detailed behavior; local v0.24 Compact is separate and not yet deployed. |
| `mishu.md` historical slices | Older section says background tracking absent or Codex bridge active | Add current-status authority, retain dated acceptance IDs/evidence, mark Codex source paths superseded rather than deleting history or unmet criteria. |
| `gitea-workspaces.md`, Skills credentials | Generic VM/global Git credential usage | Point to current per-account verified bindings, keeping the explicit legacy-owner exception and unrestricted OS permissions. No approval or identity boundary is relaxed. |
| `skill-management.md` | Discovery cites old Pi 0.99.1; source/installation distinction easy to miss | Use consumed Pi 1.1.0 and add dated 50-package reconciliation versus unactivated v0.23 code. |
| `codex-speed-and-queued-input.md` / index | One model turn still reads as open-ended future authorization | Mark the previously granted probe complete; keep test evidence and ordinary high-risk policy. |
| `input-queue.md`, native Browser / context specs | New composer controls scattered or missing | Link queue-first admission, native Speed and separate display mode; keep token-capacity and engine-binding meanings intact. |
| `protocol.md` | Browser remembers no transcript across reload | Replace with bounded, scoped display caches and authoritative Host/native history. |
| `BACKLOG.md`, documentation index | Dated ownership, Pi-only Chat and MISHU source notes read as current | Add weekly current entry and qualify conflicting dated notes; preserve milestone history and valid feature links. |
| Accurate topical sections | Attachments, download authorization, heartbeat/wake, accepted questions, OAuth renewal, restart, version increments and two-user acceptance | Reviewed and retained. No artificial rewrite or unsupported completion claim. |

## Instruction preservation and checks

`AGENTS.md` was reviewed with the repository map and scoped instruction locations.
It is already concise; no evidence-supported rule deletion or authority change was
needed. It remains byte-for-byte unchanged: 32 lines / 3872 bytes before and after.
Always-required scope, explicit batch approval, GitHub-first publication, native
permissions and release-completion gates are preserved. Exact starting copies of
all edited existing documents and AGENTS.md were backed up privately before edits.

A representative task now has one path: AGENTS.md → repository map/docs index →
this baseline map → its topical contract and evidence. New agents can distinguish
a Codex target from a secretary, model capacity from display mode, cached UI from
native authority, and local source from an active release without reviving old rules.

This update is documentation-only. Verification checks documentation vocabulary,
local file/anchor references, source-pointer existence and diff whitespace. The
preceding code baseline already passed 138 files / 1,153 tests and 13 no-model
Chromium probes; that is prior feature evidence, not a claim to have rerun those
checks for this prose update. No runtime files, native accounts, tasks or services
were changed. Live provider capability, operational settings not represented in
source, broader plugin acceptance and future deployment remain explicit boundaries.
