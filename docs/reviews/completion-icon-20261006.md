# Durable completion icon — 2026-10-06

Scope: [Server #79](https://github.com/awangs1986/pi-coffee-server/issues/79),
based on GitHub/Gitea main `3ff1661632bc9bbb746a6f6d8418ca63bdd18246`.

## Diagnosis

The sidebar rendered its coffee SVG only for `attention: finished`. This flag
represented unread completion and lived in `HostSession.unseenSettle`, cleared
on attachment and discarded on idle retirement. Stored session listings could
therefore no longer describe an already-ended run after reconnection/restoration.

Before the fix,
`npx vitest run test/local-first-app.test.ts test/host-server.test.ts -t 'completed coffee|retains completed'`
failed both regressions: the actual app lacked `.finished-coffee`, and the public
Host WS summary lacked `runStatus: settled`. All inputs were synthetic.

## Result

Workspaces records an observed native run boundary independently of unread
attention. Registry summaries read that scoped compact metadata without starting
an Agent or reading native transcripts. Native settlement displays a coffee cup
also after viewing, browser/Web reconnect, idle retirement and Host restart.
Waiting/running take priority, and interruption clears completion. A prior running
record restores as interrupted. Idle legacy records are not inferred completed;
reset and takeover clear the previous binding's marker. Settlement indicates a
native run ended, not acceptance of its business result.

## Acceptance

- Public Host WS: complete while attached, reconnect, idle retirement, reopen,
  and a new Host backed by reloaded persisted state.
- Public workspace HTTP: identical Conversation IDs remain separate between
  users; running restoration becomes interrupted; Chat reset clears the marker
  without relocating files.
- Actual Browser controller: durable status restores the icon without unread
  wording; current running and interrupted states override it.
- Chromium: real HTTP/WS fixture; grouped and chronological modes; open and
  reload retain the icon; untouched tasks lack it; running/interrupted override;
  chronological order remains stable; zero page errors. Probe:
  `node scripts/probe-completion-icon.mjs`.
- `npm run check`: 105 test files, 850 tests passed, including production build.
- Independent `security-review`: no findings; scoped request-to-storage path
  checked; no dependency or credential changes.

## Activation boundary

This change requires both Browser assets and Host code. Source publication and
candidate staging do not activate the running Host. Production Host/Web backend
release remains `5073c97`; its running tasks are preserved. Frontend activation
and any later Host restart must be recorded separately in the Issue with exact
release identity and served-asset/health probes. No production native transcript
or existing workspace state is migrated or rewritten to infer historic completion.
