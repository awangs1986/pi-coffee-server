# Host/Web quick-review corrections — 2026-10-13

Scope: follow-up to the serial review of local v0.24 candidate `b18958b` against
baseline `1139720`. These are source corrections, not production activation.

## Findings resolved

- Security: malformed unauthenticated HTTP targets previously threw before the
  request boundary. Web HTTP and Web/Host Upgrade now return 400 and contain
  unexpected handler failures. Three isolated subprocess regressions failed before
  the fix and passed afterward, including subsequent health and authentication
  checks. No malformed request was sent to production.
- Spec: display-history reads previously occupied the ordered task-command lane.
  They now run independently with a deadline and one outstanding read per socket.
  A public WebSocket regression verifies prompt acknowledgement/delivery before a
  blocked history read completes, overlap rejection, timeout, late-result discard
  and successful retry. It failed before the fix.
- Follow-up race: a successful slow snapshot must not overwrite newer dialogue
  already delivered. A live-event cursor fence rejects that snapshot with a
  retryable display error. Its public WebSocket regression failed before the fix.
- Standards: Browser and Host now use shared tool/transcript/process event
  predicates in `public/display-events.js`. Lifecycle, questions and general
  errors remain outside transcript filtering. Native records are unchanged.

The delivery spec and documentation index record these rules. The version remains
0.24 because this corrects the same unpublished release candidate. No new native
model turns, account configuration changes or service interruptions were needed.
Publication and deployed-version claims require separate evidence.

## Verification

Final `npm run check` passed: lint, production build, 139 Vitest files / 1,158
assertion cases, and all 13 synthetic Chromium probes. The display-mode browser
probe passed both legacy and indexed protocols without aborting native work.
Private run log: `/home/awang/tmp/review-fixes-final-check.log`.
This does not establish fresh-public-clone or production activation acceptance.
