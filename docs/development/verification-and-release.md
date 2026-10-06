# Verification, publication and release tools

Current contract: [Server #81](https://github.com/awangs1986/pi-coffee-server/issues/81).
[REPOSITORIES.md](../../REPOSITORIES.md) selects source ownership. Source publication,
Browser activation and backend activation are separate outcomes.

## Verification workflow

1. Run the affected public-seam tests. Sidebar and tooling shortcuts are in
   `package.json`; use the navigation matrix below rather than guessing filenames.
2. Review the complete diff, including source/spec consistency and security where
   relevant. Resolve findings before the final broad check.
3. Record the successful review, then run the final repository plan:

   ```bash
   node scripts/review-receipt.mjs --verdict passed --evidence /private/review.md
   npm run check:release
   ```

   The review command records an explicit verdict and evidence hash. It does not
   conduct a review. The final gate checks the reviewed source fingerprint and binds its result to the
   exact review receipt. A check performed before that review cannot authorize publication.
4. Publish the checked commit, then independently verify a fresh clone of that
   exact published SHA. Keep the existing fresh-clone acceptance requirement.
5. Stage the verified release and activate only its compatible Browser assets.
   Host/Web service replacement remains an explicit maintenance operation.

`npm run check` runs mechanical JS lint, the production build, Vitest, then four
no-model Chromium probes: model display, completion icons, recent sidebar activity
and busy scrolling. A failed command stops later commands. Install the pinned
Playwright browser with `npx playwright install chromium`, or set
`BROWSER_EXECUTABLE` to the matching installed browser.

`npm run verify -- --reuse` runs the same plan and writes a private receipt under
`.coffee-verification/`. Reuse requires unchanged source content, plan, Node
version, successful steps, compiled artifact hashes and dependency closure hashes
(including executable modes and internal relative symlinks). Changes invalidate it.
Receipts contain hashes and command labels, not environment values or command
arguments. Verification plans are trusted local executable configuration; never
accept a plan uploaded by a Web user. Alternative targeted plans use
`node scripts/verify.mjs --plan /private/targeted.json --receipt /private/targeted-receipt.json`.
A targeted receipt does not replace the canonical final publication plan.

Fresh-clone verification:

```bash
npm run verify:fresh -- --commit <published-40-character-SHA>
```

The helper clones the exact public GitHub commit into private disk-backed storage,
runs `npm ci` and the canonical plan, emits a receipt and removes only its own
clone. Supply `--stage-config /private/browser-release.json` to stage its checked
artifacts before cleanup; `--role host` or `--role web` stages a backend candidate
without activating it. It does not use VM-wide Git credentials or native provider accounts. Local
fixture mode exists only for isolated test forges. Never use fixture mode for a
network destination or a production release claim.

## Automatic guardrails

Install the checkout-local hook with `npm run hooks:install`. The pre-push hook
runs verification, reusing only a valid receipt. No global Git config is changed.
The publication CLI additionally requires current verification and review receipts;
API publication must use the same final evidence and expected-ref lease.

`.github/workflows/check.yml` runs on main pushes and same-repository PRs, with
read-only workflow permissions and credentials removed from checkout. It requires
a disposable LAN runner labelled `pi-coffee-ci` because the lockfile contains
immutable Gitea artifact URLs. A GitHub-hosted runner cannot resolve that private
LAN hostname. Use a dedicated CI environment with Node 22.19+, Chromium system
libraries and no production task directories, provider profiles or account stores.
Fork PRs need maintainer review before execution on that runner. Runner registration
and GitHub's required-check branch protection are operator configuration; a YAML
file alone does not register a runner or protect main. Check the repository's
Actions page for an actual successful job before claiming CI activation.

The current Web OAuth scope is `repo read:user`. Editing GitHub workflow files may
require a separately authorized `workflow` scope for the selected account. This
change does not expand every Web user's OAuth scope or restore VM-wide gh login.

## Account-scoped batch publication

Commit all source first. Use the selected Coffee account store; credentials remain
outside the repository. The helper uses one native Git pack, preserving UTF-8 names,
Unicode text and binary bytes without serializing each file into tool-call JSON.

```bash
node scripts/publish.mjs --repo . --remote origin --branch main \
  --expected <fetched-main-SHA> \
  --accounts-root /private/current-user/github-accounts \
  --account <connected-account-id> \
  --verification .coffee-verification/receipt.json \
  --review .coffee-verification/review.json
```

The selected account must exist; missing/revoked authorization never falls back to
another account, global gh login, .netrc, SSH agent or global credential helpers.
GitHub requires an HTTPS remote, with legacy local headers/credential overrides
and URL rewrites rejected. Source, review, artifacts, Node version and the canonical plan must
match; the final verification must name that exact accepted review. The expected remote SHA is checked before a push and enforced by a native
lease. The apparent `--force-with-lease` Git flag is used only after proving the
expected commit is an ancestor of the checked HEAD; non-fast-forward history is
never admitted. Source identity and the remote SHA are verified again. An ambiguous
network result requires inspecting the remote; do not blindly replay publication.
Mirror the identical GitHub commit to Gitea using the configured scoped forge
transport, preserving normal ancestry. Global gh authentication remains disabled.

## Staging and Browser activation

Store per-machine configuration outside source:

```json
{
  "releaseRoot": "/opt/pi-coffee-browser-releases",
  "activePublic": "/opt/current-server-release/dist/public",
  "stateDir": "/var/lib/pi-coffee/browser-rollouts",
  "healthUrl": "http://127.0.0.1:3000/healthz",
  "assetBaseUrl": "http://127.0.0.1:3000/",
  "backendCommit": "unknown",
  "hostCommit": "unknown",
  "unit": "pi-coffee-web.service",
  "expectedAssets": {"app.js": "<current-64-character-SHA256>"}
}
```

Supply verified backend/Host identities where available; unknown stays unknown.
Observe baseline hashes immediately before activation. A changed baseline refuses
an overwrite. Paths are per-machine operator configuration, never browser input.

```bash
node scripts/release.mjs stage --source /path/to/fresh-checked-clone \
  --commit <published-SHA> --verification /private/fresh-receipt.json \
  --config /private/browser-release.json
node scripts/release.mjs status --config /private/browser-release.json
node scripts/release.mjs activate-browser --commit <published-SHA> \
  --config /private/browser-release.json
```

Staging is immutable and does not change active files. It validates source and
post-check artifact hashes and the canonical plan/Node version. Browser activation
locks before its initial baseline and health probes, rechecks the baseline immediately
before replacement, backs up replaced files, publishes dependencies before entrypoints,
checks HTTP-served byte hashes and verifies unchanged service identity. A failed
probe restores backed-up entry assets. Backups and operation evidence are retained;
new inert support files are retained rather than deleting user/older assets.
No command restarts a service. `status` separates active and staged identities.

`stage --role host` or `--role web` also copies the checked runtime/dependencies
into an immutable candidate. Dependency bytes, executable modes and contained
relative symlink targets are checked before and after copying; existing candidates
are also checked for mutation. Service activation is deliberately separate: inspect
all task/queue/workspace activity, obtain the approved maintenance window, pause
the watchdog and follow [the unified runbook](../deployment/unified-release.md).
Do not mistake a staged candidate or a healthy old process for a deployed backend.

`GET /api/release` reports only whitelisted frontend/Web/Host commit identities
through the existing authenticated forwarding path. `release-manifest.json` is
public commit metadata; credentials and filesystem paths are never included.
Legacy releases without recorded identity report `unknown`. These HTTP changes
require the new backend; a compatible Browser-only rollout cannot activate them.
