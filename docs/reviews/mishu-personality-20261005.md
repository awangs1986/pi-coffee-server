# MISHU secretary personality repair — 2026-10-05

Tracking: [Server #59](https://github.com/awangs1986/pi-coffee-server/issues/59).

The Coffee entry preserved role, status and authorization instructions but omitted
the original warm secretary personality retained in the historical identity
section. This is independent of setup: a selected, enabled Chat also lacks that
context. Native Pi/Harness and installed Server provider regressions failed on
missing personality text before the repair.

MISHU 0.1.4 restores fixed, bounded warm/attentive/reliable secretary guidance,
Chinese and a natural default address, with latest user name/language/tone
preferences taking precedence. It keeps ordinary conversation natural, avoids
unnecessary model/protocol exposition, and reports progress honestly. The guidance
shares the existing transient context and preserves zero-system ordinary Chat,
selected disabled/unknown state, setup/send enforcement, and 0.1.3 incremental
selection. No legacy memory, operational roles or user history is loaded or edited.

Plugin source: `857056529517a2ba12cec9748c33b583485773ba`.
Artifact: immutable Gitea `v0.1.4/pi-coffee-mishu-0.1.4.tgz`.
SHA-256: `5e118eaade5fadf815472a2f22abdd73d553ea827576237fd10b3963fed26b98`.
Fresh Gitea clone: 120 package tests passed.

Actual Muse verification used only a synthetic isolated conversation: responded
to being tired with warmth and concrete prioritization questions, adopted a new
address, retained that preference and personality after disable, and accurately
explained unavailable coordination and explicit setup when asked. The status
reply said “联系不上” and “还没启用”; a too-narrow literal checker was corrected
and all captured responses passed without another model request. Personality
quality also requires reading these responses, not just matching a decoration.

Evidence: `.scratch/personality-server-red.log`,
`.mishu-work/.scratch/personality-red.log`, `.scratch/mishu-014-check.log`, and
`/home/awang/tmp/verify-mishu-identity-Am4a17/personality-evidence.json`.
These contain synthetic checks; no user transcript enters this report or Issue.
A second isolated actual-model check seeded prior synthetic stiff technical
history; the latest personality still produced a warm, practical reply without
resetting that history. Evidence:
`/home/awang/tmp/verify-mishu-identity-YIb7ns/evidence.json`.
Security review confirms unchanged authority; final Server/fresh-clone checks,
artifact-integrity review and activation are recorded in the Issue. Source or
package publication alone does not establish a production activation.
