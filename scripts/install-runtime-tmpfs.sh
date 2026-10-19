#!/bin/sh
# Provision only. Host activation is a separate, idle-gated maintenance action.
set -eu
[ "$(id -u)" -eq 0 ] || { echo 'Run as root with the Host system username.' >&2; exit 1; }
account=${1:?Host system username required}
owner_uid=$(id -u "$account")
owner_gid=$(id -g "$account")
[ "$owner_uid" -ne 0 ] || { echo 'Host must use a non-root system user.' >&2; exit 1; }
root=/run/picoffeetmp
[ ! -L "$root" ] || { echo 'Refusing symlink mountpoint.' >&2; exit 1; }
if mountpoint -q "$root"; then
 echo 'Already mounted; inspect existing options instead of remounting live storage.' >&2
 exit 1
fi
mkdir -p "$root"
[ -z "$(find "$root" -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo 'Refusing to hide existing mountpoint contents.' >&2; exit 1; }
[ ! -e /etc/systemd/system/run-picoffeetmp.mount ] || { echo 'Mount unit already exists; inspect it before replacement.' >&2; exit 1; }
cat > /etc/systemd/system/run-picoffeetmp.mount <<UNIT
[Unit]
Description=Bounded PI Coffee native disposable temporary storage
Before=user@${owner_uid}.service

[Mount]
What=tmpfs
Where=/run/picoffeetmp
Type=tmpfs
Options=rw,nosuid,nodev,noswap,size=2G,nr_inodes=131072,mode=0700,uid=${owner_uid},gid=${owner_gid}

[Install]
WantedBy=local-fs.target
UNIT
systemctl daemon-reload
systemctl enable --now run-picoffeetmp.mount
findmnt --mountpoint "$root" -o TARGET,FSTYPE,SIZE,OPTIONS
