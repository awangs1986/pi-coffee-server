> Source placement update: [ADR-0021](../adr/0021-pi-only-source-authority.md). Host and Web still use one Server release. Its lockfile pins a separate Pi package commit; record that dependency identity alongside the Server release.

# Unified release procedure

1. Fetch GitHub and Gitea and read the reconciliation matrix. Build from the authoritative GitHub main commit, keeping both histories and previous release directories.
2. Run `npm ci && npm run check`. In minimal environments, ensure child login shells also have the Node binary directory in PATH.
3. Start Web with `node dist/src/main.js web` (the compatible `dist/src/web/main.js` entrypoint also accepts existing route-file deployments). Start Host with `node dist/src/main.js host`. Host and Web use the same Git revision even when installed on different machines.
4. Preserve private environment files, routes and task directories. Configure `PI_COFFEE_CODEX_COMMAND` and `PI_COFFEE_CLAUDE_COMMAND` to the installed native CLI or existing private wrapper. `PI_COFFEE_CODEX_BIN` remains compatible. Codex model/effort overrides are `PI_COFFEE_CODEX_MODEL` and `PI_COFFEE_CODEX_EFFORT`; native login remains on Host.
5. Existing dedicated Host routes remain valid. Shared routing uses `PI_COFFEE_SHARED_HOST=1` on Web and `PI_COFFEE_REQUIRE_USER=1` on Host. Route-file authentication derives stable `gitea-<id>` ownership keys and forwards them on HTTP and WS. Earlier signed-cookie deployments preserve their existing login-name keys. Do not switch identity-key formats without an explicit data migration.
6. `PI_COFFEE_SKILL_OWNER` names the authenticated owner key allowed to manage machine-wide Skills. Project Skills remain task scoped. Do not copy native login credentials to Web.
7. Web and Host support explicit project/chat/session root settings. Existing tasks are retained in place. Native terminal conversations from the configured user cwd remain discoverable; their histories do not become Gitea checkouts automatically.
8. Probe health, login, the three Work engines, Pi-only Chat, brand menu, search, Context Usage, task path expansion, branch review and native turn review. Test sidebar collapse and refresh. Use `node scripts/probe-workbench-release.mjs <Web URL> <release directory>` to compare served assets with the release.
9. Push GitHub main, then Gitea main. Verify identical SHAs after fetching both. Install a release directory named by that SHA and record service paths plus the asset probe in the Issue. Retain the previous release and data for rollback.

Signed-cookie authentication requires a new login after Web restart, even with a configured signing secret. This keeps logout revocation effective across restarts; task execution and native sessions continue on Host. Route-file authentication retains its existing session-store behavior.

A successful native model response alone is insufficient release evidence.
