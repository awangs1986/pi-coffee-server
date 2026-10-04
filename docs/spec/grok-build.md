# Native Grok Build integration

Tracking: [Server #57](https://github.com/awangs1986/pi-coffee-server/issues/57).
This adds a fifth Work Agent to the existing Pi, Codex, Claude Code and Cursor
choices. Pi remains the only Chat engine; Pi/Codex takeover rules do not change.

## Native boundary

Grok Build owns model access, account login, prompts, tools, permissions, automatic
compaction and durable sessions. Web authenticates the Coffee user and forwards to
the scoped Host. Host gives each Work task an independent checkout and scoped Git
credentials. No provider HTTP proxy, Pi Harness or transcript format conversion is
introduced. Grok uses the native session ID returned by ACP; an unknown start or
failed resume never creates a replacement session implicitly.

The verified release is official stable Grok Build **1.0.46**. Installation uses
`https://x.ai/cli/install.sh`. Its `agent` alias must not overwrite Cursor's alias:
keep Grok under its native directory and expose only `grok` on the shared PATH.
Set `PI_COFFEE_GROK_COMMAND` to a verified binary. Native execution uses
`grok --no-auto-update agent stdio` (JSON-RPC 2.0 over stdio).

The owner logs in as the Host OS user:

```sh
grok login --device-auth
```

Authentication probing initializes ACP without creating a task or running a model.
Only native-advertised `cached_token` or `xai.api_key` methods are eligible, with
`_meta.headless=true`; API-key selection additionally requires the native key env
var. Interactive-only auth methods leave the engine unavailable. Coffee never
reads or transports token-file contents or initiates browser login for the user.
Readiness is reevaluated after login. Unexpected native protocol/auth changes fail
closed rather than selecting a different Agent.

## Supported interactions

The engine shares the tested ACP transport and lifecycle module with Cursor.
Vendor authentication and Cursor-specific question/plan methods remain gated.
Grok supports native session creation/resume, text and tool streaming, standard ACP
permission requests with explicit answers, Stop and editable Host follow-ups.
Browser disconnects do not terminate the native session. Unsupported native client
filesystem and terminal requests are rejected; those capabilities are not advertised.

Model choices come from native session models/config options or Grok's initialize
model metadata. Confirmed model selection is stored per task and reapplied after
resume. Native available-command notifications/metadata populate completion.
Session-changing and menu-owned native commands remain blocked to preserve binding
and settings, including `/sessions`, `/title`, `/import`, `/resume` and `/fork`.

Skills use `.grok/skills` in the task checkout or `~/.grok/skills` for VM-owner
managed Skills. Existing project ownership and machine-wide owner checks apply.
Grok's own compatibility discovery may additionally load `.claude` and `.agents`
resources; Coffee does not delete these or rewrite the native discovery rules.

## Initial capability limits

The actual unauthenticated initialize advertised session loading and image=false.
Inline images are therefore disabled; workspace attachments remain available through
the existing task files interface. Pre-creation model selection, separate reasoning
controls, context statistics, rename, native steering, Fork and takeover are not
advertised until their native paths can be verified. Native automatic context
management remains unchanged; no Pi/Codex 272K/500K preset is imposed.

As with Cursor, passive history synchronization retains the durable display index
with unknown native freshness. It must not start a process merely to read history.
Execution attachment replays native session/load history. Detached-writer state is
not proven by this ACP integration, so operations requiring verified quiescence and
idle-runtime eviction remain guarded.

## Acceptance

Public HTTP/WS and browser-controller regressions cover five engine choices,
Work-only creation, missing login, native binding/resume, model restoration,
permission waiting across reconnect, Host queue, targeted cancellation and native
Skill destinations. Native error redaction includes synthetic xAI credential tests.
The existing Cursor tests also run against the shared implementation.

Official stable installation, version, login help and unauthenticated native ACP
initialize are verified on the VM. The installed unauthenticated CLI advertises
only an interactive `grok.com` auth method; it stays unavailable in Web until a
supported native headless authentication path is exposed. A real authenticated
model turn is an explicit post-login acceptance gate, not a fixture success.

Sources checked 2026-10-04:
- https://docs.x.ai/build/overview
- https://docs.x.ai/build/cli/headless-scripting
- https://docs.x.ai/build/cli/reference
- https://docs.x.ai/build/features/sessions
- https://docs.x.ai/build/features/skills-plugins-marketplaces
