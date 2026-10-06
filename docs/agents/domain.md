# Domain navigation

Read [CONTEXT.md](../../CONTEXT.md) for current domain terms and
[REPOSITORIES.md](../../REPOSITORIES.md) before choosing source ownership.
Read the affected current specification through [docs/index.md](../index.md),
then the relevant ADR. [ADR-0021](../adr/0021-pi-only-source-authority.md) owns the
current Pi package boundary; earlier source-placement decisions are historical.

This is the Server repository: Browser, Web gateway, Relay, Host and native Agent
adapters live here. Pi-only implementation lives in the versioned `packages/`
directories of the Pi repository identified by the repository map. Consult that
map rather than inferring ownership from an older document's repository name.

Use the domain terms in issue titles, tests and designs. Resolve genuine domain
or ADR conflicts explicitly; avoid inventing synonyms or empty placeholder docs.
