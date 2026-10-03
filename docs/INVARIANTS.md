# Invariants

Short, numbered rules that tests cite by id. A change that breaks one of these
is a design change and needs an ADR, not a patch. (Format borrowed from
termdeck's `INVARIANTS.md`; the rules are ours.)

## Transfer / file access (Host `TransferServer`)

| Id | Rule | Enforced by |
|---|---|---|
| INV-T1 | A download `fileId` resolves lexically under the scope's root; `..` and absolute paths are refused (403). | `transfer.ts` `download()`; `test/transfer-server.test.ts` |
| INV-T2 | After resolving symlinks, the file's real path is still under the root's real path. A symlink inside the working directory that points outside it does not escape. | `withinRealRoot()`; same test (P4 case) |
| INV-T3 | Credential-shaped names are never served or listed, wherever they sit inside the root: `auth.json`, `.credentials.json`, `.netrc`, `.env*`, `id_*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `credentials(.json)`, `known_hosts`. Downloads check both the requested name and the resolved target name, so symlink aliases do not bypass the rule. Defence in depth for a misconfigured root. | `isCredentialFileName()`; same test |
| INV-T4 | A transfer scope is `sha256([user, sessionId])` and bound to that user's root on first use; there is no anonymous or shared scope. | `server.ts` `open()`, `transfer.ts` `issueToken()`; `test/host-server.test.ts` |

## Sessions (Host `HostSession` / registry)

| Id | Rule | Enforced by |
|---|---|---|
| INV-S1 | A browser disconnect never stops a running turn; the Session outlives its sockets (ADR-0006). | `test/host-server.test.ts` "keeps a Pi session alive…" |
| INV-S2 | Native Transcript remains authoritative. The Host may keep a transactional, rebuildable user-scoped display index; v2 reads never resume native execution, and legacy open remains available (ADR-0024, amending ADR-0008). | `test/conversation-index.test.ts`, `test/conversation-sync-http.test.ts`, `test/native-history-read.test.ts` |
| INV-S3 | `sessions[].attention` is derived state only (pending dialog / unseen settle) and clears on attach; it is never persisted. | `HostSession.attention`; P0 test |
| INV-S4 | A native thread is resumed or deleted only when its recorded `cwd` is this user's working directory (ownership check before `thread/resume` / `thread/delete`). | `CodexSessionFactory.ownsThread()`; `test/codex-adapter.test.ts` |

## Identity

| Id | Rule | Enforced by |
|---|---|---|
| INV-I1 | Gitea is the only identity system (ADR-0004); the Host receives a validated login name in `x-pi-coffee-user`, never a token. | `web/auth.ts`, `host/server.ts` upgrade check |
| INV-I2 | With `PI_COFFEE_REQUIRE_USER`, an identity-less Host connection is refused at the upgrade. | `test/host-server.test.ts` |
