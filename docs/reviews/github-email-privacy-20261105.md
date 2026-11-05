# GitHub email privacy repair — 2026-11-05

Server 0.82 candidate; base `6a721c765806af688b1781abe64b7934491ead50`.
[Server #160](https://github.com/awangs1986/pi-coffee-server/issues/160).

## Failure and behavior

Persisted task-creation errors identified GH007 after a successful clone: pushing
a new task branch at an existing private-email tip was rejected. No new user
commit or OAuth failure was required. The owner explicitly authorized anonymous
commit metadata repair. Do not change GitHub email privacy settings.

A shared Git module handles bounded repair for Host operations and managed native
Git pushes. Published origin heads/tags are retained; an already-published tip gets
a same-tree anonymous task initialization commit. Unpublished commit email headers
are replaced, preserving exact trees/messages, names/dates and merge topology.
Original heads have private local recovery refs. The selected scoped GitHub identity
supplies noreply metadata. Signed unpublished commits are refused for explicit
re-signing. Other rejection classes do not trigger rewriting.

Host records the replacement head and verifies the actual remote SHA. Failed
creation retries preserve the ID and checkout. Empty GitHub repositories get
anonymous initialization metadata before publication. Gitea synchronization,
credentials, native model configuration and shared remote branches are unchanged.

## Standards and spec review

Serial review in the current conversation, following the repository's no-fan-out
policy. No blocking findings remain. The implementation keeps native Git execution
behind the existing executor/custody seam and Web authentication/forwarding intact.
The Host and managed wrapper share one repair implementation. Current GitHub/Gitea
contracts and documentation index describe the explicit empty-commit exception,
bounded unpublished rewrite and separate publication/activation evidence.

Review caught an overbroad edit that would return the remote SHA in read-only
status. A public status assertion went red, the unrelated edit was removed, and
local/remote status remains distinct before push. The successful sync response
uses the repaired SHA. Existing ambiguous-push remote confirmation also applies
to the one-time retry.

## Security review

No new routes, dependencies, global credentials or account-settings changes.
Host resolves the existing user-scoped task/account before repair. The native
wrapper validates the selected GitHub grant and actual destination, limits automatic
repair to an explicit origin/current-task refspec, and retains original push
semantics. No extra force flag, bulk ref publication or recovery-ref push is added.
Arguments remain argv, commit payload uses bounded stdin, and ordinary/managed
writer custody still owns all Git subprocesses. Recovery refs and branch updates
use compare-and-swap. No private user emails, tokens or transcripts are included
in the tests, documentation or issue evidence.

## Evidence and limits

The original public HTTP test reproduced GH007/409 before repair. Subsequent
red/green cases cover unpublished checkpoint metadata, managed native Git, empty
repository initialization and distinct pre-push status. Focused acceptance:
**6 files / 28 tests passed**, using real local Git hooks/transports and synthetic
Agent state, including the current ordinary writer-custody path. Coverage includes
merge parents, signed-commit refusal, same-ID retry retention, non-email rejection,
selected-account noreply, preserved dirty files and shared branch history.

The review-bound canonical check, exact published GitHub clone and production
activation are subsequent gates; record their actual results on #160. No real
provider turns or parallel Agent sessions ran. Existing signed histories remain
readable, but rewriting and re-signing unpublished signed commits is deliberately
not automatic. Production service restart still requires its maintenance window.
