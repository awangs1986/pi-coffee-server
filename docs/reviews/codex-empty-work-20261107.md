# Prepared Codex Work cannot open after cleanup

Baseline: GitHub/Gitea 0.97 `ff245ab`; observed Web/Host 0.96 `a6ad4d1`,
Codex CLI 0.163.0. Candidate: Server 0.98. Tracking: Server #161.

## Diagnosis

The owner-reported task had completed preparation, an independent checkout,
`creationState: ready` and a bound native ID. An authenticated WebSocket open of
that same task, with no prompt or new Conversation, reproduced
`operation_failed: Native conversation is unavailable`. Its preparation receipt
matched the exact native binding, there were no accepted requests or recorded
runs, and its native settings sidecar explicitly said `emptyContext: true`.
Private identifiers and records are not included in this report.

Ranked checks considered premature empty-thread cleanup, differing native stores,
and CLI empty-history behavior. The causal implementation gap is that preparation
starts and closes a native session before user input, but Work creation omitted
the Host empty-context marker and the production recovery authority admitted only
Chat. The native adapter already treats known empty threads differently from
missing used history. The reported task's existing mapping/sidecar was readable;
its Work authority was the missing condition.

The production-entry HTTP/WS regression reproduced the same error using a local
Git remote and a native fixture that loses unmaterialized empty history across
process cleanup. It failed before the fix. A second regression removed the
marker to reproduce the older prepared-Work format and also failed before the
compatibility fix. No real model turn was used.

## Fix and boundaries

- New Codex Work records carry the same known-empty authority as new Codex Chat.
- The adapter requires both the exact native ID's explicit empty settings proof
  and current scoped Host permission, only for recognized missing-history errors.
- Completed creation receipts can derive the missing marker for older untouched
  Work records, only when the publication digest still matches and there is no
  prompt/run, Fork, takeover, reset, recovery or binding-replacement evidence.
- Rebinding retains the old ID, project files and settings and persists the empty
  marker. Prompt admission revokes it before native execution. Used, unknown or
  mismatched history is not silently replaced; no input is replayed.

Serial standards/spec/security review found no remaining blocking issue in this
scope. The Host still resolves its account-scoped workspace, and Codex rejects
foreign working directories before recovery. No new public route, credentials,
dependency or general permission change is introduced. Creation proof remains
owned by TaskPreparation; storage/rebind policy by Workspaces; native error and
settings interpretation by the Codex adapter. The current specs retain separate
source, activation and real-user acceptance states.

## Verification and limitations

- Focused production-entry, Chat, adapter and preparation suite: 61 passed.
- New Work, legacy prepared Work, unknown publication proof, repeated cold open,
  first input, and missing used history are exercised through public HTTP/WS.
- A targeted compiled-fixture mutation removed publication-digest validation:
  the proof-mismatch test failed because it incorrectly opened a replacement.
  The original compiled file was restored; the same test passed again.
- An earlier focused run had one existing fake-CLI process exit in the directory
  isolation test (59 passed, one failed). An isolated rerun and the complete
  focused run with captured fixture stderr passed; no diagnostic error recurred.
  The temporary stderr instrumentation was removed. This observation is retained
  rather than labelled a demonstrated production failure.

The final source-bound complete check and exact fresh-clone check are release
gates, recorded in private receipts and Server #161 after execution. At review,
production remains 0.96 and the original task has not been mutated or reopened
with the new code. Activation and an open-only reproduction against that same
task are still required before claiming the production symptom resolved.
