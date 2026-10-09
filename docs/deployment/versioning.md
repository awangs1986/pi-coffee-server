# Formal Server release versions

Owner decision, 2026-10-09. [Server #106](https://github.com/awangs1986/pi-coffee-server/issues/106).

`VERSION` is the authority for the Server's formal release number. The initial
formal release is **0.11**; earlier source revisions did not have this scheme.
Display it as `v0.11`. Keep two decimal places, including `v1.00`. Pi packages
continue their own independent package versions.

A small release adds **0.01**; a large release adds **0.10**, without rounding
up to a different tenth. Examples: 0.11 -> 0.12 (small), 0.12 -> 0.22 (large),
0.99 -> 1.00 (small). Use integer hundredths, avoiding floating-point arithmetic.
One release may contain several development commits and fixes; bump once for the
published update. A retry, mirror push, deployment or rollback reuses the exact
release version and SHA. Classify routine fixes and focused enhancements as small;
use large for an explicit substantial architecture or product release.

## Prepare and publish

Run `npm run version:release -- small` or `npm run version:release -- large`.
The CLI synchronizes VERSION, package.json and the root package-lock entries,
preserving unrelated dependency metadata. npm requires SemVer: formal `0.11` maps
to npm `0.11.0`; `1.00` maps to `1.0.0`. This is a representation of one release,
not a second independently chosen version. Inconsistent metadata refuses the
command and build/stage checks. Include all three files in the release commit.

The native publisher compares VERSION with its expected remote ancestor. A new
release must advance by exactly one or ten hundredths; the first formal release
must be 0.11. Missing, unchanged, regressed or oversized increments are rejected.
Run the canonical check and accepted source-bound review before publishing. Push
GitHub first, fast-forward Gitea to the identical SHA, then verify the fresh clone.

## Actual deployment identity

Every staged role records the formal version alongside its immutable source SHA.
Web and Host report their installed manifest versions through authenticated
`/api/release`; Browser assets have their own version in `release-manifest.json`.
The Logo menu shows Web, Host and page versions plus short SHAs. A compatible
Browser-only update can therefore show a newer page version while Web/Host remain
on an older release. Main's version does not imply deployment. Missing/invalid
formal metadata stays `unknown` in the API and displays as unmarked in the menu.
Old commits cannot be retroactively assigned the newest formal version.

Browser-only activation stamps its own staged version and uses only explicitly
provided, validated backend/Host version evidence; absent evidence stays unknown.
Retain backups, health/asset probes and service paths from the release workflow.
A source version is not an API/protocol compatibility guarantee. Record breaking
protocol changes in the relevant contract independently.
