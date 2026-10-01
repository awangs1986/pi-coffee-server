# SSHME remote assistance

Delivery: [Server #17](https://github.com/awangs1986/pi-coffee-server/issues/17).

`/sshme <request>` is a case-insensitive Web command available in Pi, Codex and
Claude, including new Pi Chat conversations. It opens a compact connection dialog
before creating a conversation, uploading attachments or sending a model prompt.
It is a Web feature using the existing Host runner CLI, not an Agent-specific
Skill or MCP service. The Web command name takes precedence over an identically
named native command.

The authenticated `/api/client-address` GET returns the socket peer IP and an
editable private-address suggestion. Ignore forwarded headers. Loopback, public,
link-local and unknown addresses are not suggested automatically. A private peer
address is only a hint, not verified device identity; proxies, VPNs and NAT may
hide the computer's address. The user confirms or edits the Windows SSH address,
port, username and password. Windows SSH must already be enabled; Linux commands
run in that Windows account's default WSL distribution.

The dialog explicitly saves the connection as the current account's one test
computer and then tests it. Saved credentials can be reused on that same target,
without re-entering the password. A different address, port or username cannot
silently reuse the saved password. A blank password for a new target explicitly
uses the VM's SSH keys. Changing computers replaces the existing account runner;
configuration remains editable/removable from the Logo menu. Credentials remain
in private Host files, not browser storage, transcript text or model requests.

Only successful Windows connectivity prepares the task; missing WSL does not
block Windows assistance. The scoped Host returns a password-free message naming
the confirmed endpoint and runner ID, the external config pointer, and the
relationship: remote target is the Web user's Windows computer, distinct from the
Agent's Linux Host. The message instructs use of the existing CLI, endpoint
revalidation, Windows/WSL selection and the limits of the user's request.

Explicit `/sshme` in Chat supplies these instructions as user-request context; it
does not restore Work system prompts or expand Chat's tool set. Existing or new
native sessions need no restart to receive the request. Other ordinary Chat
messages still have no automatic runner instruction. Installation requests do
not grant permission for unrelated system changes. Native agents retain their
own additional approval behavior.

Cancel, connection failure, changed conversation/input/login, disconnected Web,
or a busy task prevents dispatch. A save already received by Host may persist
after dialog cancellation; it does not send the task or cancel earlier jobs.
While a task is running, wait before starting `/sshme`; never interrupt it.
Connection data is saved per Web account, not per browser IP. Secrets are cleared
from the dialog after submission and closure. Reconnection never automatically
replays a task whose delivery is uncertain.

Acceptance: authenticated peer lookup ignoring forged proxy headers; per-user
runner isolation; failed connection produces no model request; exact single
dispatch only after confirmation; cancel and asynchronous conversation changes
suppress dispatch; no credentials in frames; all three Agent menus; current Chat
tools preserved. Real Windows operations require the user's configured machine.
