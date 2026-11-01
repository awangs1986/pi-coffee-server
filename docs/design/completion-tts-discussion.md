# Completion speech — design interview

Status: proposed, awaiting owner decisions. No implementation or deployment is authorized by this discussion.

## Requested outcome

A second PI Coffee user wants a concise spoken notification after a conversation
finishes, associated with the existing coffee completion indicator. The owner
proposed the i-have-adhd Skill as an aid for shortening the content and asked
whether this should integrate with MISHU.

## Verified current boundaries

- `public/completion-reads.js` derives unread state from a conversation completion
  identity and viewed receipts. A completion is a settled run, not proof that an
  entire project passed acceptance. Historical compatibility markers also exist.
- `docs/spec/arena-navigation.md` persists viewed completion receipts per account.
  Reloading or opening another browser must not manufacture new completions.
- `docs/spec/mishu.md` restricts secretary sources to explicitly enabled Pi Chat
  conversations. Other native engines can be authorized targets. Passive reads
  must not awaken model turns; bulk awakening requires explicit authorization.
- https://github.com/ayghri/i-have-adhd is a response-style Skill, not a speech
  engine or standalone summarization service. Its recommendations include leading
  with a concrete action, suppressing tangents, concise steps and one next action.
  Its session-wide style and assumptions about the reader must not automatically
  become instructions for all Coffee agents or a diagnosis of any user.

## Recommendations — not yet accepted

1. Own completion speech in the shared Web/Host notification layer. Let MISHU use
   it through the same boundary, without requiring a secretary for ordinary TTS.
2. Use a durable, account-scoped completion identity for triggering and delivery;
   never trigger from a DOM icon, a generic idle transition or replayed history.
3. Create a separate spoken brief from the completed reply. Preserve the original
   answer. Adapt relevant upstream style principles for listening; do not read
   markdown decorations, long commands or tool logs verbatim.
4. Keep spoken delivery separate from the existing viewed receipt. Whether speech
   should acknowledge reading is an explicit unresolved product decision.
5. Deliver sound on the user's browser/device, not on the shared VM speaker.
   Browser permission, user activation, suspension and closed-browser behavior
   must be decided before promising background delivery.
6. Prefer bounded, serialized, cached summarization if model inference is needed.
   Do not create native Codex/Pi conversations or wake target agents per completion.

## Confirmed interview decisions

- The user explicitly turns speech on; it is not an automatic account-wide default.
- Only newly unread completed results should trigger automatic speech.
- Version one targets an open Web page, including other tabs, with browser background limitations still to be handled.
- Ownership/integration with MISHU remains undecided. Manual enablement does not by itself imply MISHU ownership.

## Round 1 — recorded questions

- Q1: Independent completion-speech feature with optional MISHU reuse, or a
  MISHU-only feature? Recommendation: independent feature, reusable by MISHU.
- Q2: Only a new unread completion, or every completed run even while the user is
  reading that conversation? Recommendation: new unread completions.
- Q3: Must the first release work while the Web page remains open, or also while
  the browser is closed/the device is locked? Recommendation: open-page scope,
  subject to documented browser background restrictions.

## Deferred decision branches

Per-account opt-in and conversation selection; successful/error/aborted/question
states; which reply and attachments feed the brief; language and length; summary
model, cost and faithful fallback; TTS provider and credentials; playback device
and multi-tab/device arbitration; ordering/coalescing and queue bounds; mute,
stop, skip and replay; already-read and superseded results; stale completions on
reconnect; speech vs reading acknowledgement; audio/transcript retention; MISHU
authorization and recursion prevention; acceptance and failure behavior.

Record accepted terms in the project's configured glossary only after agreement.
Do not create an accepted ADR or describe this proposal as implemented.

## Round 2 — pending decisions

- Q4: A short brief for each completed conversation, or one secretary synthesis
  across managed conversations? Recommendation: per-conversation briefs first.
- Q5: One manually enabled switch for all of the user's eligible conversations,
  or a master switch plus explicitly selected conversations? Recommendation:
  master switch plus selected conversations, so ordinary chats need not speak.

These choices determine whether MISHU is a content producer or a prerequisite.
No accepted architecture or implementation is implied yet.

## Round 2 — owner answers

- Each completed conversation gets its own brief; this is not a cross-task
  secretary digest.
- Each conversation has an individual speech toggle, alongside a per-user
  master switch.
- The owner explicitly requires the plugin to be as decoupled from PI Coffee
  as practical.

## Proposed integration boundary

Use an independently versioned voice-notification package and a thin Coffee
adapter within the existing deployment. Coffee owns authenticated scope, eligible
completion events, titles and final-reply extraction. The plugin owns spoken
briefs, synthesis and playback scheduling. Do not make it depend on Pi, Codex,
Gitea, native conversation creation or MISHU. MISHU can later produce content
through the same boundary. This packaging recommendation remains proposed until
the owner confirms the complete design.

## Round 3 — pending decisions

- Q6: Browser/system voices, external TTS API, or an existing local speech service?
- Q7: Independent compatible summarization API configuration, or an abstract
  summarization service supplied by the host adapter?
- Q8: Roughly 15–30 seconds per brief, or a longer 45–60 second digest?

No implementation or deployment has begun.

## Round 3 — owner answers

- Use browser/system speech synthesis for the first release. Voice availability,
  language quality and any platform-specific network use depend on the device.
- The host supplies an abstract summarization interface. The decoupled plugin
  does not own native-agent credentials or create agent conversations.
- Target 15–30 seconds per task brief: title, outcome, and any action required.
  Preserve failure and unverified claims; do not invent completion or estimates.

## Round 4 — pending decisions

- Q9: Which browser/device owns playback for an account? Recommendation: one
  explicitly enabled browser, rather than every connected device.
- Q10: Does completed playback acknowledge the written result? Recommendation:
  keep speech delivery separate from viewed receipts and retain the coffee icon.
- Q11: What happens when several tasks finish together? Recommendation: a bounded
  serial queue, checking eligibility again before playback.

Implementation details such as exact queue bounds and lease timings remain
proposed; no guarantee of background playback on every mobile/browser platform
has been made.

## Round 4 — owner answers

- One explicitly designated browser owns automatic playback.
- Successful playback does not mark the full result read or remove the coffee
  icon. Speech delivery and viewed receipts are separate facts.
- Use serial playback. Check eligibility again before speaking; skip already-read
  or stale queued results, and replace an unplayed result with a newer result
  from the same conversation.

## Round 5 — pending decisions

- Q12: Announce both normal replies and naturally settled failures, or normal
  replies only? Recommendation: include concise failure notices; exclude waiting
  for user decisions and deliberate cancellation.
- Q13: On reconnection, catch up only recent missed completions (proposed five
  minutes), skip missed completions, or retain a longer backlog? First enablement
  must not speak pre-existing coffee markers.
- Q14: Use the existing OpenCode Go DeepSeek V4.1 Flash through the host summary
  adapter as the default, or choose another API model? Recommendation: existing
  Go DeepSeek with serialized, bounded, no-tools requests and no native sessions.

## Round 5 — owner answers and refinement

- Announce both normal results and naturally settled failures; waiting for user
  input and deliberate cancellation remain excluded.
- Reconnection catch-up covers only the most recent five minutes of eligible,
  unread, unspoken completions created while speech was enabled.
- The owner rejected the proposed fixed Go DeepSeek summarizer: use the original
  task's model and a Skill to produce the brief. A separate default summary model
  is no longer part of the proposed design.

## Round 6 — pending generation timing

Recommendation: attach a speech-specific Skill requirement to explicitly enabled
tasks and have the original agent produce its brief within the original turn.
Only after that turn settles may the brief enter playback. This avoids a new
summary turn, extra native conversations and recursive completion notifications.
The alternative is a separately identified follow-up summary turn in the original
agent, which would require admission, queue, lifecycle and recursion controls.

This refines the earlier host-summary-interface decision: the host adapter should
abstract native Skill integration and brief extraction. It should not silently
replace the owner's chosen task model with an auxiliary model. The decoupled
plugin can consume an optional spoken brief without knowing native engine APIs.

Adapting upstream style rules must preserve the full answer and truthful failure/
unverified information. Do not inherit diagnosis claims or global session-wide
style persistence from the upstream Skill. Timing, output envelope and fallback
for absent/malformed briefs remain unresolved.

## Round 6 — owner answer

Accepted: explicit speech enablement adds a summary Skill to that task's context.
The original agent/model produces the brief within the original turn; playback
waits for settlement. Do not start an extra summarization turn or select a separate
summary model. This supersedes the earlier auxiliary-model recommendation.

Skill injection is an explicit task-specific output request, not a global change
to ordinary Chat instructions. The Coffee adapter owns integration with native
input; the independently versioned plugin owns the speech profile and playback
contract. The profile must be turn-scoped rather than adopting upstream's
permanent-session style rule.

## Round 7 — pending edge decisions

- Q16: If speech is enabled while a turn is already running, use a generic
  completion notice for that turn, or begin only with the next turn? The in-flight
  request is not rewritten and no summary steering prompt is generated.
- Q17: Hide the spoken brief from the normal transcript with menu access, show
  a collapsed card, or display it inline? Original answer preservation still holds.
- Q18: For a missing or malformed brief, use a short title/outcome notice or
  remain silent with a visible notice? No automatic extra agent turn is allowed.

## Round 7 — owner answers

- Enabling speech during an in-flight turn takes effect from the next turn only;
  the current turn is not spoken retroactively.
- The owner rejected hidden/menu-only briefs: the Web transcript should show the
  summary first, with an explicit Show full information control to expand the
  original answer. This is a presentation proposal, not native-history compaction.
- Missing or malformed briefs use a short truthful title/status announcement;
  do not generate an additional summary turn.

## Round 8 — pending presentation boundaries

- Q19: Summary-first rendering only for speech-enabled tasks, or for all
  conversations? Recommendation: only selected tasks/results with an eligible
  brief; avoid expanding Skill injection to unrelated conversations.
- Q20: Does actively viewing a current summary acknowledge the result, or must
  the full answer be expanded first? Recommendation: viewing the current summary
  counts, while audio playback alone still does not. This changes viewed-proof
  semantics for this presentation and requires explicit agreement.

Native transcripts and the original answer remain intact. Streamed output,
existing detailed/compact tool-process display and completed-answer folding are
separate concerns. A summary must be bound to the current completion/revision;
old caches or hidden/background views cannot acknowledge a newer result.

## Round 8 — owner answers

- Summary-first presentation is limited to speech-enabled tasks.
- Actively viewing the latest summary counts as read; audio playback alone does
  not. Latest/visible/reconciled-content safeguards remain required.

## Final review

The consolidated [specification](../spec/completion-speech.md) and
[boundary ADR](../adr/0025-independent-completion-speech.md) remain drafts pending
confirmation. Proposed UI, queue/cache bounds and failure defaults are explicit
in that specification. This interview did not authorize implementation, native
model tests, service changes or external repository creation.

## Architecture clarification — owner confirmed

The feature is a standalone PI Coffee plugin, independent of MISHU. Minimize
coupling and preserve Coffee's existing structure. No MISHU integration, generic
plugin-framework rebuild or separate daemon is included. Plugin-owned behavior
is connected through the smallest necessary authenticated input/completion/UI
adapters; existing hooks must be checked before claiming zero core modifications.

This confirms the architecture only. Previously proposed queue/cache limits and
UI defaults remain proposals; the unanswered final-review question is not consent
to implementation or deployment.

## MVP approval and specification request

The owner accepted the recommendation and requested publication via to-spec.
The independent-plugin boundary and proposed MVP defaults are now adopted in the
formal specification. Earlier pending-review notes above are historical. Tests
will prioritize existing authenticated HTTP/WS and browser-controller seams.
No implementation or deployment has occurred.

## Cache-stability clarification — owner confirmed

The owner requested the agreed cache-stable summary Skill constraints in the
formal spec and T1. Enablement may change the prefix once; unchanged later turns
reuse a stable, pinned profile rather than accumulating instruction messages.
Dynamic metadata stays outside the fixed prefix. Tests use existing native
submission seams and distinguish prefix stability from observed provider hits.
This adds implementation requirements, not evidence of implemented caching.
