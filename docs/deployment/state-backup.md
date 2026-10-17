# Consistent backup and recovery

Back up registered task bundles, old workspace/registry roots, scoped authorization
stores, native Agent session stores and their required configuration together.
The exported `history/conversation.json` is a display copy, not native recovery.
Generated display indexes are rebuildable; queued-input recovery files are durable.

`scripts/backup-state.py` uses a private operator JSON configuration:

```json
{
  "quiesceCheck": ["/absolute/path/to/check-stopped-writers"],
  "roots": {
    "tasks": "/absolute/task-root",
    "registry": "/absolute/registry-root",
    "native": "/absolute/native-store",
    "configuration": "/absolute/private-config"
  }
}
```

`create --config ... --destination NEW_DIRECTORY` requires the writer check before
and after copying. Pause watchdog/restart triggers and stop writers for the entire
snapshot. The destination must be outside source roots and must not already exist.
Files are hashed, symlinks are retained without following them, and only a completed
manifest makes the backup verifiable. Restrict the parent directory and snapshot
permissions because native and authorization stores contain sensitive data.

`verify --source SNAPSHOT` checks the entire recorded inventory. `restore --source
SNAPSHOT --destination NEW_DIRECTORY` only reconstructs into a new staging path,
then verifies it again. It never overwrites live task/native stores. Do not restart
an old binary on newer native data merely because a service rollback succeeded.
An operator must choose compatible binaries and the whole consistent data set.

The automated fixture proves snapshot verification, restored content, refusal to
overwrite live paths, corrupt-backup rejection and refusal with active writers.
Production backup/restore drills are separate recorded operations; keep counts,
hashes and status, never transcript bodies or credentials, in public evidence.
