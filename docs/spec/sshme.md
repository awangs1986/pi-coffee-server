# SSHME assistance on the user's computer

Delivery: [Server #17](https://github.com/awangs1986/pi-coffee-server/issues/17).

`/sshme <request>` is a case-insensitive Web command available in Pi, Codex and
Claude, including new Pi Chat conversations. Its purpose is to let a remote Agent
help the person using the Web interface with their own local computer. It opens a
compact connection dialog before creating a conversation, uploading attachments
or sending a model prompt. This is a Web feature, not a Skill or MCP service.

## Independent connection boundary

SSHME is separate from **Configure test server**. It has its own authenticated,
user-and-conversation-scoped `/api/sshme` endpoint, configuration, credentials and known-host file.
It may reuse the SSH transport and CLI implementation, but must never read,
overwrite, delete or automatically migrate test-server records. Historical records
saved by the earlier combined implementation remain untouched because their
purpose cannot be inferred safely. The user confirms a separate SSHME connection.

The dialog supports Windows, Linux and macOS. The target must already offer SSH
(macOS calls this Remote Login). Windows uses PowerShell; its WSL is optional.
Linux and macOS use their native POSIX shell over SSH, without WSL. This does not
change the existing Windows-plus-WSL test-server feature.

The authenticated `/api/client-address` GET returns the socket peer IP and an
editable private-address suggestion. Ignore forwarded headers. Loopback, public,
link-local and unknown addresses are not suggested automatically. A private peer
address is only a hint, not verified device identity; proxies, VPNs and NAT may
hide the computer's address. The user confirms address, OS, port and SSH login.

The explicit **Save connection and continue** action saves one assistance
connection for the current conversation within the authenticated Web account. It can be edited or cleared in this same
SSHME dialog. Saving a different endpoint replaces only the assistance record.
Changing address, port, username or OS cannot silently reuse a saved password.
A blank password for a new target uses the Host's SSH keys. Credentials stay in
private Host files, never browser storage, transcript text or model messages.

## Dispatch and Agent guidance

Only a successful SSH connection prepares the request. WSL availability does not
block Windows assistance. The scoped Host returns a password-free message naming
the confirmed endpoint, OS and connection ID, its external configuration pointer,
and the relationship: the target is the Web user's computer, distinct from the
Agent's Linux Host. The message directs the Agent to perform the requested work
there using the CLI, verify the saved endpoint, and respect the request's scope.

SSHME never contributes an automatic instruction, tool description or Skill advertisement to any conversation. Before explicit `/sshme`, the Agent receives no user-computer address, credential reference or SSHME discovery hint. The slash-menu item belongs to the browser UI only.
Only explicit `/sshme` adds assistance guidance as user-request context. Chat's
tools and system prompt remain unchanged; native sessions need no restart to
receive the request. Installation requests do not authorize unrelated changes.

Cancel, connection failure, changed conversation/input/login, disconnected Web,
or a busy task prevents dispatch. A save already received by Host may persist
after dialog cancellation; it does not send the task or cancel earlier jobs.
While a task is running, wait before starting `/sshme`; never interrupt it.
Secrets are cleared from the dialog after submission and closure. Reconnection
never automatically replays a task whose delivery is uncertain.

## Acceptance

Authenticated peer lookup ignores forged proxy headers. SSHME and test-server
records remain independent within each user scope and across users. All three
OS choices route commands correctly. Connection failure, cancellation or context
changes send no model request; successful confirmation dispatches once. Passwords
never enter model frames. Editing/clearing occurs in SSHME, not the test-server
menu. All three Agent slash menus and Chat tools retain their existing behavior.
Real Windows and macOS operations require an available configured target; command
routing tests alone are not proof of a real remote OS run.

## Explicit activation and storage (2026-10-03)

[Server #42](https://github.com/awangs1986/pi-coffee-server/issues/42): every SSHME
API operation requires a validated `conversationId` within the authenticated
user's scope. Its private records live under `sshme/conversations/<id>/`; lists,
connection tests, deletion and preparation all use that same scope. A new-dialog
request reserves the eventual conversation ID without creating a task or sending
a prompt; successful confirmation uses that ID when creating the conversation.
Cancellation can retain private connection data for that reserved ID but never
dispatches a prompt. Other conversations do not inherit the saved connection.
Existing account-level SSHME records remain untouched and are not automatically
selected or copied. Previously supplied transcript information cannot be erased
by this change; no new unsolicited connection information is injected.

The assistance pointer says it is for this explicitly requested assistance only.
It never uses the shared testing pointer. Windows/Linux/macOS assistance remains
independent from the Windows-plus-WSL test target. Saving the test target does not
activate SSHME, and confirming SSHME never changes the test target.
