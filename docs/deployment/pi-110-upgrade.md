# Pi 1.1 / Server v0.12 upgrade candidate

Tracking: [Server #67](https://github.com/awangs1986/pi-coffee-server/issues/67), [Pi #11](https://github.com/awangs1986/pi-coffee/issues/11). [Plugin contract](https://github.com/awangs1986/pi-coffee/blob/upgrade/pi-1.0.4/docs/spec/pi-110-native-integration.md).

Select native Pi family 1.1.0, Web 0.37.0, Subagents 0.76.1, optional Antigravity 0.10.0 and typebox 1.3.36. Consume Harness 0.3.3, LSP 0.4.7, Handoff experimental.6 and independent MISHU 0.3.0-manager.3. Preserve current Server main, including formal versions, guarded publication, model restoration, MISHU manager/tracking and all native adapters. This supersedes the unmerged 1.0.4 consumer candidate; its migration work remains in ancestry. The old MISHU 0.1.7 PR is obsolete and must not replace manager source.

## Native cancellation

Pi 1.1 includes `aborted` on `agent_settled`. Forward this native event unchanged: cancellation is not process death. Host releases busy state, keeps explicit retries possible, marks its command receipt uncertain and omits unread-completion attention. MISHU records interruption instead of completion and does not commit the secretary digest cursor on cancellation. The native custom settlement marker also persists the optional cancellation flag. Passive/restart evidence treats cancelled task/report runs as incomplete even after a prior successful assistant stop; its watermark includes the new flag, while older missing-flag markers stay compatible. Cancelled report evidence cannot commit a report or trigger regeneration. Older settlement events remain compatible; ordinary success still completes. Verify actual native parent abort plus synthetic no-aborted-message regression.

## Native tools and context

Keep existing package discovery and active-tool boundaries despite new `+name`/`-name` CLI selectors. Additional duration/render metadata is optional. OSC terminal program status is not Web business acceptance. New classifier/catalog features do not enable tools or change approved model/thinking defaults. Preserve strict Chat zero-system, Work tools, read-only Git, bounded Serper evidence, native compaction, explicit Handoff and LSP lifecycle. The native 3.5-character context estimate does not replace local numeric attribution or Handoff fidelity evaluation.

The prior Azure migration remains applicable: `configure-native-pi.mjs` creates private `.before-pi104` original backups, preflights provider conflicts and migrates references without changing credentials or the Azure API identifier. Deployment environment references and historical native session/cache fallback still require the documented treatment in [the prior migration runbook](pi-104-upgrade.md). No live config is edited by this candidate.

## Verification and release

Advance the formal Server version from 0.11 to 0.12 with the native version command; retain VERSION/npm metadata consistency. Run affected public-seam red-to-green tests, a complete Standards/Spec/Security review, source-bound review receipt and `npm run check:release`. Its canonical plan includes lint/build/tests and five no-model Chromium probes. Verify an independent exact published clone and four reproducible tarballs/lock hashes. Candidate cache seeding establishes installability, not public asset availability.

Merge/release Pi packages and current MISHU first, publish their immutable artifacts and verify hashes, then merge this consumer. Never merge the obsolete MISHU 0.1.7 candidate over manager.3. Source updates and formal version preparation do not activate services or global terminal runtime. Later production activation needs an authorized idle maintenance window, preserved task/config data, health/asset identity and rollback. Real-model autonomy, semantic compression fidelity and external-language/platform acceptance remain separate.

The official Web 0.37 package pins an affected MCP SDK. A scoped override selects the compatible official patched SDK 1.31.0; this preserves upstream schemas/executors and removes GHSA-6qxp-vccf-f47h. Verify the actual lock audit and native Web fixture before publication.
