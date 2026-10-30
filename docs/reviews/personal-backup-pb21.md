# Personal backup PB-2.1 candidate

2026-10-30; integration branch `feat/backup-personal-pb21`, formal version 0.58.
Source authority base: GitHub/Gitea `d58ac4e814e34167157c57ae76f3b7461042f025`.
Old backup candidate `d1b4816` was merged normally; its historical review evidence
remains in `backup-ordinary-*.md`. This review additionally covers personal
changes after `3180ed6`, conflict composition, and current-main integration.

No production backup/key generation, restore, deployment or restart occurred.
All data/account credentials used here are synthetic. No provider prompt was sent.
Review and implementation ran serially without additional model Agents.

## Verification map

Evidence directory in the task workspace: `artifacts/backup-pb21-tickets/`.
Final exact-source canonical and GitHub fresh-clone receipts are delivery gates,
recorded in the PR/#150 with their actual command results, not inferred from this
source report. `docs/agents/feedback-loops.md` is absent; package scripts are used.
No separate `test-cases.md` exists for PB-2.1.

| PB criterion | Observed behavior / evidence |
| --- | --- |
| 01 | Actual personal Host startup, one-confirmation Web/CLI; `144-startup-green.log`, `144-cli-green.log`, personal HTTP/UI tests |
| 02 | Existing real Restic baseline/delta/readback tests retained; service archives use that same repository/key/engine; final canonical execution required |
| 03 | Scheduler civil-time/restart/attempt tests retained; `148-independent-retry.log` verifies independent failure and maximum three attempts without replaying native success |
| 04 | `144-cycle3.log`, `145-final-focused.log`; physical writer lifecycle stays active, real normal Pi/Codex storage; arbitrary custom external Pi resource graphs are not qualified |
| 05 | `147-http-green.log`, `147-shared-green.log`, real two-account Pi/Codex joint-loss test |
| 06 | Existing task/native/registry crash tests plus `147-commit-reconcile-green2.log`; parent reconciles child completion after lost reply; Gitea start-after-publication retry in `148-start-resume-green.log` |
| 07 | Existing repository corruption/target tests; `144-preflight-green.log`; service archive tamper, wrong key/repository ID and mapping mismatch refusal |
| 08 | `146-retention-green.log`, retention policy/active pin/crash tests; actual Gitea point restored after daily retention |
| 09 | `149-offline-final.log`, `150-package-validation.log`: all local runtime data removed, only package/key/disk used; no old login credential required |
| 10 | Actual Web/Host endpoints and local CLI; no HTTP claim when Host is down; material extraction precedes service startup |
| 11 | Native archive/package schema preserved, service tags separate, old entry points retained; unknown offline snapshots kept by retention |
| 12 | Current Pi 1.4 package integration retained; final canonical/fresh-clone results belong to the exact published SHA receipt |
| 13 | `148-green2.log`, `150-package-validation.log`: actual Gitea 1.27.3/SQLite3, repository, OAuth, numeric identity and scope preserved; old Coffee session rejected after Web restart |
| 14 | `149-emergency-first.log`, `150-package-validation.log`: Gitea + login + native stores + account roots + local backup runtime all removed; both accounts' attachments/history/IDs returned |
| 15 | `144-credentials-green.log`, `145-final-focused.log`: missing credentials restored and existing settings preserved; actual Codex read/resume, Pi native history loading; **provider new turn unverified** |

Production backend/storage inventory, actual external credentials, physical disk
and production timer/service installation are unverified operational boundaries.
SQLite/local is the implemented Gitea compatibility scope; unsupported backends
fail rather than silently being omitted. This is not a production activation
receipt or evidence that arbitrary custom Pi packages/resources are supported.

## Test audit: claims

These are the business rules enforced by the personal tests (the two Codex
configuration cases share rule 8):

1. 单账号恢复只找回缺失任务，保留恢复点之后新建的健康任务。
2. 网页账号恢复只需一次确认，不增加独立审批按钮。
3. 全部纳管账号可通过一个集合预览与一次确认恢复。
4. 网页分别显示 Gitea 失败、恢复点和服务恢复确认。
5. 每日成功部分不因另一部分失败重复备份；失败最多两次重试，保留自动进行。
6. 个人 Host 可正常启动，无独立 broker 或角色登记要求。
7. 实际 Host 能完成 Pi 采集、加密、删除后恢复，原生权限不变。
8. Codex 配置/凭据缺失可恢复，原生 ID/历史保留，现存配置不回退。
9. 两账号共享 Codex 数据库全丢失时，第二账号可以在首账号已恢复后接续。
10. 集合恢复跨账号同名任务不混淆；刷新计划或账号完成回复丢失后可接续，并保留后来写入。
11. Pi 缺失凭据恢复，现有模型配置保留，普通状态不泄露凭据。
12. 仅凭离线密钥、盘和独立 CLI，可从 Gitea/配置/聊天/runtime 共同丢失中恢复两账号 Pi/Codex、附件和登录。
13. Gitea 真实备份/保留/恢复后账号与 OAuth 可用；启动命令回复失败后重试不重写服务的新数据。
14. HTTP/CLI 单任务恢复拒绝非管理员、过期摘要，重复确认不重复创建。
15. 不兼容恢复暂存文件系统在确认前给出错误。
16. 网页单任务恢复采用预览与一次确认。
17. 服务归档使用同一管理员密钥加密，篡改材料不能通过校验。
18. 原本地运行资料全丢失后，可只列元数据、选择验证快照并重建目录；错误密钥/仓库 ID 被拒绝。

Read these as business rules. Is any of them wrong?

Coverage maps rules 1–18 to PB-AC-01–15 in the table above. Existing policy,
HTTP/WS isolation, resource/corruption and crash cases supplement these personal
rules. UI tests mock only the HTTP transport; actual Host/Web/Chromium/Restic/
Gitea/native CLI are exercised in separate integration cases. The mutation probe
is deliberately bounded to four high-value rules (30-day retention, preserving
current configuration, offline repository identity, child-completion recovery),
with original file bytes restored after each run. All four mutants were killed by behavior assertions; original file hashes were
restored. Actual results are in `mutations.json` and `mutant-*.log`; this is a
probe, not exhaustive proof.

## Review and repairs

Standards: retained Web authentication/forwarding and Host-owned durable data;
Pi/Codex differences remain behind native adapters. Personal mode reuses the
existing repository, retention and restore implementation. Legacy startup paths
remain available for existing users, but personal operation does not require them.
The independent recovery package has no npm install step at recovery time.

Spec: found and repaired service state aggregation/independent retries, shared
service journal ownership, service startup response loss after publication, and
account completion response loss before the collection journal. Old/new failures
are retained in the evidence directory. The canonical run also exposed a reused
cold Pi audit still pinned to SDK 1.1.0 after the mainline upgrade: the reader,
observation validator and recorded SDK version now qualify 1.1.0/1.4.0 explicitly.
The unchanged cold-source HTTP regression goes from unavailable to protected
(`150-cold-pi-red.log` / `150-cold-pi-green.log`); the JSONL-v3 checkpoint format
identifier remains compatible with existing archives. Directory witnesses also
record creation time so immediate inode reuse cannot hide replacement. The old
Codex composition fixture now places staging and target under the same configured
temporary root; the explicit incompatible-filesystem regression remains intact.
The remaining five selected regressions passed (`150-remaining-compatibility.log`). Old provider-authentication comments were
updated where the personal opt-in changes behavior. Normative requirements remain
in the spec; deployment-only or external-resource limits are explicit.

Security: new service/collection actions require the authenticated owner on Host;
ordinary account state is scoped. Latest focused run: four integration files,
four tests passed (`150-final-focused.log`), including real Gitea repository and
issue-attachment bytes read after recovery. Browser inputs cannot specify service commands
or private profiles. Recovery packages enter via private files for local CLI use;
keys/provider credentials do not enter public status. Gitea recovery compares the
sealed numeric ID/scope/directory mapping and checked target identities. No new
npm dependency was introduced by the personal changes. This is the targeted
five-category review, not an adversarial owner/root-isolation claim.

The final source review receipt is recorded only after focused repairs and their
checks pass; the canonical publication gate follows it. Production deployment
requires its own authorization and actual environment qualification.
