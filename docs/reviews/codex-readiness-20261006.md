# Codex local readiness correction — 2026-10-06

Tracking: [Server #82](https://github.com/awangs1986/pi-coffee-server/issues/82).
Source baseline: `79637cc8e00549c305c08363088bbf68786c5e7e`.
The tested production Host/Web remain on `5073c97`; no service was restarted.

## Diagnosis

The Host converts any Codex authentication-probe exception to
`Native authentication status unavailable; inspect this CLI on the User VM`.
That probe uses a five-second `account/read` deadline. Its result gates native
conversation opening. Model discovery itself does not emit this exact error.

An isolated read-only reproduction used the deployed Codex 0.159.1 command and
Host environment. Two simultaneous readiness probes reproduced initialization
completing in 130 ms and `account/read` exceeding its five-second deadline.
One of eight probes failed; the other seven returned configured credentials.
No task/thread or model turn was created.

A sequential comparison used the same native configuration: five `login status`
calls reported configured login in 66–71 ms. Model lists returned in 1–2 ms while
account reads took 656–969 ms. The underlying source of account-read latency
(network versus internal native work) is not established; concurrent contention
is also not proven. The reproduced defect is treating slow account metadata as
unavailable local authentication. There is no browser request trace correlating
the two reported incidents with this probe, so this is a matching reproduction,
not a timestamp-correlated production incident record.

## Change and verification

Codex native `login status` exit 0 now establishes local configured readiness.
Exit 1 retains `account/read` for providers that need no OpenAI login. Other
command failures remain unknown/unavailable. No credentials are inspected,
forwarded, logged or changed. No deadline is extended and no prompt is replayed.

The authenticated HTTP/WS regression with unavailable account metadata failed
before the fix: expected configured/available, received unknown/unavailable.
After the fix it opens the conversation and reads the native model controls.
The 33 native-engine tests cover this path, missing-login rejection, no-auth
provider compatibility and failed status commands. Five emergency-startup tests
also pass after their synthetic CLI implements the supported status command.

An isolated smoke of the built factory with actual installed Codex passes eight
concurrent readiness checks in 112–136 ms and returns seven native model choices.
It does not start any model turn. Targeted independent security review found no
actionable credential exposure, authorization, boundary, data or dependency issue.

`npm run check` passes: lint, production build, 111 files / 882 tests and all
four Chromium browser probes. No test or production timeout was increased.

Source verification does not certify production activation. Activating this
Host change requires a coordinated restart that preserves the user's running
work; the production service has deliberately not been interrupted.
