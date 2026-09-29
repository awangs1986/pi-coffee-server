# Arena ed45 merge review

The owner authorized merging `arena/01a0ed45-pi-coffee-server` into GitHub
`awangs1986/pi-coffee-server` main. Gitea remains a commit-identical mirror.
This is a source merge, not a deployment or production acceptance result.

## Pinned inputs and scope

- GitHub and Gitea main: `38d1a18d1ac91203f3895aba0162d8ad05869ad3`.
- Feature branch: `5673e72cf8b3df0cdc9385721a310de15883d135`.
- Normal two-parent merge; both histories retained, with no conflicting files.
- Included: Arena composer, docked Diff, GitHub Work repositories, Pierre Diff,
  live Codex turn refresh, LocalSend fallback/link refresh, and Claude bundle directories.
- Preserved: the newer main Host/native adapters and immutable Pi package pin
  `1ec49a93048f0e441806cd17da7b245972e5f51a`.
- Related execution record: [frontend continuity Issue #5](http://gitea:3000/awangs/pi-coffee-server/issues/5).

## Review corrections

1. Single-file Diff accepted Git wildcard/magic pathspecs and directory paths,
   potentially including hidden private files. User file paths now use literal
   Git pathspecs, with single-file validation for Branch and last-turn scopes.
   Internal snapshot exclusions retain their deliberate fixed pathspec syntax.
2. LocalSend proxy grants/defaults/upload sessions were process-global. Routes
   now belong to the authenticated owner; another user's explicit grant or
   upload session returns 403. Host token validation remains in place.
3. Delayed GitHub registration could overwrite a newer draft selection. The
   completion now checks the draft epoch, picker sequence and previous project.
4. Unsupported browsers silently selected the basic Diff renderer. They now
   receive an explanatory notice once; bundle-load failures retain their notice.

Standards and spec reviews ran separately. Security recheck found no remaining
blocker in these corrections, and spec recheck found no material remaining gap.

## Verification and limits

- Regression tests reproduced the private Diff path bypass before the fix.
- Deferred GitHub registration and missing-browser-capability tests failed
  before their fixes and passed afterward.
- Public Host HTTP tests reject wildcard, magic and directory Diff requests in
  both scopes while valid file patches still load.
- Web HTTP/WS tests verify normal transfers and deny a different authenticated
  user holding the same download/upload grant.
- `npm run check`: build plus 292 tests in 39 files passed.
- `git diff --check`: passed.
- Publishing also requires repeating `npm ci` and `npm run check` from an
  independent clone, then fetching and comparing GitHub/Gitea main SHAs.

Real GitHub credentials/permissions, production VM behavior and live Codex
turn refresh still require deployed acceptance. No transcript, credential,
cookie or snapshot evidence is committed. The earlier feature handoff remains
a historical record; this report covers the actual ed45 merge candidate.
