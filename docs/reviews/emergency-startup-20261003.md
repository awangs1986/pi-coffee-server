# Optional-plugin startup recovery

Base: GitHub/Gitea main `7f32ee245d176757b3578d6190f09692abba60de`.
Scope: keep Web and Host reachable when optional Pi plugins are missing or broken,
and retain native Codex availability without changing an existing task's engine.

## Incident and diagnosis

The Web systemd journal recorded `ERR_MODULE_NOT_FOUND: Cannot find package
'pi-coffee-lsp' imported from .../dist/src/main.js`. The entrypoint imported LSP
before deciding whether it was starting Web or Host. HostServer also imported
LSP eagerly, and the Pi adapter imported the optional handoff protocol eagerly.
The deployment subsequently recovered; production release `7f32ee2` passed its
Web/Host health and served-asset probes. That recovery does not contain this fix.

The production-entrypoint fault tests reproduced the same missing-module failure.
A separate real Pi extension fault exposed a second boundary issue:
`RpcClient.start()` waits only 100 ms, so it can return before plugin loading
fails. Awaiting `get_state` keeps that failure inside startup, before a prompt
can be accepted. Concurrent command/model discovery also needs each caller's
single retry even if a sibling has already changed the shared runtime mode.

## Implemented behavior

- Web/Relay do not resolve or import the optional Pi packages at startup.
- Missing resources or explicit `PI_COFFEE_EMERGENCY=1` enable minimal Pi loading.
- Native extension-load diagnostics permit one startup retry; no prompt replay,
  engine substitution, model substitution, or persistent account/config changes.
- Native tools and history remain available; approved provider registration is
  retained when available. Codex/Claude keep their native configuration.
- Health and authenticated runtime APIs expose bounded mode/reason values. A
  persistent Chinese Web banner explains degradation and restart-based recovery.
- Destructive LSP cleanup still requires the daemon helper to load successfully.

## Acceptance evidence

| Criterion | Result | Evidence |
| --- | --- | --- |
| Web boots with LSP/handoff absent | PASS | Built-entrypoint fault injection in `test/startup-emergency.test.ts` |
| Host boots with LSP/handoff/Harness absent | PASS | Same tests: health, authenticated engine API, anonymous 401 |
| Codex remains discoverable while Pi is degraded | PASS | Native protocol fixture supplies its model catalog through Host WS in each missing-package case |
| Broken Pi plugin recovers before prompt admission | PASS | `test/pi-emergency.test.ts`: real Pi, real Web/Host, one HTTP model request to local fixture |
| Tools, history, environment guidance and model restriction remain | PASS | Native tool schema, one durable session, required instruction, rejected disallowed model |
| Concurrent command/model discovery both recover | PASS | Regression first returned fulfilled/rejected; now both fulfill with bounded retries |
| Auth/network failures do not trigger plugin fallback | PASS | Recovery classification regression |
| Browser displays and retains emergency warning after refresh | PASS | Headless Chromium against built `main.js all`; runtime response, screenshot and zero page errors |
| Full build/check | PASS | 90 test files, 736 tests |
| Targeted security review | PASS | Independent read-only review: route authentication/user scope, credentials, input/output and dependencies; no findings |

The first full check had one local bare-clone fixture blocked by the current
session's Git wrapper. The complete check passed with the standard system Git
first on the test-only PATH; production credential settings were unchanged.
Browser verification initially lacked a fixture Host token and correctly got
401. Supplying the fixture token allowed the intended authenticated path to pass.

Local evidence is under `/home/awang/tmp/coffee-deploy-20261003/`:
`emergency-check-final.log`, `emergency-concurrent-red.log`,
`verify-emergency/evidence.json`, and `verify-emergency/emergency.png`.
Provider tests use synthetic local responses, not paid model-provider turns.

## Publication status

This is a local implementation, not a production release. The current account's
scoped GitHub account list is empty and its Git helper rejects remote operations.
GitHub publication, the identical Gitea mirror, Issue evidence and a new release
deployment remain pending account connection/selection. No shared machine GitHub
credentials were used to bypass that boundary. Production remains on `7f32ee2`.
