# Standalone Harness deployment — 2026-09-29

Tracking: [Server #29](http://gitea:3000/awangs/pi-coffee-server/issues/29).

## Runtime identities and scope

- Harness: `awangs1986/pi-coffee-harness@ffd23ea5dafcf809af8703a7a0c5fbfee5baf37f`.
- Host and Web runtime: Server `9734ce86e115d684680b258659ac4f909b2c4942` (unchanged).
- Existing aggregate Pi dependency: `1ec49a93048f0e441806cd17da7b245972e5f51a` (unchanged).
- Pi: `0.87.1`; Node on Host: `22.23.2`.
- Web entrypoint: `http://webserver:3000/`, Web release directory
  `/opt/pi-coffee-server-releases/9734ce8`.
- Gitea owner awangs routes to the local Host at `192.168.100.123:8790`.
  The other user's linux002 route was not changed or certified by this rollout.

The plugin executes on Host, not on the Web gateway. The existing
`PI_COFFEE_EXTENSIONS` configuration seam replaces exactly one old Harness entry
with the new package's manifest extension entry. All five other configured entries
remain in their prior order. No installed package factory, global Pi setting, model,
credential, workspace or native Codex/Claude adapter was replaced.

This is a Harness-only rollout. P5's general native package-discovery migration
remains separate; this deployment does not claim the entire toolchain is converted
to standalone plugins. The old subagent lifecycle bridge remains installed.

## Installation and rollback

The clean, pinned source checkout is
`/home/awang/share/pi-coffee-harness-releases/ffd23ea`.
It passed `npm ci && npm run check` before use. Source and release checkouts are
separate, so later edits to the local development repository cannot change the
running plugin.

`pi-coffee-workbench-host.service` adds the drop-in:
`/home/awang/.config/systemd/user/pi-coffee-workbench-host.service.d/95-harness-ffd23ea.conf`.
It sets the complete ordered extension list and the non-secret
`PI_COFFEE_HARNESS_REVISION` marker. The previous and next lists are retained in
`/home/awang/.config/pi-coffee-workbench/releases/harness-ffd23ea.json`.
The original host.env is unchanged.

Rollback: when no task or child is active, move this one drop-in out of the service
configuration directory, reload user systemd and restart the Host. This restores
the unchanged aggregate Harness and its previous extension list. Keep the plugin
release, task data and rollback record. Do not enable a second Harness globally.

## Verification

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Fresh Harness checkout | PASS | 49 runtime tests plus 2 package/native-install tests |
| Unchanged Server baseline | PASS | 32 files / 239 tests on fresh Server checkout |
| Web → Host → actual Pi with new Harness | PASS | Scripted provider sees new stale-read guidance; Git, search_tools and web_search each registered once; reply and reconnect history retained |
| Deployed configuration | PASS | Process environment identifies ffd23ea and exactly one Harness; five other entries unchanged |
| Health and assets | PASS | Host/Web health endpoints succeed; five workbench control groups and all six served assets match unchanged Web release |
| Actual browser Chat command | PASS | /harness returns Chat, no system prompt and the five expected tools; page reconnect and refresh restore the task |
| Consecutive extension slash commands | FAIL, pre-existing | Successful /harness leaves Host admission busy; subsequent /work rejected; both old/new Harness reproduce identically in isolated Web/Host/Pi probes; Server #30 |
| Deployment cleanup | PASS | No model run active before Host restarts; synthetic test task archived with its directory retained; zero automatic restarts and no extension-load/duplicate-tool failures |

Evidence files are in the operator's private temporary directory
`/home/awang/tmp/verify-harness-20260929-ffd23ea/`. They contain local synthetic
probe logs, sanitized deployment identities and browser AX excerpts. No screenshot
is claimed: the in-app browser did not support its content-export operation.

The deployment made no live production-provider request. The Web/Host model path
was verified with deterministic local responses. This is not a model-quality,
autonomous-tool-choice, linux002, or complete P5 certification.

## Existing Host command limitation

[Server #30](http://gitea:3000/awangs/pi-coffee-server/issues/30) tracks missing
settlement after successful extension commands that do not start a model turn.
Native Pi is idle while Host still rejects another prompt as busy; aborting idle
Pi does not clear that admission state. A Host restart clears it. The failing
comparison predates this standalone Harness, so no unrelated adapter patch was
bundled into this rollout. Normal model replies and reconnect history pass the
integration probe. Avoid using repeated extension slash commands as a production
workflow until the separate lifecycle fix is delivered.
