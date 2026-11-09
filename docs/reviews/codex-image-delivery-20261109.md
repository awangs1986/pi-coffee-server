# Codex generated-image delivery diagnosis and review

Date: 2026-11-09. Candidate Server 1.02; baseline 1.01 / `d9aa4b9`.
Tracking: [Server #165](https://github.com/awangs1986/pi-coffee-server/issues/165).
Contract: [native generated images](../spec/task-storage.md#native-codex-generated-images-102-2026-11-09).

## Observed failure

Owner-scoped latest-history inspection found a completed image generation and
a subsequent assistant download link into Codex's native generated-image store.
The PNG exists, is a regular owned file and is 2,743,968 bytes, below the existing
preview limit. Both authenticated task-grant requests consistently returned
HTTP 403, `File unavailable or outside workspace`. This is a reproducible
delivery failure, not a missing generation result or general login failure.

Two independent paths explain the symptoms. App Server returns completed
`imageGeneration` items; the canonical rollout persists Extension kind
`image_gen.generation`. Both carry a saved path but were omitted by the live/page
projection and unsupported by passive rollout normalization. Meanwhile, the
file service correctly refuses direct reads outside registered task roots.
The missing integration is delivering the native output into owned task data.
The original artifact and transcript are retained. Private task/native IDs,
prompts, PNG contents, transcript extracts and credentials are excluded here.

## Change and serial standards review

Native details stay behind the Agent interface. The Codex projection emits
an assistant image reference with the same durable identity across live and
restored history, without base64/tool payloads. Passive canonical Extension
normalization admits the known image-generation shape. Compact mode preserves
the deliverable result using existing Markdown/image controls.

A scoped optional artifact resolver imports only qualified raster output from
the configured native home and a registered current/retained binding. It writes
an independent private task copy and returns a task-relative path. Existing
native links then resolve through the same file service. Native store access
never becomes a generic route or Browser filesystem permission.

Imports are coalesced and bounded, use 64 KiB copying, and participate in task
lifecycle and platform backup custody. Directory descriptors, no-follow opens,
regular-file/owner/link/signature checks, source stability and binding rechecks
protect publication. A same-inode owned staging link can be reconciled after
an interrupted unlink. Existing task copies are never overwritten by import.
Shutdown waits for admitted imports and closes their descriptors.

The current storage/delivery specs, documentation map and backlog are updated.
The accepted complete-history/1M Handoff design stays unimplemented. This fix
does not enable that design or upgrade the native CLI.

## Regression and verification evidence

- Native-adapter public page/history regression first returned an empty list
  for a completed image output, then passed after projection repair.
  A real read-only native probe also exposed the distinct App Server shape;
  the fixture was corrected and observed red before both formats were admitted.
- Authenticated Host/transfer HTTP regression first returned 403 for the owned
  image preview, then passed with correct PNG bytes and an independent task copy.
- Coverage includes live stable identity, passive canonical restore without a
  runtime, foreign account/binding refusal, traversal, native credential refusal,
  symlinks/hardlinks, disguised non-images, import/preview ceilings, simultaneous
  requests, source cleanup and interrupted staging-link recovery.
- A targeted mutation removed native-binding authorization temporarily. The
  public denial regression failed when the foreign PNG became readable. The
  guard was restored before further verification.
- A six-image concurrent reply regression exposed conflicting import lifecycle
  holds. It passed after task imports shared one held operation and a bounded
  four-active/sixteen-waiting copy queue replaced immediate rejection.
- Chromium exercises the real native projection and renderer/binder: generated
  PNG decoding and actual image download bytes pass, alongside existing APK and
  HTML downloads. Generated HTML is not executed in the parent page.
- The reported owned image also passed the corrected native paginated inspection
  and isolated authenticated Host/transfer probe: preview/download both 200,
  2,743,968 bytes matching the source, with original image/binding unchanged.
  This used one read-only native inspection and zero model preparation turns.

The corresponding Issue records final exact-commit canonical and independent
clone verification outcomes. Synthetic tests use no model/provider calls and do
not establish every upstream extension format or future CLI compatibility.

## Security

Serial review followed authenticated scope selection, task lookup, grant
issuance, Adapter import, rooted file resolution and response authorization.
No blocking finding remains. New imports require current/typed-retained native
ownership; already materialized copies remain task data. Arbitrary native paths,
credentials, unsafe links, non-image bodies and oversized files stay denied.
The Browser receives a reference, not the raw generation payload. Grants are
rechecked after asynchronous work. No dependency or native permission change.
No credential/private artifact is added to source, client assets or Issues.

## Deployment boundary

Web/Host remained active at 0.98 during diagnosis. No service restart or model
execution was performed. One recovery copy of the owner's PNG was placed in the
current Conversation's workspace for immediate retrieval, outside source commits.
That recovery does not replace activation of the structural fix.

Production acceptance must verify the original Conversation's restored image
and existing native link through its real scoped preview/download grant after
authorized activation. Do not represent synthetic or private isolated HTTP
acceptance as a changed production response. Independent Forks retain already
materialized image data; unmaterialized inherited references do not gain access
to an unrelated source binding.

The reported source also contains legacy response-call identities that do not
match canonical execution identities. Its passive audit therefore stays unknown
under the existing completeness checks; this change does not relax that guard.
Canonical synthetic image restore and the real native paginated read are
different evidence. Use the latter for original-source acceptance and never
publish a partial passive audit as complete history.
