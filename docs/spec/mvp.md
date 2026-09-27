# PI Coffee MVP specification

## Goal

Prove one complete conversation path with the original Pi agent, deployed in
the shape the product will keep — **Pi agent in the user's VM, server-side Web
Server and LLM Relay on the server**:

```text
Browser → Web Server (server) → Host (User VM) → original Pi RPC process → streamed Events → Browser
                                     └→ LLM Relay (server, sole upstream key) → CPA
```

The MVP is a transport and ownership proof, not a feature port from V5.

## Deployment shape (owner decision, 2026-09-02)

| Where | What |
|---|---|
| User VM (one per user, Linux Mint Xfce) | Agent Host + original Pi 0.87.1, running as the VM owner. Holds the Host token and its Relay token; **no upstream key**. |
| Server (Debian) | Web Server (browser entry, bridges to the Host) and LLM Relay (the only process with the upstream key). |

A single-machine `npm start` remains the developer smoke, not the MVP
deliverable. Hand-installed systemd units for both machines are in
[`deploy/`](../../deploy/README.md); the procedure is in the
[runbook](../deployment/runbook.md).

## Included

- Separate Relay, Host and Web Server processes with their own secrets.
- A versioned JSON WebSocket frame contract.
- New and resumed in-process Sessions.
- Text prompt and abort commands.
- Pi `message_update`/`text_delta` streaming to the browser.
- Browser disconnect without calling `PiSession.stop()`.
- Bounded cursor replay after reconnect.
- Native Pi session ID propagation with `--session-id`.
- A transparent LLM Relay: Chat Completions and Responses JSON/SSE pass-through,
  `/v1/models`, `/v1/responses/compact`, token swap at the seam, bounded
  content-free metadata (`CP-001`).
- A Codex-style light-theme browser shell (see below) and health endpoints.
- systemd unit and env templates for the server and the User VM.

## Not included

Gitea OAuth and multi-user routing (one Web Server bridges to one User VM in
the MVP), the idempotent Deployment Skill with enrollment, VM lifecycle
management, V5 Guard/permission/snapshot enforcement, PI Coffee task
orchestration semantics, durable Control Plane context, file uploads, image UI,
and Host-restart session recovery. The bundled PI Coffee Harness extension and
the locked `pi-subagents` delegation extension are Host add-ons; loading them
does not make task orchestration part of the MVP acceptance contract. Their
native behavior and remaining User VM acceptance work are documented
separately and do not revive V5 controls.

## Evidence in this checkout

- Protocol seam: [`test/protocol.test.ts`](../../test/protocol.test.ts)
- Host seam and disconnect replay: [`test/host-server.test.ts`](../../test/host-server.test.ts)
- Web bridge and replay: [`test/web-server.test.ts`](../../test/web-server.test.ts)
- Original RPC adapter: [`test/pi-adapter.test.ts`](../../test/pi-adapter.test.ts)
- Complete browser → Host → Pi RPC path: [`test/mvp-e2e.test.ts`](../../test/mvp-e2e.test.ts)

Run:

```bash
npm install
npm run check
npm start
```

The tests use a fake RPC process so no credential is needed. A real run additionally needs the normal Pi provider/model configuration in the Host environment. The current adapter is pinned to `@earendil-works/pi-coding-agent@0.87.1`.

## MVP completion criterion for a colleague

From a fresh clone, the colleague can install dependencies, get a green `npm run check`, start `npm start`, open the served page, and reproduce a real or local-mock streamed reply without editing V5 or placing a secret in the repository.

## Real-model evidence

`pi-coffee-server/scripts/smoke-real-model.mjs` drives the browser protocol against a running
stack whose Host has a real provider (the CPA relay via Pi's `models.json`, see
the runbook) and asserts: streamed `text_delta` through `agent_settled`,
strictly increasing cursors, exact bounded replay after a browser disconnect,
zero replay when caught up, and a second turn on the same Session. Its JSON
output is the acceptance evidence for [#5](http://testpc:3000/awangs/pi-coffee/issues/5).

## Browser shell

`public/` is a build-free static shell served by the Web Server from an
allow-list of flat file names: `index.html`, `app.css`, ES modules `app.js`
(controller), `render.js` (Markdown, tool cards, diff), `highlight.js`,
`diff.js`, plus two vendored MIT libraries copied from `node_modules` at build
time (`vendor-marked.js`, `vendor-purify.js`). It follows the familiar Codex
layout in a white theme; the gap list and roadmap are in
[`web-shell-roadmap.md`](./web-shell-roadmap.md).

- Left sidebar: "新对话", the list of conversations **from the User VM's session
  store** (served by the Host on `list_sessions`), and the connection state.
  Selecting a conversation opens that Session on the Host, which resumes it
  from the store if no Pi process is live for it.
- Main column: user messages as light bubbles (with image thumbnails),
  assistant text rendered as sanitized GFM Markdown with highlighted code
  blocks and copy buttons, one run's tool calls grouped under a collapsible
  "工作过程" with per-tool views (edit → the patch Pi recorded, write → added
  lines, read → code, bash → command and output), and notes for model errors,
  auto-retry, extension notifications and `resync_required`. Assistant
  messages offer copy and regenerate.
- Sidebar: search, time groups, rename/delete menu (delete removes the file
  from the User VM store after confirmation); the Host pushes list changes.
- Composer: rounded card, Enter sends, Shift+Enter inserts a newline; model and
  thinking selectors (`get_models`), `/` command palette (`get_commands`),
  image paste/drop, a context-usage chip that compacts on click
  (`get_stats`/`compact`). While the Host reports `isStreaming` the composer
  stays usable: messages are queued (`follow_up`) or interjected (`steer`),
  and a stop button sends `abort`. `Ctrl/⌘+K` starts a new conversation.
- Files: dropped, pasted or picked files travel **straight from the browser to
  the User VM** over LocalSend v2 (ADR-0009) with real progress, land in the
  conversation's inbox and are referenced by path in the prompt; attachments
  and `read/write/edit` tool cards offer downloads over the same API.
- Extension UI: Pi extensions' `ctx.ui.confirm/select/input/editor` become
  modal dialogs answered over `ui_response` (re-delivered after a reload while
  the extension is still waiting); `notify`, `setStatus`, `setWidget` and
  `set_editor_text` render as notes, status chips, a widget strip and composer
  prefill.

The shell is stateless (ADR-0008): on every `open` it renders the `history`
frame the Host projects from Pi's durable session file, then applies only the
in-flight tail of live events. A browser with empty storage on another
machine sees exactly the same conversations and history; a Host restart or an
idle shutdown of the Pi process loses nothing. The only thing kept in
`localStorage` is the id of the conversation last displayed, so a reload lands
on the same one. All computation, including history projection and session
listing, happens on the Host in the User VM.

## Relay evidence

`test/relay-server.test.ts` covers, against an in-process stub upstream: token
swap and header stripping, JSON and SSE pass-through, chunk-by-chunk streaming
(the first SSE chunk reaches the client while the upstream still holds the
second), upstream error status pass-through, 502 on unreachable upstream, 504
on header timeout, broken upstream stream → broken client connection (never a
clean end), client disconnect → upstream abort, 413 on oversized bodies,
backpressure propagation from a slow client, and content-free metadata.
Real-model runs through the Relay (Host without upstream key) were reproduced
for `openai-completions`, `openai-responses`, a tool call and an image prompt;
evidence is on [#7](http://testpc:3000/awangs/pi-coffee/issues/7).

## Known gaps before calling it deployed

One Web Server bridges to exactly one User VM Host; per-user routing arrives
with Gitea OAuth (`ID-001`). Completed conversations already survive a Host
restart (they live in Pi's session store); recovering a run that was
mid-stream when the Host died is `REC-001`. The Deployment Skill (`DEP-001`)
and upload/image handling belong to 0.1.
