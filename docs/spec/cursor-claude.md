# Cursor ACP and Claude Code completion

Tracking: [Server #56](https://github.com/awangs1986/pi-coffee-server/issues/56).
This supplements and supersedes conflicting three-engine capability statements
in native-agent-engines.md and native-agent-browser.md.

## Boundaries

The four engine choices are Pi, Codex, Claude Code and Cursor. Chat remains
Pi-only. Work uses the existing independent checkout, authenticated user's Host
scope and task-scoped Git credentials. Native login stays on the Host VM. The
Web gateway never forwards provider API traffic or stores native login secrets.
Pi Harness, LSP and handoff packages are not injected into the other engines.
Existing Pi/Codex takeover and Fork behavior remains unchanged; Cursor has no
verified Fork or takeover capability.

Cursor uses `agent acp`, JSON-RPC 2.0 over local stdio. The verified CLI release
is `2026.10.01-e373342`. Set `PI_COFFEE_CURSOR_COMMAND` to its absolute executable
path and authenticate with `agent login` as the Host's OS user. Readiness checks
native version and `status --format json`; unauthenticated installations remain
visible but unavailable. Claude Code continues to use its native stream-json
protocol, verified with version 2.1.280 and `PI_COFFEE_CLAUDE_COMMAND`.

## Interaction contract

- Host stores each Cursor session/new result as a durable native binding before
  accepting a prompt. Resume uses session/load with the same ID and cwd. An
  uncertain start or failed load must never silently create a replacement.
- Cursor receives the short Host environment guidance as an additional text
  block on its first prompt. Native project instructions and tools remain native.
- ACP text chunks and tool updates feed the common transcript. Permission,
  question and plan requests stay pending until an actual browser answer; no
  default selection or timeout is treated as approval. Unknown client filesystem
  and terminal requests fail closed because those capabilities are not offered.
- Cursor questions use native option IDs. Unsupported free-text answers are
  rejected without consuming the pending question; multi-select uses comma-separated
  option labels. Plan acceptance explicitly selects accept/reject.
- Stop sends session/cancel to only that task. A prompt has no arbitrary 30-second
  request timeout. Browser disconnect does not stop the native process.
- Claude and Cursor use the existing editable Host follow-up queue. Neither
  advertises immediate native steering. Stop cancels pending Host follow-ups.
- Native terminal commands that replace the session, authentication or menu-owned
  settings are rejected with guidance to use Web controls. They are omitted from
  command completion. This preserves durable task/native identity.

## Models, commands and context

Claude's initialize response supplies model-specific effort choices and commands.
Users can choose model and effort before creation; medium is the default when
supported. Confirmed settings persist in task metadata and are reapplied on resume,
without rewriting the CLI user's settings. Native rename is persisted for sidebar
recovery. Commands and Skills appear in completion; unsupported built-ins remain
native errors rather than emulated actions.

Claude context usage comes from get_context_usage(detail=summary). Categories are
shown only when every used category maps to the seven UI categories and their sum
matches the native total; otherwise only the native total is shown. The source is
labelled native summary (including estimates), never Pi's tokenizer or cumulative
billing totals. Claude's native automatic compaction remains intact. The platform
does not advertise a separate verified manual compaction control or Pi/Codex's
272K/500K context presets for Claude or Cursor.

Cursor models are discovered from the bound ACP session's native models/config
options. Selection persists per task and is restored on resume. Pre-creation model
discovery, separate reasoning controls, context statistics and rename are not
advertised until verified native interfaces are available. ACP native command
notifications populate the slash menu after opening a task.

Web Skill management installs Cursor packages in `.cursor/skills` (project) or
`~/.cursor/skills` (VM owner), using the existing source pinning and scope checks.
Claude continues to use `.claude/skills`. Cursor can also discover upstream shared
`.agents/skills`; these are not silently deleted or reinterpreted by this change.

## History and lifecycle limits

Claude remains backed by its native JSONL readonly audit. Cursor's authoritative
replay comes from session/load when an execution connection opens. Passive browser
history reads must not spawn or resume a Cursor process: the durable display index
is retained and freshness is reported unknown, never replaced with empty history.
External native Cursor edits cannot be certified current by passive synchronization.

ACP does not currently provide verified detached-writer accounting. Cursor reports
background state unknown. Workspace operations that require proven quiescence
(Checkpoint, pull, destructive cleanup, native reload) remain guarded. Cursor also
cannot use automatic idle-runtime eviction that requires this proof. This is an
explicit initial-integration limitation, not a claim of complete engine parity.

## Acceptance and evidence

Public HTTP/WS and browser-controller tests cover four-engine readiness, Work-only
creation, confirmed model/effort selection, settings restoration, native binding
resume, blocking permission/question responses, reconnect, queue, stop and scoped
Skill destinations. Existing Pi/Codex behavior remains covered by the repository check.

Actual local Cursor initialize succeeded, but Cursor was unauthenticated during
acceptance. Actual Claude model/effort/rename/context controls succeeded. A real
Claude turn and a direct CLI comparison both failed with upstream HTTP 403
(insufficient balance/plan quota). Neither engine is claimed to have passed a real
model-turn acceptance on these credentials. Retest after native Cursor login and
Claude quota restoration; do not substitute protocol fixtures for those gates.

Sources checked 2026-10-04:
- https://cursor.com/docs/cli/acp
- https://cursor.com/docs/cli/reference/parameters
- https://cursor.com/docs/context/skills
- Official @anthropic-ai/claude-agent-sdk 0.3.289 declarations; each adopted
  control was independently probed against the installed Claude CLI 2.1.280.
