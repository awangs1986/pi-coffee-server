# PI Coffee source and release authority

Start with [REPOSITORIES.md](REPOSITORIES.md) to choose the repository and canonical plugin directory.

GitHub `awangs1986/pi-coffee-server` owns Browser, Web gateway, Relay, Host and native Pi/Codex/Claude/Cursor/Grok adapters. Gitea `awangs/pi-coffee-server` mirrors the same commits. Pi-only Harness, prompts, tools, LSP, handoff and bundled Skills are maintained in GitHub `awangs1986/pi-coffee` under independently versioned `packages/` directories and consumed through immutable package artifacts. Official web and subagent packages remain external upstream dependencies. Old standalone plugin repositories are historical. Picode/V5 remains historical.

## Before changes, merges or deployment

1. Read [REPOSITORIES.md](REPOSITORIES.md), [docs/index.md](docs/index.md), [BACKLOG.md](BACKLOG.md), and the linked Issue for the affected feature.
2. Fetch GitHub and Gitea. Compare commits and feature coverage before reconciling divergent histories. Preserve work on both sides; use normal merge ancestry and never replace a newer capability with an older tree.
3. Read [the Pi package split decision](docs/adr/0021-pi-only-source-authority.md) when choosing repository boundaries, resolving contradictory older docs, or deploying. Host remains in this repository by the owner's explicit decision.
4. Work from current GitHub main in a clean checkout. Preserve other local branches and uncommitted work.
5. When changing product behavior, update the affected current spec and its documentation index in the same change; preserve unmet acceptance criteria and label dated evidence as historical. Use [the domain model](CONTEXT.md) to distinguish platform identity, task data, native context and actual deployment.

## Implementation and release

- Keep native engine details behind Agent interfaces. Web authenticates and forwards; Host owns execution and durable task data.
- Select the authenticated user's scope for every HTTP and WebSocket operation. Browser disconnects preserve running sessions.
- Use the red → green loop at public HTTP/WS and browser-controller seams. Run `npm run check`.
- Preserve the acceptance matrix in [the reconciliation report](docs/reviews/repository-unification-20260927.md): a model reply alone does not verify the workbench.
- Push GitHub main first, then fast-forward Gitea main to the identical commit. Fetch and verify both remote SHAs. Deploy from that commit and record the release identity and served asset probe.
- Keep credentials, cookies, snapshots and user transcripts out of commits and Issues.
- Record scope, failures and acceptance evidence in the corresponding Issue. A release is complete only when a fresh clone passes the documented check and the deployed application passes the relevant UI/API probe.

- Preserve the latest Host/Web/native adapter implementations when upgrading the Pi package. Validate its public integration surface with `test/pi-package-integration.test.ts`; do not copy an older runtime tree over this repository.
