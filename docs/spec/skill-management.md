# Web-managed Skills

Accepted owner request, 2026-09-23. Agent [#62](http://gitea:3000/awangs/pi-coffee/issues/62), Server [#14](http://gitea:3000/awangs/pi-coffee-server/issues/14).

## Ownership and scope

Web is the unified **management surface**, not a new execution host or a central
copy of user Skills. The authenticated user's fixed User VM owns installation,
source revisions, enabled state, supporting files and execution. Gitea (or another
explicit Git source) owns published Skill source. No provider authentication moves.
The gateway authenticates and forwards commands without interpreting Skill files.

The upper-left PI Coffee menu exposes Skills independently of Pi's existing plugin
inspector. The page preserves the current conversation, connection and unsent draft.
It offers native Agent and scope selectors, inventory, plain-text SKILL.md inspection,
Git installation, update, enable/disable, refresh and explicit idle-task reload.

Each installation explicitly selects Pi, Codex or Claude Code; the same source is
not silently installed for other engines. Files remain native SKILL.md packages;
no Skill body is globally appended to the platform system prompt. Agent-specific
instructions remain the package author's and user's responsibility. Pi custom LSP
is displayed as a read-only bundled Pi Skill, not injected into native engines.

## Native directories

| Agent | User scope | Project scope |
| --- | --- | --- |
| Pi | configured Pi agent directory / `skills`, default `~/.pi/agent/skills` | `.pi/skills` |
| Codex | `~/.agents/skills` | `.agents/skills` |
| Claude Code | configured Claude directory / `skills`, default `~/.claude/skills` | `.claude/skills` |

Project means the selected active Work Conversation's independent checkout, not
all clones of a registered Project. The Task's fixed Agent must match. Its copied
Skill files are ordinary project changes that can be reviewed, checkpointed and
published through Gitea. Other clones receive them only through normal Git flows.
Chat uses user-level Skills; Pi Chat's zero-system-prompt rule remains unchanged,
so explicit `/skill:name` invocation is available without adding a Skill catalog
to its system prompt.

The inventory covers these selected native roots and explicitly configured Pi
bundles. It is not an exhaustive catalog of every plugin, administrator root,
ancestor directory or package configured outside this manager. Eligible existing native Skills can be reversibly disabled and restored; their
files are never adopted or overwritten. Bundled and linked sources remain read-only.

Native discovery references: [Codex Skills](https://developers.openai.com/codex/skills/),
[Claude Code Skills](https://code.claude.com/docs/en/skills), pinned Pi 0.84.4 public
`loadSkills` interface. Engine-native precedence and metadata semantics remain intact.

## Install and lifecycle

- Supply a credential-free HTTP(S) or `ssh://` clone URL, ref (default HEAD), and
  optional scan subdirectory. Read the repository list, then explicitly select
  the Skills to install. A repository may contain one Skill or a collection. No executable installation hooks, dependency
  installation, submodule initialization or model calls run during installation.
- Fetch on the VM, resolve a concrete commit, validate YAML name/description and
  retain supporting files. Packages are bounded to 500 regular files / 10 MB;
  SKILL.md is at most 64 KB. Symlinks and special files in managed packages are
  rejected. Repository escape paths and inline URL credentials are rejected.
- VM Git credentials serve private sources. Configured Gitea credentials are
  scoped to that origin and are never returned to the browser or placed in clone
  URLs. Redirects are not followed with source credentials.
- Install refuses collisions with existing native files. Updates follow the
  originally selected ref and record the new concrete commit; a pinned commit
  stays pinned. The package name cannot change during update.
- Managed state and retained versions live under
  `~/.local/share/pi-coffee/skills` (or `PI_COFFEE_SKILL_ROOT`). Native active
  directories contain copies, not machine-specific links committed to a Project.
- Disable removes only the unchanged managed active copy; the complete version
  remains available for enable. No permanent-delete control is included.
- Detect local content or permission edits before update/toggle and refuse to
  overwrite them. Missing native files or invalid external Skills are visible.
  Fetch/validation failures preserve the installed version. File publication
  failures attempt restoration from the retained copy. A crash leaves a mutation
  lock and recovery record for owner inspection instead of blindly retrying writes.
- Requests serialize per VM manager, including repeated install/update attempts.
  The browser does not retry uncertain mutations. Refresh reconciles actual state.

## Activation and active tasks

A management action never aborts or automatically restarts an Agent. Native engines
may discover file changes themselves; the guaranteed boundary is the next process
start. UI distinguishes installation from active-session loading. Instructions
already read into conversation history are not removed by disabling a Skill.

Explicit Reload targets a known active Conversation with the selected Agent. Host
locks its lifecycle, verifies no foreground request and known-zero background work,
stops only that idle process and detaches viewers so normal reconnect resumes its
existing native session. Unknown/active writers reject reload; no task or history
is deleted and no prompt is replayed. If no process is live, the next open discovers
Skills. Project writes use the same task lifecycle exclusion and reject live writers.

## Public interface and acceptance

Authenticated `POST /api/skills` carries `engine`, `scope` (`user` or `project`), and
`conversationId` for project scope. Actions: `list`, `detail` (opaque `id`), `discover` (source URL/ref/subdir), `install`
(`repoUrl`, optional `ref`/`subdir`/`expectedRevision`), `update`, `enable`, `disable` (opaque `id`),
`disable_native`, `restore_native` (opaque scoped `id`), and
`reload` (explicit `conversationId`). IDs resolve only within the selected scope.
Host returns 401 without its bearer, 404 when not configured, 405 for other methods,
and 409 with an actionable error for invalid/conflicting operations. Responses are
uncached. Source failures do not expose Git stderr or credentials.

Inventory returns the native directory, bounded metadata, source commit, managed /
read-only state, enabled state, local-edit/missing-file indicators and warnings.
Detail returns bounded plain-text SKILL.md on explicit request only. The Server
neither persists nor logs these contents; native loaders consume VM files directly.

Acceptance uses Host HTTP and Web HTTP/controller seams: real Git package files,
all three native directory mappings, independent project scope, content/revision,
reversible toggles, local-edit/collision preservation, malformed sources, restart
persistence, native Pi discovery, safe reload and failure states. Browser acceptance
covers install/detail/actions, stale responses, unsupported Hosts, preserved drafts
and compact desktop/mobile layouts. Run both repositories' `npm run check` from
independent clean clones. Record deployed evidence in the linked Issues; installing
a Skill is not evidence that a paid model chose to invoke it.

## Skill collection discovery (2026-09-30)

[Server #7](https://github.com/awangs1986/pi-coffee-server/issues/7) corrects the
collection-root error reported with `awangs1986/catskills`. The repository root
has no SKILL.md and contains an unrelated AGENTS.md link; its actual Skills live
under `skills/<category>/<name>`. Installing the root as one package was invalid.
No source-repository modification is required.

Discovery uses the same authenticated Agent/scope and VM Git credentials as
installation. It reads a concrete checkout and returns names, descriptions,
repository-relative directories, revision, existing-name collisions and package
validation problems. It never installs or executes files. Scanning skips .git and
does not follow symlinks; unrelated root links do not reject a collection. It is
bounded to 5,000 visited entries, depth 12 and 200 Skills; users can narrow the
subdirectory. Invalid metadata is reported as a warning. Actual managed packages
still reject all links and special files and retain the existing size limits.

The Web list supports search and explicit checkboxes with nothing preselected.
Existing native/managed names and invalid packages are unavailable for install.
Source or Agent/scope changes clear the preview. Installs are sequential and
independently committed; per-package errors remain visible, and completed
selections are disabled rather than retried. Closing the page stops unsent
requests but does not cancel a request already executing on Host.

Each selected install passes the preview revision as `expectedRevision`. Host
rechecks the fetched revision before publication and rejects a changed source;
the original ref remains recorded for future explicit updates. Empty or
collection-root direct installs report missing SKILL.md with discovery guidance,
rather than misleading users about unrelated root symlinks.


## Bulk selection and native conflicts (2026-09-30)

[Server #8](https://github.com/awangs1986/pi-coffee-server/issues/8) adds **Select all
installable** and **Clear selection** to collection discovery. Both operate on the
currently visible search results and preserve selections outside the filter.
Existing names and invalid packages remain unavailable. Bulk selection never
starts installation by itself; the install button shows the total selected count.

Web-managed and manually installed Skills use the same native VM directories.
Hiding an inventory row does not disable native loading. Eligible manual packages
therefore offer **Disable (keep backup)**: Host atomically moves the entire native
package to private manager storage outside the selected native root and records
its original path. This preserves supporting files, permissions and local edits.
The operation does not execute the package, automatically adopt it as managed,
permanently delete it, or stop a running Agent. On a shared Host, user-level changes
affect every task using that OS user's Agent; the UI states this scope.

Disabled native packages remain listed with **Restore VM version** and readable
metadata. Backups survive Host restart. Restore refuses an occupied original path
or another active package with the same metadata name. A managed same-name package
may be installed after disabling the native version; switching back requires
first disabling the managed version. Managed enable/update/install and discovery
also check active inventory names, not merely directory basenames. Disabled
managed packages still reserve their managed identity for explicit enable/update.

Only real native package directories or supported standalone native Markdown
files beneath the selected root can be relocated. Symlinked roots, symlinked entry
paths, ancestor aliases, the native root itself, and configured Pi bundles remain
read-only. Bundled/plugin changes belong to their package manager. Atomic rename
across filesystems is refused without deleting the original; the manager's backup
storage must be on the same filesystem. Inventory remains limited to the roots
listed above; this is not a global override of arbitrary external plugin loaders.

All actions retain authenticated owner/project authorization, shared mutation
locking and project task lifecycle exclusion. An interrupted mutation retains a
recovery record. A failed registry save attempts to restore the original location;
failed recovery retains the lock and backup for VM inspection. Native management
and inventory refresh invalidate the source preview, requiring discovery again.
Already loaded conversation instructions are unchanged; start a new Agent or
explicitly reload an idle task to apply native discovery changes.


## Slash completion after installation (2026-09-30)

[Server #9](https://github.com/awangs1986/pi-coffee-server/issues/9) fixes the empty
slash menu before a Pi task's first message. Typing `/` in a Pi draft requests a
native command catalog on the authenticated WebSocket. Host asks the scoped Pi
Adapter to start an ephemeral `--no-session` process with its configured native
Skill and extension paths, reads `get_commands`, and stops it. This creates no
Conversation, clone, transcript or model turn. Concurrent catalog requests within
one factory share the in-flight discovery; later requests read fresh native files.
Draft discovery uses the adapter's user cwd, not a not-yet-created project clone;
project-specific commands become authoritative when the task opens.

The menu shows loading, empty and failure states. Skill names can be searched
without the `skill:` prefix; selection inserts Pi's actual `/skill:name` command.
The scrollable menu is not truncated to the first eight extension commands.
Responses are correlated to the active draft; changing Agent or Conversation
invalidates the catalog. Command names are rendered as text.

Installing, updating or toggling a Skill through this browser invalidates draft
completion. A live session continues to use its own `get_commands` result. After
a relevant Skill change, its slash menu offers an explicit idle-only reload via
the existing Skills API, preserving the user's draft and task identity. It never
automatically aborts/restarts a task or pretends a fresh catalog is already loaded
in an older process. Other browser/CLI changes require refresh/reload as before.
Codex and Claude retain their native command support; Pi `/skill:` syntax is not
injected into those engines. Unsupported slash menus display an explanation.
