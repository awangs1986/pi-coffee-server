# Codex Handoff Fork from complete history

Status: **Accepted design; implementation and activation pending**, 2026-11-09.
Baseline: Server 1.00, `97ae45bf27ef20be81a7f24adf1d5f04ba810db3`.
Tracking: [Server #164](https://github.com/awangs1986/pi-coffee-server/issues/164), `ready-for-agent`.
Related work: [durable preparation #161](https://github.com/awangs1986/pi-coffee-server/issues/161)
and [native CLI qualification #163](https://github.com/awangs1986/pi-coffee-server/issues/163).

## Problem Statement

A long Conversation may have an extensive retained transcript but a repeatedly
compacted active Model Context. Current Codex Handoff Fork generates its summary
from an inherited native Fork. Reading the complete transcript into Host memory
does not make that complete transcript the summary model's input. The resulting
handoff may therefore repeat omissions introduced by previous compactions.

The owner wants to use the VM's available RAM to reconstruct the history for
handoff, allow a preparation context of up to one million tokens where the native
model supports it, and allow exactly one local input-compression fallback after
a proven size failure. RAM must have admission limits and reclamation; retaining
data indefinitely is not a cache policy. Failure must preserve the source and
provide a reliable stopping point without creating a batch of native sessions.

## Solution

An explicitly confirmed Codex Handoff Fork captures a complete, owned and stable
source snapshot, prepares chronological read-only evidence in bounded Host RAM,
summarizes that evidence in a fresh preparation context, and seeds the new
independent Conversation with the resulting handoff and original-evidence index.
Preparation no longer depends on inheriting the source's compacted Model Context.

Use a preparation-only context ceiling of 1,000,000 tokens, further limited by
the qualified native model and transport. Reserve room for instructions,
intermediate material and output. Histories exceeding the usable input budget
are processed in ordered, bounded chunks and synthesized serially. Never imply
that arbitrary archive bytes fit into one model request.

If preparation fails because input is provably too large, permit one local
compression of the derived evidence and one bounded Handoff retry. The original
snapshot remains intact. Other failures retain existing recovery rules. The
Browser displays progress, any local reduction, coverage and terminal results.
Automatic native compaction and ordinary Conversation settings remain unchanged.

## User Stories

1. As a Browser User, I want Handoff Fork to reconsider retained conversation history, so that earlier native compactions are not its only source of knowledge.
2. As a Browser User, I want to start this through the existing confirmed Handoff Fork action, so that I do not need another command or task workflow.
3. As a Browser User, I want the drift and model-usage warning retained, so that I understand the limitations and cost before starting.
4. As a Browser User, I want the source Conversation unchanged, so that a failed handoff cannot damage my current work.
5. As a Work User, I want an independent clone with current staged and unstaged changes and attachments, so that the destination preserves the established Fork contract.
6. As a Chat User, I want an independent repository-free Codex destination, so that reconstruction does not inject Work or runner guidance.
7. As a Browser User, I want accepted goals and later corrections preserved in order, so that obsolete instructions do not replace current decisions.
8. As a Browser User, I want unresolved questions and the exact stopping point retained, so that preparation does not answer questions or continue project work.
9. As a Browser User, I want changed-file and verification claims attributed to their original evidence, so that a handoff distinguishes recorded facts from inference.
10. As a Browser User, I want historical commands and tool results treated as data, so that reconstruction does not execute them.
11. As a Browser User, I want the prepared model context to reach up to 1M tokens when supported, so that more evidence can be considered in one pass.
12. As a Browser User, I want unsupported native context limits reported explicitly, so that a UI setting is not mistaken for provider capability.
13. As a Browser User, I want oversized histories processed chronologically in bounded chunks, so that the system can cover them without silently discarding older material.
14. As a Browser User, I want visible chunk coverage, so that a partial summary is not represented as a completed reconstruction.
15. As a Browser User, I want one local compression after a size failure, so that redundant tool output does not make an otherwise valid handoff impossible.
16. As a Browser User, I want that fallback limited to one attempt, so that a failed handoff cannot enter an indefinite compression/retry loop.
17. As a Browser User, I want original evidence references retained after local reduction, so that shortened material remains recoverable.
18. As a Browser User, I want size failures distinguished from authentication, quota and timeout failures, so that unrelated faults are not retried as compression work.
19. As a Browser User, I want the normal destination model, thinking, speed and context choices restored, so that temporary preparation settings do not become working settings.
20. As a Browser User, I want one durable operation identity across reconnects, so that a lost Browser response does not duplicate model work.
21. As a Browser User, I want Stop to prevent new chunk and retry admissions, so that cancellation has an observable effect.
22. As a Browser User, I want saved, verified summaries reused when a known seed failure can be resumed safely, so that completed preparation is not charged again.
23. As a Browser User, I want Host restart to expose interruption without replay, so that reopening the page cannot start hidden work.
24. As an Account Owner, I want history snapshots, RAM entries and operation reads scoped to my account, so that another user cannot access them by guessing an ID.
25. As an Account Owner, I want credentials redacted from prepared inputs and summaries, so that historical tool output cannot leak secrets into a new context.
26. As an Operator, I want global and per-operation RAM admission limits, so that a large-memory VM still has predictable resource use.
27. As an Operator, I want working memory released after completion, cancellation and failure, so that repeated handoffs do not accumulate retained transcripts in RAM.
28. As an Operator, I want durable evidence on disk, so that cache eviction or a process crash does not erase recovery material.
29. As an Operator, I want serial model preparation with a disclosed finite call budget, so that large histories do not produce a surprise batch of new conversations.
30. As an Operator, I want rate-limit and capacity errors to stop new admissions, so that recovery does not amplify an upstream restriction.
31. As a Maintainer, I want reconstruction inside the existing preparation lifecycle, so that HTTP routes, native adapters and Browser state cannot invent competing recovery rules.
32. As a Maintainer, I want externally observable acceptance tests, so that memory optimizations and retry behavior are verified without coupling tests to private collections.
33. As a Browser User, I want a final coverage and reduction receipt, so that I can assess whether the new task is suitable for continuing the project.
34. As a Browser User, I want failure diagnostics retained without unrelated data, so that support can diagnose the operation without publishing my transcript.

## Implementation Decisions

### HR-01 — Scope and authority

The initial implementation applies to explicitly confirmed Codex Handoff Fork,
for existing eligible Work and repository-free Chat. Traditional native Fork,
Pi Handoff, Claude Handoff, takeover and in-place manual Handoff retain their
current behavior. This is a Host-owned preparation policy behind the Agent
interface; Web authenticates, forwards and displays progress. No new process,
provider proxy, raw-provider protocol or independently writable task lifecycle
is introduced. Pi-only packages remain in their existing source authority.

### HR-02 — Source capture and evidence identity

Capture the complete available native history under the existing ownership,
idle, queue, question, background-work and source-consistency checks. A Browser
display cache or recent-history page cannot substitute for this snapshot.
Persist the immutable snapshot and digest before model work. Record source cut,
native binding, policy version and ordered entry identities. Native reasoning or
other content the CLI does not export is unavailable, not reconstructed fact.
Record known omissions; do not advertise unavailable evidence as covered.

The existing 256 MiB evidence ceiling and 32 MiB native-page ceiling remain
separate from token and RAM budgets. A hard capture or memory-budget failure
does not authorize an incomplete snapshot or a larger allocation. Preserve the
source and fail with the relevant budget. The local-compression fallback applies
after a verified snapshot exists, not as a way around capture protections.

### HR-03 — Bounded memory ownership

Use operation-owned memory for the snapshot view, chronological evidence,
token-counting material and intermediate results. Declare and enforce both
per-operation and global byte ceilings before admitting reconstruction. Account
for parsed objects, strings, buffers, derived copies and native response buffers,
not just serialized snapshot length. Qualified defaults must be measured against
the existing VM reserve; free RAM is not a permission to allocate without bounds.

Share immutable representations where safe, process bounded pieces, apply
backpressure and avoid a second whole-history serialization. Stop admission or
evict only inactive derived entries before exceeding the pool. Active data
remains protected until its consumer and native writer settle. Release references
and operation reservations on every settled terminal path. Any reusable cache
has an explicit byte limit, TTL, eviction policy and account/source-digest key.
Disk evidence remains authoritative; RAM is disposable acceleration.

### HR-04 — Chronological reconstruction

Transform exported entries into a versioned read-only representation with stable
source references. Retain speaker, chronology, corrections, tool identity,
outcome and relevant evidence. Historical content cannot become current system
instructions or native tool calls. Apply credential redaction before model
submission and preserve source references without disclosing credential values.
Attachment references are evidence; arbitrary attachment bodies are not silently
embedded. Missing artifacts are reported rather than invented.

The summary begins in a fresh preparation context containing these records.
It does not first Fork or resume the source to obtain inherited active context.
All preparation contexts retain enforced tool-free, no-execution/no-network
policy. Unexpected tool or attention requests fail preparation. Existing source
files, native binding and native compactions remain untouched.

### HR-05 — Preparation-only 1M context

The policy ceiling is 1,000,000 tokens for the complete preparation request
context, not 1 MiB of bytes or a guaranteed 1M-token transcript payload. Reserve
instructions, intermediate synthesis, protocol overhead, reasoning where relevant
and output within the qualified model limit. Use native-supported counting or a
qualified model-aware estimator with conservative headroom. Count after the
actual representation and redaction have been constructed.

Keep the preparation model at the existing Sol/medium default unless separately
changed. Qualify the installed Codex CLI and authenticated transport for the
requested limit. Public model capability alone does not establish subscription
or transport acceptance. A lower verified native limit yields a lower effective
budget and additional bounded chunks, with visible explanation; unknown or
unqualified capability fails before model submission. Do not claim 1M is active
after merely setting a configuration value. Restore the destination's normal
working settings before readiness, including its existing context preset.

### HR-06 — Serial chunking and synthesis

If the prepared history fits the usable input budget, generate one handoff from
that evidence. Otherwise divide the ordered evidence into bounded, addressable
ranges; split oversized entries with recorded source offsets where necessary.
Every range is accounted for once, with any intentional overlap recorded.
Generate per-range summaries serially, then synthesize the final handoff using
bounded inputs. Preserve original references, corrections, contradictions,
unresolved questions, file/test evidence and the current stopping point.

The plan declares finite chunk, synthesis-depth, model-call and wall-clock
budgets. A 1M context is not an unlimited-operation grant. Before model work,
show the engine/model, number of new contexts, maximum calls including the
fallback allowance and concurrency of one. Obtain any batch authorization
required by the existing high-risk execution policy. Reconnect cannot grant it.
Reuse one active preparation runtime where supported; native contexts are still
counted honestly. Never fan out chunks into parallel Agents. Capacity and
rate-limit errors stop admissions without replacement contexts or model switches.

### HR-07 — Exactly one local size-recovery fallback

The owner's additional instruction explicitly permits one local compression and
one Handoff retry when input size is the proven cause of failure. Recognized
causes are an input-token budget rejection, a native/provider context-length
rejection, or a definitive input/request-byte-size rejection. Classify through
structured errors or qualified narrow native error mapping. Generic failure,
timeout, delivery uncertainty, authentication, quota, capacity, rate limit,
output-size rejection and arbitrary text mentioning size are not eligible.

Local compression means a deterministic, token-reducing transformation of the
derived evidence on Host. It is not binary archive compression, a new model
summary, source-native compaction or deletion of source history. Consolidate
exact repeated records and repetitive tool output; shorten bulky tool bodies
with explicit source references and a reduction manifest. Retain substantive
user/assistant dialogue, ordering, decisions/corrections, errors, file/test
receipts and the newest stopping point. When those retained contents are still
large, the established chunk plan handles them; they are not silently removed.

Persist consumption of the fallback allowance before starting local compression.
Record the original digest, derived revision/digest, transformation version,
reduced ranges and before/after byte and token counts. Recount and validate the
derived input before the single retry. Keep all limits and source protections;
there is no second compression pass or third Handoff attempt in the operation.
If the local transformation, revised plan or retry fails, stop visibly and retain
evidence. A new operation is never generated automatically.

This is one recovery allowance per operation across all chunks, synthesis and
seed stages, not one allowance per chunk or page reload. Reuse completed work
only when its source ranges, representation, model policy and digests still
match; do not mix incompatible pre- and post-compression summaries. A seed retry
uses the same proven target and cannot allocate a second destination.

### HR-08 — Durable progress and recovery

Extend the existing operation journal with reconstruction policy, snapshot cut,
effective token budget, memory reservation, coverage/chunk receipts, derived
revision, fallback allowance and bounded model-plan receipts. Keep transcript
bodies out of Browser progress events, logs and issue records. Public state
shows capture, reconstruction, coverage, summary/synthesis, local compression,
retry, seeding, settings and cleanup as appropriate, using the same operation ID.

Record each model result before admitting the next range. Restart may inspect
durable evidence and report interruption; it never replays model work. Explicit
resume reuses only verified completed results and already-consumed fallback state.
Unknown delivery, unsettled runtimes and mismatched evidence remain quarantined
under existing preparation rules. Stop prevents further chunk/retry admission;
deadlines do not prove native cleanup. A successful seed is published only after
settings, evidence and cleanup receipts agree.

### HR-09 — Destination and acceptance receipt

Seed one new independent Conversation with the final handoff and evidence index,
using the established settled acknowledgement and no-project-work rule. The
destination keeps its source engine, title intent, project/account binding,
copied workspace state and normal model/thinking/speed/context choices. Native
execution state such as an active Goal is historical intent, not permission to
resume automatically. Preserve Chat's existing environment restrictions.

The final receipt records source coverage, unavailable or reduced evidence,
actual model/context qualification, policy version, whether fallback was used,
and source/destination identities. Complete means every planned evidence range
has a valid receipt and the destination is usable. It does not promise no drift
or semantic perfection. Partial coverage is a visible non-success state.

## Testing Decisions

Use the existing authenticated Host HTTP/WS preparation seam as the primary
acceptance interface. Exercise the real coordinator, workspace preparation and
native Adapter with isolated synthetic CLI fixtures. Observe operation views,
durable public recovery behavior, emitted native requests and the resulting
Conversation. Do not assert on private arrays, caches or internal helper calls.
The previously agreed HTTP/WS, native Adapter and Browser-controller seams are
retained; no new test interface needs user approval for this design document.

Existing public preparation, Fork, writer-custody, source-budget, native-policy
and Browser recovery tests provide prior art. Extend them to establish:

1. Fresh summary contexts receive earliest and latest retained evidence after synthetic native compactions, without an extraction Fork of the source.
2. Source content, binding, branch and task attachments remain unchanged in both success and failure paths; the destination has independent files and preserved settings.
3. Scoped HTTP/WS reads and mutations reject foreign source, operation and destination identities; RAM reuse cannot cross account or source-cut identity.
4. A qualified 1M model uses a bounded preparation context with counted reserves; lower native limits chunk visibly and unqualified transports submit no model request.
5. Oversized history is covered in ordered chunks with bounded synthesis and no simultaneous model runs; partial/missing range receipts cannot publish success.
6. One definitive size rejection permits one local compression and one retry; its wire inputs contain the documented reductions and valid original references.
7. A second size rejection stops; duplicate requests, explicit resume and Host restart retain the consumed allowance without another compression or retry.
8. Authentication, quota, rate limit, capacity, timeout, unknown delivery and output-size failures do not invoke local compression or duplicate native creation.
9. The original evidence stays unchanged and hashed; altered chunk, summary, reduction or seed receipts prevent reuse.
10. Constrained memory admission refuses new work before crossing the declared pool budget. Repeated completed/cancelled/failed operations release reservations and references within a documented settling deadline, measured externally in an isolated Host process with allowance for allocator retention.
11. Cancellation, deadlines and restart preserve source custody until owned writers settle and prevent further model admissions. Verified seed failure recovery does not create another destination.
12. The Browser retains progress through reconnect, shows the effective context and local-compression status, and never reports ready before final publication.

Run the applicable repository verification plan during implementation. A separate,
explicitly authorized real-account probe must qualify context capability, memory
peak, elapsed time and the usable new Fork. Synthetic replies establish
orchestration, not summary quality or provider support. No live model probe is
authorized merely by publishing this specification.

## Out of Scope

- Raising ordinary Pi/Codex Conversation limits above the existing presets, or changing native automatic compaction.
- Changing Traditional Fork, Pi/Claude handoff, Agent takeover or same-Conversation manual Handoff behavior in this initial implementation.
- Fabricating native transcript formats, injecting historical tool calls as executable protocol or proxying provider authentication.
- Unlimited RAM, longer evidence/page ceilings, unbounded chunking, parallel Agents or automatic replacement tasks.
- Retrying uncertain model outcomes or non-input-size errors under the local-compression allowance.
- Cross-account transcript access without the separate explicit Takeover authorization policy.
- Automatic deletion of original evidence, project changes during preparation, or claims of drift-free handoff.
- Implementing or deploying the feature as part of this documentation change.

## Further Notes

The 1.00 repair admits larger verified source evidence but still summarizes
inherited native context. This specification is a subsequent design, not a claim
that the repair already performs reconstruction or supports 1M in production.
It deliberately keeps archive bytes, Host working RAM and model tokens as
different budgets. The single local-compression allowance supersedes the general
no-automatic-retry rule only for the definitive size failures described above.

Official references checked on 2026-11-09: [Sol model capability](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
documents a 1,050,000-token model window and a 500K Codex default;
[Codex configuration](https://developers.openai.com/codex/config-reference/)
documents the model context and automatic-compaction settings. These establish
design inputs, not acceptance for the installed authenticated CLI.

Preserve [Conversation Fork](conversation-fork.md), [durable preparation](task-preparation.md),
[Chat environment](session-environment.md), [batch execution](batch-agent-execution.md)
and [source ownership](../adr/0021-pi-only-source-authority.md). Qualification and
finite resource defaults are implementation release gates, not reasons to
silently relax the accepted design.
