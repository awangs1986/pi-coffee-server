# High-risk batch Agent execution

Accepted owner policy, 2026-10-12. Applies immediately to repository Agents and
future implementation decisions. This document is an authorization rule, not a
claim that every native CLI already enforces it mechanically.

## Scope

Treat bulk creation or concurrent awakening of conversations or Agents as high
risk. This includes MISHU deliveries that start target turns, automation,
subagents (including code reviewers), bulk Fork, batch starts and retries that
repeat or expand a batch. Reusing an existing conversation does not exempt an
operation that starts model execution. Dividing one batch into smaller requests
does not bypass this rule.

A request to inspect, diagnose, review or test authorizes the relevant ordinary
work; it does not authorize creating a pool of Agents. Use serial work in the
current conversation unless batch execution has been explicitly approved.
Do not interpret a skill's parallel-review recipe as user authorization.

## Approval and execution

Before a batch starts, tell the user its purpose, the maximum number of new or
awakened conversations/Agents, their engines and models, the maximum simultaneous
runs and the stopping conditions. Explain the possibility of shared-account rate
limits and extra model usage. If the total or model is unknown, resolve it before
execution; an open-ended batch cannot be approved meaningfully.

Wait for an explicit answer. A timeout, preselected choice, generic approval of a
review, or permission to configure MISHU is not batch approval. Existing explicit
approval applies only to the stated scope; changes to models, total count or
concurrency require renewed approval. Do not ask again for unchanged scope.

Approved batches use bounded queues, a finite attempt budget and an observable
cancel/stop path. Stop admission on capacity/rate-limit errors; do not respond by
creating replacement conversations or switching to additional Agents. Preserve
receipts so retries cannot duplicate accepted work. Show actual starts and
failures separately from queued intentions.

## Passive monitoring

Listing conversations, reading persisted summaries and inspecting status remain
read-only operations. They must not create native threads, submit prompts or
wake an Agent to produce a status report. Coalesce duplicate reads and use bounded
I/O queues where needed. A bounded metadata read is not model execution.

## Verification requirements

For features that implement batch execution, verify that no model run starts
before approval; the approved count and concurrency cannot be exceeded; duplicate
requests/reconnects cannot repeat execution; and stopping prevents further
admissions. Verify passive monitoring independently with zero thread creation
and zero prompt submission. These are acceptance requirements, not evidence of
already implemented enforcement across external native tools.
