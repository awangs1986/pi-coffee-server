# Conversation Fork acceptance

Issue: [Server #39](https://github.com/awangs1986/pi-coffee-server/issues/39).
Contract: [Conversation Fork](../spec/conversation-fork.md).
Implementation candidate: `2ef56c2` (2026-10-03). Production activation is separate.

## Coverage

| Boundary | Observed result |
| --- | --- |
| Host HTTP | Owned idle sources only; independent snapshot; staged/unstaged/untracked files and attachments preserved; duplicate ID accepted without repeat generation; foreign source, busy source, missing Handoff consent and external links rejected. Failed/interrupted destinations retained. |
| Pi native | SessionManager native copy has new cwd/ID; source transcript unchanged. Handoff RPC runs only on the copy; Chat remains Pi Chat. |
| Codex native protocol | Traditional history copy and Handoff summary/fresh destination through the app-server fixture; model, effort and context preset preserved. WS rename then list retains the new title. |
| Preparation permissions | Both Codex preparation factories apply read-only/no-network with execution features disabled and effective MCP providers explicitly disabled. Claude starts with no built-in tools, strict empty MCP, disabled hooks and slash commands. Normal reopening restores ordinary task permissions. |
| Claude native protocol | HTTP Handoff reaches an independent bound native session, preserves source history and returns to normal CLI arguments on reopen. Traditional Fork stays disabled. |
| Browser controller | Explicit Handoff confirmation; pending/completed state; transport uncertainty retains the same operation ID for reconciliation/retry. |
| Chromium | Menu beside Rename/Archive; both dialog choices; closing makes no task; confirmation receives 202, opens child and preserves source/attachment; zero page errors. |

Commands:

```sh
npm ci
npm run check
CHROMIUM_PATH=/path/to/chromium node scripts/probe-conversation-fork.mjs /path/on/disk/evidence
```

A separate clean clone of `2ef56c2` passed **74 files / 559 tests**, including build.
The browser probe boots disposable Web and Host processes on loopback and removes
its fixture store on exit. It writes screenshots and a JSON result to the supplied
evidence directory. It never uses production stores or provider credentials.
The repository currently has no `docs/agents/feedback-loops.md`; the probe is the
reproducible fixture boot path for this feature.

Local acceptance artifacts (fixture content only):
`/home/awang/tmp/coffee-conversation-fork/browser/{native,handoff}-{dialog,completed}.png`,
`browser/result.json`, `fresh-check.log` and `fresh-install.log` under that same
parent directory. Screenshots were visually inspected.

## Review findings and corrections

- A newline-terminated staged patch was corrupted by trimmed Git stdout. The HTTP
  fixture failed before preserving raw patch output and passed afterward.
- Native renamed titles were hidden by initial Fork metadata. WS rename/list now
  passes for both Codex modes, with the native name taking precedence.
- A lost request response could generate a second operation ID. The controller
  regression now verifies the original ID is retried after reconnection.
- Prompt-only preparation permissions were insufficient. Native restrictions now
  apply before generation, and unexpected tool events fail preparation.
- An empty Codex MCP table does not remove configured providers. Preparation reads
  the effective cwd configuration and disables every provider explicitly; the
  protocol fixture supplies an enabled external provider and verifies its denial.

Standards and Spec focused re-reviews found no remaining required findings. Spec
review independently reran 10 focused tests. Security review prompted the MCP
correction above; native configuration verification is recorded in Issue #39.

## Limits

Provider responses in automated and browser tests are deterministic native CLI
fixtures. This proves transport, lifecycle and copying behavior, not real-model
handoff fidelity or all provider/version combinations. Handoff remains experimental.
Claude full-context Fork is unavailable. Claude exported history over 1 MiB,
external links, nested Git repositories/submodules and unresolved merge conflicts
fail explicitly, retaining source and diagnostic copy.

No production Web/Host process was restarted and no real model turn was charged.
No dependency manifest or lockfile changed. `npm ci` reported an existing high
severity transitive `brace-expansion` advisory; it is outside this Fork change.
