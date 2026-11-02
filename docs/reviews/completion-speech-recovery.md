# Completion speech recovery: source review and acceptance

Scope: Server #159, base `1fa5bebb331d33b451a0d26c0e7f963b9be90c66`,
approved spec `96644f6`, source candidate Server 0.70 / plugin 0.1.2 /
protocol 2. Profile 0.1.0 is unchanged. This report is source acceptance;
production activation and actual-device listening are separate.

## Implementation and reproduced defects

The package separates a 30-second reservation from durable sound permission.
A lost reservation is recoverable; an unknown committed result is not automatically
replayed. Pending payloads have a separate 24-hour lifetime from presentation
caches. Atomic private migration retains consumed attempts and a v1 backup.
Browser delivery uses independent HTTP with ten-second request deadlines,
AbortSignals, bounded retries and lifecycle wake reconciliation. The optional
component has one recovering bootstrap and two bounded import identities; its
plugin modules are bundled together while the existing shell renderer remains
shared. No prompts, native sessions, hosted service or MISHU hook was added.

Red tests reproduced and then passed for permanent pause after network failure,
hung requests, missing scheduler/wake recovery, legacy protocol admission,
missing migration receipts/backup, duplicate completion resurrection, loss of a
concurrent opt-in during first state read, and missing generic uncertain replay, and a lost commit blocking explicit replay
until its lease elapsed, and missing uncertainty receipts for interrupted
historical replay.
The earlier MVP tests were adapted through a test-side v2 client that performs
real reserve/commit operations; no legacy translation exists in production.
Browser controller tests now use the real policy instead of a mock claim ledger.

## Test audit: user-visible claims

Read these as business rules. Is any of them wrong? This is an audit checkpoint,
not a permission gate; the accepted specification remains authoritative.

| Claim | Rule protected | Public evidence |
| --- | --- | --- |
| C1 | 网络暂时失败后可自行恢复，不要求重新授权语音 | recovery-browser, recovery-http |
| C2 | 每个请求十秒内释放，包括队列、许可、回执和摘要读取；迟到响应不覆盖新状态 | recovery-browser |
| C3 | 页面唤醒会合并恢复动作，尊重服务器等待时间，登录失败不会紧密重试 | recovery-browser, bootstrap |
| C4 | 20 分钟离线结果仍保留，24 小时边界内可播，超时或未来时间不可播 | recovery-retention, recovery-state |
| C5 | 预约丢响应可以恢复；许可丢响应需要手动重播；回执丢响应不会再播放一次 | recovery-http |
| C6 | 两个页面只能取得一个自动播放许可，旧页面、错误令牌和旧所有权均失效 | recovery-state, http, delivery |
| C7 | 切换账号取消请求与声音，旧账号迟到数据不会展示或发送到新账号 | recovery-browser, http |
| C8 | 关闭、取消选择、归档、删除或被新结果取代的待播内容不会复活 | recovery-state, delivery |
| C9 | 最多十项待播、一次播放；保留最新十项并按完成时间播放；溢出决定持久化 | recovery-state, delivery |
| C10 | 摘要展示缓存淘汰不会删除仍应播报的内容；诊断记录有数量与时间上限 | recovery-state, projection |
| C11 | 重启保留未消费内容，已消费旧记录保守迁移；写盘失败不会先发播放许可 | recovery-http, recovery-state |
| C12 | 前台阅读不阻止声音，听到声音不代替已读；重播不触发模型 | foreground, settings, browser probe |
| C13 | 缺失摘要使用诚实提示，提问不播为完成；原生提示词与完整结果不变 | plugin, provenance, native, browser probe |
| C14 | 组件首次加载失败可恢复；聊天连接关闭时播报仍可恢复，无需刷新 | bootstrap, extended browser probe |
| C16 | 当前页面丢失许可响应后可确认“不确定”，随即可手动重播 | recovery-http |
| C17 | 历史摘要的手动重播被超时、重启、接管或关闭中断时保留不确定回执，且不消费较新的结果 | recovery-state |
| C15 | 重复完成事件不重复入队，首次读取时发生的设置更新不会丢失 | recovery-state |

Every modified test retains a public claim: HTTP tests enforce scoped settings,
completion identity, rename and restart; policy tests enforce queue/capture rules;
projection/provenance tests preserve authenticated message binding; Browser/settings
tests enforce permissions, cancellation, replay, voice choice and disposal. Existing
native provider tests use only a local synthetic endpoint. No real model was called.

## Acceptance coverage

| Acceptance group | Stories | Evidence |
| --- | --- | --- |
| 1, independent chat transport | 1, 12, 13 | Complete Chromium probe holds chat socket closed while HTTP recovers |
| 2–4, deadlines/retry/wake | 3–7, 21, 34 | Controller and complete UI fault tests, all operation deadlines and overlapping wakes |
| 5, retention | 2, 8 | 20-minute, exact 24-hour and +1ms public policy cases |
| 6–7, crash windows/restart | 14–18 | Actual Host HTTP lost reserve/commit/finish responses and fresh Host instances |
| 8, contention/scope | 19, 20, 22, 33 | Real two-account HTTP, controller scope changes, browser contexts, ownership/token/page fences |
| 9, read independence | 12, 13 | Public completion-read HTTP plus foreground/background Chromium journeys |
| 10, lifecycle | 9, 24–27 | Disable/deselect/archive/delete/supersede cases, deferred running result and durable skip |
| 11, bounded queue/cache | 9–11, 34, 36, 39 | 115 completions, retained ten, capped receipts, cache eviction and restart |
| 12, replay/fallback | 15, 28–30 | Real policy replay and UI generic uncertain-result replay, no native calls |
| 13, login | 22, 23, 31, 33 | 401 retry suspension, account fencing and existing fake-OAuth browser scope |
| 14, migration/protocol | 17, 18, 35 | Private migration backup/mode, consumed state, HTTP 426; rollback off procedure |
| 15, unchanged work/prefix | 31, 32, 37–40 | Existing draft/download/model/native suites; latest-title delivery and fixed profile equality |
| 16, optional bootstrap | 41 | First module fetch aborted in Chromium; controls mounted once without reload |

Actual audible output, user activation after OS suspension, and provider cached-input
metrics remain manual gates under #157. Synthetic authentication tests do not
revoke production credentials. A documented rollback-off procedure is not a claim
that a production rollback was executed.

## Mutation probe

Ten representative business-rule sites were mutated serially with source restored
in `finally` after every run. Initial survivors exposed four missing protections
in the tests; targeted public regressions were added and the same mutants rerun.
All ten final mutants are killed. This is a bounded probe, not exhaustive proof.

| Mutation | Final protecting claim |
| --- | --- |
| Expire at exactly 24 hours instead of after it | C4 |
| Keep a reservation at exactly 30 seconds | C6 |
| Grant commit without validating token/current state | C6 |
| Remove duplicate-settlement guard | C15 |
| Let a foreign page acknowledge playback | C6 |
| Admit a result settling while master-off | C8 |
| Admit a future completion timestamp | C4 |
| Extend request deadline to 20 seconds | C2 |
| Pause audio after a transport error | C1 |
| Apply a delayed old-account status | C7 |

No mock of the production policy remains in the load-bearing Browser claim tests.
The v2 test client is only an operation composer; actual policy/Host decides grants.
Exact empty-queue assertions allow diagnostic metadata without weakening the
empty-items assertion. No approval, model invocation or user decision is inferred
from timers.

## Serial source and security review

Standards: native adapters are unchanged; delivery policy stays in the independent
package, authenticated storage stays in Host, and the shell only mounts effects.
Version metadata is synchronized. Source/profile provenance is preserved.
Known lifecycle races found during review were returned to red/green tests.

Security: the existing Web authentication/Origin path and Host token/user-slot
admission remain ahead of the changed endpoint. Client-supplied scope/destination
fields are rejected. Task admission, current completion, browser/page/epoch and
operation identities are checked before permission. Error responses do not expose
storage paths; all displayed values use textContent. State and backup files are
private and atomically replaced. No credentials, user transcripts, global account
fallback or new dependency was added. No blocking security finding remains.

## Verification and release boundary

Targeted speech suites and the complete Chromium speech probe were run locally;
the extended journey records 17 criteria and zero uncaught page errors. Review
receipts and the canonical release check must bind the exact published source SHA.
The repository-wide check includes all existing navigation, draft, attachment,
model, connection, native integration and scoped lifecycle regressions. Its final
result belongs to the verification receipt and #159 publication comment.

Activate matching Browser/Host artifacts together. Rolling back to a pre-protocol-2
runtime requires `PI_COFFEE_COMPLETION_SPEECH=off` before activation. Preserve the
newer ledger and native history; never restore the private v1 backup over newer
attempts. Production is unchanged by these source tests.
