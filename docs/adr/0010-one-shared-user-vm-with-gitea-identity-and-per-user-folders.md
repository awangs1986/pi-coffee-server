> Current-deployment clarification (2026-10-26): Shared execution remains accepted. The login-name cookie/allow-list mechanism and scheduling assumptions below describe the original decision; current route-file scopes use numeric IDs plus an explicit legacy-owner exception. Web now shares the execution VM. See [current topology](../architecture/topology.md). Original decision text is retained as history.

# One shared User VM: Gitea identity on the Web Server, per-user folders in the Host

Status: accepted (owner decision, 2026-09-27)

## Context

The original 0.1 plan gave each internal user a fixed User VM (ADR-0003, ADR-0005). That
presumed each user had their own model account to log in with. The company now grants the
two internal users **one** enterprise model account, to be used in turns. Keeping two VMs
means logging that single account in and out of two machines repeatedly, which is the only
part of the design the shared account makes painful.

## Decision

- **One Web Server, one User VM, one Host, one model login.** The VM is logged in to the
  enterprise account once (Pi's agent dir, `models.json` and provider auth stay shared).
  Both users talk to the Pi processes in that VM through the same Web Server.
- **Gitea stays the identity.** The Web Server completes Gitea OAuth2 (ADR-0004), keeps a
  signed HttpOnly cookie carrying only the Gitea login name, and admits only the names in
  `PI_COFFEE_ALLOWED_USERS`. Removing a name from that list logs that person out.
- **The login name crosses the Web → Host seam as a header** (`x-pi-coffee-user`) on the
  private, bearer-token-protected Host transport. The Host trusts it because only the Web
  Server holds the transport token; it still validates the name as a safe path segment and
  refuses anything else.
- **Per-user folders replace per-user VMs.** For login `alice` the Host runs Pi with
  cwd `<PI_COFFEE_WORKDIR>/alice`, session store `<PI_COFFEE_SESSION_DIR>/alice`, research
  artifacts under `<cwd>/.pi-coffee/research`, and uploads under `<cwd>/.pi-coffee/inbox/…`.
  Each user has their own `HostSessionRegistry`: conversation lists, list pushes,
  rename/delete and file downloads are all resolved inside that user's registry and root.
  A session id from the other user is simply unknown.
- **Nothing else moves.** The Web Server still stores no conversation content (ADR-0003,
  ADR-0008); the Relay still holds the only upstream key; file bytes still go browser → VM
  directly (ADR-0009). A connection without a login name (local `npm start`) uses the
  shared roots exactly as before.

## Consequences

- This is privacy between colleagues, not a security boundary: both users' Pi processes
  run as the same VM owner and can technically read each other's folders with a shell tool.
  The owner accepts that — it matches the previous "Execution Seam" stance (no in-VM sandbox).
- Two users can run Pi concurrently in the VM; there is no queue. The single model account's
  rate limits are shared.
- `PI_COFFEE_ALLOWED_USERS` is the whole "routing index" of ADR-0003 for this topology. If a
  third person joins, add the name; the Host creates their folders on first contact.
- Going back to one VM per user later is a Web Server routing change (user → Host URL), not a
  Host change: the Host already keeps users apart internally.
