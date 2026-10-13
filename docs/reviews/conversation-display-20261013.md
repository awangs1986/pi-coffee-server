# Conversation display modes: source acceptance

Baseline: GitHub and Gitea main `789a0d19555ad4adf639488e1b98a3d928046058`.
Candidate: formal v0.24. Contract: [conversation delivery](../spec/conversation-delivery.md).
This records local source acceptance, not a deployment or measured production SLO.

## Behavior and evidence

| User requirement | Evidence |
| --- | --- |
| Compact default, Detailed below Speed | Actual app-controller DOM tests exercise Pi, Codex, Claude, Cursor and Grok. Context capacity and native model controls remain independent. |
| Account-scoped preference and reload | Authenticated workspace HTTP tests read/write Alice's preference, recreate Host, and verify Bob retains his own default. Invalid input is rejected. |
| Reduce transmission, not only fold UI | Host HTTP/WS tests show Compact pagination skips 60 process entries before counting visible rows; Detailed retains evidence. Tool changes advance contiguous revisions without output bodies. |
| Preserve necessary interaction | WS and DOM tests retain native questions, drafts, script text, task completion, queue state and late-answer handling while changing modes. Display-read failure cannot mark a busy task idle. |
| Preserve evidence and bound detail access | Native fixtures retain original tool history. Cross-mode page cursors and Compact tool-content reads are rejected; Detailed uses existing bounded content reads. |
| Avoid stale process rendering | Mode-specific cache namespaces, preview markers, request generations and frame tags separate projections. Legacy unmarked previews are discarded; existing account/binding invalidation remains. |
| Browser/Web/Host acceptance | `scripts/probe-conversation-display.mjs` drives real Chromium against real local Web/Host and synthetic adapters, separately for legacy and indexed history. It checks mode changes, persistence, draft retention, code blocks, no native restart/abort and zero page errors. |

The synthetic tool-heavy page measured **722 bytes Compact versus 65,002 bytes
Detailed** in the isolated probe. Both obey existing byte bounds. The fixture has
60 long tool outputs; this is not a claim that every conversation is 90 times faster.
No actual provider/model turn or production conversation was created for acceptance.
The maintained Chromium plan includes this probe alongside existing download,
attachment, heartbeat, wake, answered-question and sidebar checks.

## Red/green findings

Public-seam failing tests preceded corrections for missing Compact pagination,
missing preference persistence, absent menu, a model-readiness lock hiding the
menu, embedded Pi cumulative tool/thinking content, invisible errors from
previously omitted tools, invalid mode input, and display-read errors changing run
state. Review additionally reproduced discarded questions/completion/answer deltas
at a display-mode transition and fixed the control/data distinction.

The first broader check caught legacy anonymous-menu locking regressions and
old preview fixtures missing the newly required display marker. Native menu
behavior was preserved for anonymous clients; cache tests now explicitly cover
both correctly marked previews and rejection of unmarked legacy tool snapshots.
The retained documentation vocabulary check also rejected ordinary English uses
of a retired mode name; those phrases were corrected without changing that guard.

## Serial review and remaining boundaries

The implementation was reviewed serially for repository ownership, source/spec
agreement, input validation, HTTP/WS authorization and cache/account isolation.
No sub-agents, global credentials, security configuration changes or new package
dependencies were used. Host owns projection; Web still authenticates and forwards.
The display setting neither changes native context nor injects Chat instructions.

Old clients omitting the new mode retain Detailed behavior. Activate matching
Browser/Host v0.24 artifacts together; this is not a Browser-only rollout to an
older Host. Ordinary file/download and Diff authorization are unchanged. Synthetic
seam/browser tests do not prove actual CLI/account availability for every engine,
or a production latency target under arbitrary transcript/network conditions.

The configured account-scoped GitHub credential broker returned `GitHub credential
unavailable` when creating the feature Issue. Its body was prepared privately;
no alternate account or global credential was tried. Remote Issue/publication,
exact published fresh-clone verification and production activation remain pending.
No running service was replaced or restarted.
