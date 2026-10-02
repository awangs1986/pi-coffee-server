# Pi 0.99 upgrade impact and deployment audit

Date: 2026-09-30. Scope: research and isolated compatibility probes only. No package upgrade, production restart, credential change, or deployment was performed.

## Decision

Keep the existing Server/Host/native-adapter and independently versioned Pi-plugin architecture. Target the exact **0.99.1** patch, which is already installed in the owner's Workbench Host. Complete the integration work before describing the entire toolchain as upgraded: the retained aggregate still selects a **0.87.1 child runtime**, and Host does not consume the new RPC input disposition.

Do not simultaneously enable native codemode/MCP, replace Harness discovery, or upgrade external web/subagent packages. Those are separate behavior changes. LSP remains a native plugin plus CLI/Skill; it does not need MCP. Native automatic compaction and experimental manual Handoff retain their current responsibilities.

## Observed baseline

Both remotes were fetched. GitHub and Gitea Server main were identical at `8ee54e3b273dcda26f61c4c2a7c08c6650bda740`. Pi-plugin main was identical on both forges at `b9063e4f003fcf13f1b0cc934a3500655dfb55a3`. An older local plugin checkout was deliberately preserved; comparisons used its fetched main rather than treating its working tree as current.

| Component | Observed version | Evidence / qualification |
| --- | --- | --- |
| Server main and owner's running Host release | `8ee54e3` | Clean current checkout; systemd and `/proc/<pid>/cwd` identify the same release directory |
| Host Pi coding-agent / agent-core / AI / TUI | `0.99.1` | Root lockfile and installed manifests in the running release |
| Harness | `0.1.4` | Immutable monorepo artifact and installed manifest |
| LSP | `0.4.4` | Immutable monorepo artifact and installed manifest |
| Handoff | `0.2.0-experimental.3` | Immutable monorepo artifact and installed manifest |
| Legacy aggregate | `pi-coffee@1ec49a9` | Retained subagent bridge and context observer |
| Child Pi selected by that bridge | **`0.87.1`** | Isolated native extension-load probe recorded the selected CLI; its manifest confirms the version |
| Official web access, installed | `0.27.0` | Host release manifest |
| Official subagents, installed | `0.63.0` | Host release manifest; still loaded through the Coffee adapter |
| Separately installed local global Pi | `0.86.1` | Manifest under the versioned Node installation; `pi` was not on this shell's default PATH |
| npm latest at research time | Pi `0.99.1`; web `0.34.0`; subagents `0.73.1` | Registry queries; these are independent version lines |

The earlier rollout is documented in [Server #4](https://github.com/awangs1986/pi-coffee-server/issues/4). It records fresh-clone checks, live Pi/Codex turns and browser acceptance for the initial `41114f1` release. Those are previous evidence, not newly repeated live-model tests. The currently running Host has advanced to `8ee54e3` while retaining the package versions above. This audit did not independently revalidate the remote Web machine or other VMs; a read-only SSH key-auth attempt to Web was rejected. A Host manifest alone cannot establish every machine's state.

Current ownership: [repository map](../../REPOSITORIES.md), [ADR-0021](../adr/0021-pi-only-source-authority.md), [plugin consumption](../development/plugin-monorepo.md). Historical standalone plugin repositories are not upgrade targets.

## Confirmed integration gaps

### 1. Host discards the new command disposition

Pi 0.99 returns `started | queued | handled` from `RpcClient.prompt()` and `queued | handled` from `steer()` / `followUp()`. A `handled` input does not start a run and will not emit `agent_settled` for that input. Coffee's current `sendChecked()` casts the client to call its private `send()` method, checks only `success:false`, and discards `data.disposition`. Host reserves a prompt slot before that call and waits for run settlement.

Two isolated, no-model probes confirmed the mismatch:

1. Native 0.99.1 with the deployed extension composition: `/harness version` returns `handled`; no `agent_start`, `agent_end` or `agent_settled` occurs.
2. Current compiled Web → Host → native Pi: the first `/harness version` receives a prompt acknowledgement; the next receives `code: busy`, `A prompt is already running for this session`. No settled event occurs. The probe used temporary task/session directories and loopback ports, not a user's conversation.

Recommended repair: consume the public RPC methods and propagate input disposition through the Pi adapter's admission contract. Release only the handled input's reservation; do not falsely settle an already running turn when handling steer/follow-up input. Keep started and queued behavior separate. This also removes a private-method cast and an outdated comment claiming public prompt methods ignore failed responses.

Sources: [Coffee adapter](https://github.com/awangs1986/pi-coffee-server/blob/8ee54e3b273dcda26f61c4c2a7c08c6650bda740/src/host/pi-adapter.ts), [Host admission](https://github.com/awangs1986/pi-coffee-server/blob/8ee54e3b273dcda26f61c4c2a7c08c6650bda740/src/host/server.ts), [official RPC client](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/modes/rpc/rpc-client.ts), [official RPC types](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/modes/rpc/rpc-types.ts).

### 2. Parent and child runtime identity differ

The legacy aggregate's `configureAdmission()` resolves Pi relative to its own module, then sets `PI_COFFEE_PI_CLI` and the launcher override. The native-load probe selected:

```text
<Host release>/node_modules/pi-coffee/node_modules/@earendil-works/pi-coding-agent/dist/cli.js
```

That installed package is 0.87.1. This establishes the selected launch target, not the outcome of a paid child-model turn. Root 0.99.1 pins do not override that nested resolution. The independently installed global 0.86.1 is a third installation, not the Host runtime.

Recommended repair: make child runtime identity explicit and verify it through an actual child-launch fixture. Preserve or deliberately migrate the existing cancellation, admission, model-selection, result-bounding and workspace-job contracts. Do not remove the aggregate by deleting its dependency before replacing its remaining consumers. Do not change the frozen compatibility tree into a second maintained plugin implementation.

Sources: [pinned aggregate admission](https://github.com/awangs1986/pi-coffee/blob/1ec49a93048f0e441806cd17da7b245972e5f51a/src/subagents/admission.ts), [current dependency lock](https://github.com/awangs1986/pi-coffee-server/blob/8ee54e3b273dcda26f61c4c2a7c08c6650bda740/package-lock.json), [Server extension composition](https://github.com/awangs1986/pi-coffee-server/blob/8ee54e3b273dcda26f61c4c2a7c08c6650bda740/src/host/pi-extensions.ts).

## Official changes and architectural consequences

### Tool discovery, codemode and MCP

0.99 adds native `tool_search`, `codemode`, MCP and tool exposure types (`direct`, `model-only`, `codemode`, `deferred`, `hidden`). CLI loads these built-in extensions; SDK consumers opt in through their factories. Native tool discovery overlaps with Coffee's `search_tools` implementation, but does not supply Coffee's Chat/Work product policy, capability readiness or prompt contract.

The isolated current Work composition registers native `codemode` and `tool_search` as model-only tools, but neither is active. Existing Coffee discovery remains active. Keep that conservative behavior for compatibility work. Later, evaluate delegating discovery mechanics to native Pi while retaining Harness mode and readiness rules.

`setActiveTools()` controls declarations; codemode/deferred tools can remain callable through nested execution without being declared. Existing `tool_call` hooks also cover nested calls, so Harness can enforce mode policy there. Coffee already has a Chat tool-call guard. No current bypass was demonstrated; native exposure modes need explicit acceptance before enabling them. MCP configuration can activate codemode or tool search, so a test must include configured MCP if that feature is adopted.

MCP is optional. Codemode's QuickJS sandbox isolates orchestration JavaScript; it does not change the user's VM execution model. Neither feature requires turning Host into a Pi plugin or moving LSP into MCP.

Sources: [tool exposure](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md#tool-exposure), [MCP exposure](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/mcp.md#exposure), [CLI tools](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/cli.md#tools).

### Context size and result contracts

New `outputSchema` / `structuredContent` separates machine-readable results from model-facing `content`. Codemode can process large results and emit only a summary. It does not automatically implement persistent artifacts, summary-plus-pointer responses, or rejection of invalid search results. Default codemode output can still reach 10,000 tokens. Bash retains the model-facing 2,000-line / 50-KB bound while its structured output can reach 1 MiB.

Nested tool events carry `parentToolCallId`; bounded `nestedCalls` metadata is saved on the parent result rather than creating a separate transcript message for every child. Any future Web rendering, context accounting or background-settlement integration must distinguish parent and nested calls. A result interceptor that replaces only `content` can cause Pi to discard `structuredContent`; preserve or intentionally transform both when enabling programmatic consumers.

Sources: [extension result contract](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md), [codemode configuration](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/cli.md#enable-codemode), [bash source](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/tools/bash.ts).

### LSP, Handoff and sessions

Keep the existing LSP transport and language servers. LSP 0.4.4 already fixes the completed-query settlement problem that blocked manual Handoff in the previous rollout. Its optional Handoff event contract is independent of native automatic compaction.

The official compaction documentation is unchanged between 0.87.1 and 0.99.1; this release does not establish a new Handoff algorithm or improved semantic fidelity. Keep native automatic compaction and explicit experimental Handoff. Drift evaluation remains separate.

Pi now creates a session file on the first user message, improving first-turn crash durability. Nested-call and virtual-model metadata extend session records. Keep original durable task/session files during upgrades and rollback; test resume without assuming an older binary preserves every new metadata field.

Sources: [LSP changelog](https://github.com/awangs1986/pi-coffee/blob/b9063e4f003fcf13f1b0cc934a3500655dfb55a3/packages/lsp/CHANGELOG.md), [current Handoff policy](../spec/manual-handoff.md), [official compaction](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/compaction.md), [session format](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/session-format.md).

### Runtime, errors, packages and other engines

- Node's minimum remains 22.19.0. Upstream's TypeScript 7 / ES2024 build does not require converting Coffee's build merely to consume npm artifacts.
- TypeBox remains 1.3.27 in upstream. The maintained Harness/Handoff releases already moved host-provided TypeBox into peers. Pi's managed-Git installation fix avoids installing new host peers; it does not remove the old aggregate's nested kernel.
- Direct Bash `.execute()` calls now return `isError: true` on a nonzero exit instead of only throwing. The native agent pipeline handles this; any direct wrapper relying only on catch needs a failure case. Coffee's inspected Git tool uses `pi.exec()` exit codes, so this is not evidence that its Git operations broke.
- `--no-extensions` now disables built-in extensions too; built-in source identifiers become `builtin:<name>`. Audit child flags and UI source classification when migrating them.
- 0.99.1 repairs bundled OpenAI login and adds GPT-6.1 Sol. It does not require changing explicit OpenRouter/Eidolon defaults, native Codex CLI, Claude CLI or their authentication. Virtual models are optional; enabling them would require separately checking the Host model allowlist against routed physical models.

Sources: [official changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/CHANGELOG.md), [runtime manifest](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/package.json), [virtual models](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/virtual-models.md).

## External plugin upgrades are separate decisions

`pi-web-access@0.34.0` changes default tool activation from `dynamic` to model-dependent `auto`: some models receive all enabled web tools immediately. Earlier releases also changed caching and search-result truncation. If upgrading from the deployed 0.27.0, explicitly choose the desired activation behavior and check summary bounds plus complete-result retrieval. Do not infer those guarantees from wildcard peer ranges.

`pi-subagents@0.73.1` is newer than the installed 0.63.0 bridge target. Its foreground workflow output cap can still be 200 KB / 5,000 lines, with complete output saved separately. That is not a small-summary contract. Replacing the bridge with the official native package affects current scheduling, result bounds, cancellation and Host job observation, so it needs its own migration rather than a blind version substitution.

Sources: [web 0.34.0 manifest](https://registry.npmjs.org/pi-web-access/0.34.0), [exact web changelog](https://github.com/nicobailon/pi-web-access/blob/7bd4509ee4e417a9e0141235bbe276ff77aa81e3/CHANGELOG.md), [subagents 0.73.1 manifest](https://registry.npmjs.org/pi-subagents/0.73.1), [exact subagents changelog](https://github.com/nicobailon/pi-subagents/blob/8a403efba6975988cc0488ec8bb941db5ef1a19e/CHANGELOG.md).

## Recommended sequence and focused acceptance

1. **Fix RPC disposition first.** Red → green at Web/Host/native Pi: slash command followed by another command/prompt; started/queued/handled; error and abort. A handled steer/follow-up must not terminate the current run.
2. **Unify the selected child runtime.** Verify parent and actual child version, launch, completion, cancellation and job settlement. Plan legacy aggregate removal through its public consumers. Treat terminal installation alignment as a separately identified deployment target.
3. **Keep optional 0.99 features inactive initially.** Verify Chat/Work switching, prompt boundaries and Coffee activation. Only if adopting codemode/MCP, add nested-call policy, output bounds, accounting and Handoff-settlement coverage.
4. **Retain maintained plugin versions for the compatibility baseline.** Smoke LSP success/error followed by Handoff, failed-Handoff preservation, native automatic compaction, reconnect and first-turn resume. No large paid language/drift matrix is needed to establish these seams.
5. **Release an exact combination.** Run the documented fresh-clone checks; publish immutable affected plugin artifacts; pin Server; push GitHub then identical Gitea. Deploy only the checked commit, record root/child versions and served assets, and probe the relevant UI/API. Preserve the existing VM/task/session data and previous release/configuration for rollback. Recheck each other Host separately.

This research reran `test/pi-adapter.test.ts`, `test/pi-model-policy.test.ts` and `test/pi-package-integration.test.ts`: **3 files, 16 tests passed**. The installed-package test covers real native Pi with a deterministic provider, Work LSP activation/call, committed manual Handoff, invalid-Handoff rejection and reconnect history. It does not cover a real child launch or handled-command admission, which explains why those gaps coexist with green checks. The separate no-model probes above expose them. No new paid model evaluation or complete release acceptance is claimed.

The first scratch probes needed startup/teardown corrections; corrected native and HTTP/WS probes reproduced the findings. The HTTP/WS probe removed its temporary directories but retained an open process handle; that identified probe process was explicitly terminated after collecting results. Temporary resources were scoped outside production. No implementation fix is included in this note.
