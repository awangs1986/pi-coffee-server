# PI Coffee deployment files

The current two-user installation runs Web, the primary workbench Host and native
Agent CLIs on one Linux VM under one OS account. Start with
[`single-vm/`](single-vm/README.md), the [current architecture](../docs/architecture/topology.md)
and the [release runbook](../docs/deployment/unified-release.md). Web and Host remain
separate user services; user lingering and service enablement provide boot startup.

Browser/Web/Host/native adapter source belongs to this GitHub Server repository;
Gitea mirrors it. The Pi plugin repository is a source/package boundary, not a
requirement for another machine. See [REPOSITORIES.md](../REPOSITORIES.md).

`uservm/` and `server/` retain component/system-service templates for optional
split installations and older deployments. `restart/` and `watchdog/` provide
maintenance helpers. Use the [migration runbook](../docs/deployment/same-vm-migration.md)
only when relocating an existing Web service; it fences the old service before
starting a replacement. No template creates, snapshots or restores VMs.

The Host runs as the machine owner for native CLI configuration and workspaces.
Application scopes separate Web participants' managed data and credentials; one
shared OS account does not create an OS sandbox between those participants.
Preserve the legacy default owner and task mappings when upgrading an existing
installation instead of copying fresh-install scope settings over it.

If the deployment explicitly requires passwordless owner administration,
`sudo deploy/uservm/install-owner-access.sh <vm-owner>` installs and validates
that sudoers policy. It is an optional privilege configuration, not a prerequisite
for same-VM deployment. `npm run probe:owner-access` checks the configured policy;
this documentation refresh neither grants sudo nor changes service permissions.
