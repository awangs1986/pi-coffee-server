# Single-VM templates

Install as user services with user lingering enabled. Web and Host retain separate
units and native process ownership. `pi-coffee-web.service` uses the unified Web
entrypoint; `current` selects one verified immutable release. Never replace that
symlink or an active release while staging a candidate.

Private Web environment needs WEB_BIND/WEB_PORT, GITEA_URL/GITEA_CLIENT_ID/
GITEA_CLIENT_SECRET, PUBLIC_URL, ROUTES_FILE, SHARED_HOST, GITHUB_CLIENT_ID/
GITHUB_CLIENT_SECRET and RESTART_STATE_DIR/RESTART_OPERATORS, all prefixed with
`PI_COFFEE_`. Preserve route numeric IDs, tokens and legacyDefault exactly.

Host uses `PI_COFFEE_GITHUB_REFRESH_URL=http://127.0.0.1:3000/internal/github-refresh`
when Web runs locally. Public OAuth callbacks still use PUBLIC_URL. Preserve
existing Host LAN bind/file-transfer reachability and account data mappings.
Use the pinned native command path, not an ambient global `codex` executable.

Reuse the watchdog and restart worker templates, changing both targets to user
systemd units. Their workers must be independent of Web/Host cgroups. Keep state,
receipts, credentials and route files outside release directories and task roots.

Preflight must check both directions: Browser/Web -> Host and authenticated
Host -> Web renewal. A valid Host bearer with an empty POST body should get 400
from `/internal/github-refresh`; 401 means grant/scope mismatch and 503 can mean
missing OAuth configuration. This probe must never carry a real refresh token.

Migration uses scripts/migrate-web.py: fence the old Web and its watchdog/restart
triggers before activation. Preserve backups and source/target status evidence.
See docs/deployment/same-vm-migration.md, state-backup.md and unified-release.md.
