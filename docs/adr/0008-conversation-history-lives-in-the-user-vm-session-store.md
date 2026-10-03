# Conversation history lives in Pi's session store in the User VM

Status: accepted (owner decision, 2026-09-03)

The durable record of every conversation is Pi's own session file (`*.jsonl`) in the User VM's `PI_COFFEE_SESSION_DIR`. The Host lists conversations from that store (`SessionManager.listAll`), resumes any of them by id (`pi --session <file>`), and on every `open` projects the completed entries into a `history` frame for the browser. The Web Server holds no conversation state. The browser may retain only the disposable display snapshots described in the 2026-10-02 amendment below; they never replace the native record. Reconnect replay is reduced to the in-flight tail (Events after the last completed message), because everything before that is served from the store.

Consequences: any browser, on any machine, sees the complete past conversation the moment it opens it; a Host restart or an idle shutdown of the Pi process loses no messages; the Control Plane still never stores prompt or transcript content (ADR-0003). What this does not yet cover is recovering a run that was mid-stream when the Host itself died — that remains `REC-001`.

Native-engine scope update (2026-09-23): [ADR-0013](./0013-native-agent-engines.md) extends the Host to Codex and Claude Code while preserving Pi behavior. Its explicit authentication, native-permission, history and repository boundaries govern that planned extension; this earlier Pi-specific decision does not imply native-engine support is already implemented.

2026-10-01 clarification (superseded by the amendment below): recent previews
were restricted to bounded page memory, without transcript persistence across reloads.

## 2026-10-02 amendment: disposable recent display snapshots

The owner-approved cache-first switching work in [PR #26](https://github.com/awangs1986/pi-coffee-server/pull/26)
supersedes that page-only restriction. The browser may keep five user-scoped,
plain-text display snapshots in page memory and IndexedDB, following the
[conversation-switching contract](../spec/conversation-switching.md).

- Native Transcript and Model Context remain authoritative in the User VM.
  Browser snapshots are explicitly marked as cached and replaced by Host history.
- IndexedDB snapshots expire after 24 hours and are bounded to 8 MiB each,
  40 MiB total, with five-conversation LRU eviction. The projection and page-memory
  bounds remain defined by the switching contract; cookies do not store transcripts.
- A reload restores cached text only after authenticated identity verification.
  Logout, account changes, archive/deletion and Agent takeover invalidate snapshots.
- Persist only normalized display text. Do not persist DOM/HTML, images, tool
  argument objects, file-grant URLs, action handlers, or unacknowledged prompts.
  The uncertain-delivery outbox remains page-only and independent of this cache.
- Sending stays disabled until authoritative history arrives. Cache failure is
  a cache miss, never a reason to alter or discard the native conversation.

This changes browser display caching only. It does not add a Control Plane
transcript store, change Session lifetime, or make cached text a recovery source
for native Agent execution.

## 2026-10-03 amendment: durable derived display index

[ADR-0024](./0024-durable-display-index.md) permits a rebuildable, user-scoped
Host display index inside the User VM and negotiated bounded v2 synchronization.
Native Transcript/Model Context remain authoritative; Web/Control Plane does not
persist content. Read-only prefetch never resumes a native session, and an index
never proves prompt delivery. Legacy explicit open remains the compatibility path
for unsupported/unverified source formats.
