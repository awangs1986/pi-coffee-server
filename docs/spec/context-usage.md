# Context Usage attribution

Owner correction, 2026-09-23. Agent #58; Browser counterpart: Server #4.
This specializes PA-006 and replaces the aggregate/cumulative-only UI assumption.

## CU-01 — Display contract

The supplied reference is the required structure: `上下文用量`, close button,
`已使用 N%` at left, `~used / capacity 词元` at right, a single segmented capacity
bar, then exactly these rows in this order and colors:

| ID | Label | Color | Counted content |
|---|---|---|---|
| system | 系统提示词 | Gray | Effective system/developer instructions after separately attributed sections are removed |
| tools | 工具定义 | Purple | Resident tool schemas actually included in the request |
| rules | 项目规则 | Green | Injected project instructions and instruction-file reads in the active context |
| skills | 技能 | Ochre | Injected skill catalog and loaded SKILL.md tool results retained in context |
| dynamic | MCP 与动态工具 | Magenta | Other active schemas, including optional capabilities and MCP tools |
| subagents | 子代理定义 | Blue | Agent-definition blocks included in the parent prompt and retained reads of `.pi/agents/*.md` |
| conversation | 对话 | Red | Remaining messages, tool calls and results in the request |

Zero means no content of that category is included. Installed tools, on-disk
Skills, registered child definitions and child-only prompts do not count merely
because they exist. Missing measurement is unavailable, not zero. The remaining
bar width is unused capacity. Categories are disjoint and sum to the displayed
used total. Cumulative input/output/cache billing MUST NOT replace these rows.

## CU-02 — Collection and accuracy

An observer loads after the payload-changing Harness and reads Pi's public
`before_provider_request` event. It does not modify the payload, add tools, call
a model, or alter Chat's minimal-system contract (including the [Host environment sentence](session-environment.md)). The observation is the most recent
request's model-visible content, after context transformations. System wrappers
`project_context`, `available_skills`, and `available_agents` establish source
attribution. Read-result attribution uses actual tool-call IDs/paths, not text
keywords in arbitrary user messages. Provider request schemas and messages are
counted locally using `o200k_base` tokenization; provider envelopes, multimodal
billing and proprietary tokenizer differences prevent an exact provider count.
The UI uses `~` and exposes the estimate method, observation basis and timestamp.
Media bodies are omitted and explicitly marked; they are not zero-cost claims.

A resumed task with no observed request uses `session_preview`: Pi's public
context builder, currently effective system prompt and active schemas. It must
be identified as a preview, not a replay of the last serialized request. Per-turn
injections and provider-specific transforms become authoritative after the next
request. Mode/model changes, session start/tree and compaction invalidate cached
measurements. Preview queries are rebuilt; inactive/archived branches and custom
metadata entries never inflate model-context counts.

## CU-03 — Transport and privacy

The read-only `/coffee-context-usage <nonce>` extension command writes only the
seven bounded counters, model identifier, method, basis, timestamp, capacity and
media-omission flag to a Pi custom entry (excluded from model context). The Pi
Adapter requests it through the documented RPC client and projects an allowlist
into additive `SessionStats.contextBreakdown`. Raw system prompts, messages,
tool schemas, file contents and credentials stay in the owning VM.

The gateway remains transparent. Codex/Claude capabilities are unchanged; this
Pi customization must not parse or rewrite their private contexts. Engines that
do not expose supported stats cannot pretend to implement this contract.

## Acceptance

- `test/context-usage.test.ts`: seven disjoint categories, Chat excludes Work prompts,
  dynamic schemas, model invalidation, media omission, and numeric-only output.
- `test/chat-work-rpc.test.ts`: real pinned Pi + all default plugins + LSP Skill,
  local fixture provider, actual Work/Chat payload attribution. No paid provider.
- `node scripts/probe-context-usage.mjs` after build: real Pi Adapter/RPC/extension
  end-to-end preview with synthetic Rules and LSP Skill, no model request.
- `npm run check` in a fresh clone; Browser acceptance is tracked in Server #4.

## Native context controls (2026-09-30)

Tracked by GitHub Server #11 and Pi #4. Context and diff controls use Chinese
labels. Codex displays `thread/tokenUsage/updated.last.totalTokens` against the
native `modelContextWindow`; cumulative token totals are never substituted.
Codex does not expose the seven-category attribution contract. Its categories
remain unavailable and its total bar is explicitly unclassified.

Pi and Codex offer task-local `272k` (default) and `maximum` presets beside model
and reasoning controls. Maximum requires the extra-cost confirmation before any
change is sent. Host rejects changes while a turn or context operation is active.
The first message waits for the selected model and context settings to be applied.
An older Host without context capability disables the setting.

Pi Harness 0.2.0 uses the public native model API, clamps 272k to model registry
capacity, and restores the original capacity for maximum. Its custom session entry
persists the selection when native Pi saves the session. Pi automatic compaction
and reserve remain native. Codex uses `model_context_window=272000` and
`model_auto_compact_token_limit=258400`; maximum removes Coffee's overrides and
uses native configuration. Native effective capacity may include a safety margin
and differ from the selected nominal limit. Neither preset is a hard billing cap.
Codex persists the preset in scoped Host bookkeeping. Configuration changes
release and resume only the idle native thread; an unmaterialized empty thread is
replaced and its platform binding updated without replaying any messages.

Manual Codex compression invokes native `thread/compact/start` and waits for the
native context-compaction item and successful turn completion. Request acceptance
is not completion. Native failure, process exit and timeout surface as failures or
unknown outcomes. Pi manual Handoff remains separate. Provider-specific remote
compaction behavior is owned by Codex, not reimplemented by the Web gateway.
