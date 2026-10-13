# Complete two-user workbench on a shared Host

Owner reaffirmation, 2026-10-13. [Server #125](https://github.com/awangs1986/pi-coffee-server/issues/125).
This corrects v0.21 / #124's incomplete onboarding boundary.

## Required workflow

Both approved Gitea identities must log in, select or create a Gitea project,
create an independent Conversation checkout, use a native Agent, review changes,
commit/push and open a PR. Login and denial of borrowed credentials alone are
insufficient acceptance. GitHub remains an additional project source.

Sharing one physical owner, system login and Host changes deployment topology;
it does not reduce the second participant to Chat-only access. Ordinary users do
not provision another VM. The administrator completes the route, credential and
directory binding before declaring an account ready. Native model login remains
on the Host, independent of repository authorization.

## Credential binding

Web derives numeric Gitea identity and selects its Host scope. Shared routes use
`gitea-<id>`; explicit `legacyDefault` retains the old owner's default registry.
No history or task path is automatically moved.

`PI_COFFEE_GITEA_ACCOUNTS_FILE` names administrator-controlled JSON outside task
directories, mode 0600 in a private directory. Example:

```json
{
  "version": 1,
  "accounts": {
    "gitea-2": {
      "userId": 2,
      "login": "second-user",
      "token": "<private credential for this user>",
      "gitName": "second-user",
      "gitEmail": "second-user@example.org"
    }
  }
}
```

Numeric scope IDs must match the configured ID; older login-name scopes must
match the login. Optional `default` configures the legacy owner explicitly.
Only the default owner can retain the old environment credential; other scopes
never fall back to it. Configuration changes apply after a safe Host restart.

Before scoped repository API, native Git credential or private Skill fetch use,
Gitea `/api/v1/user` must confirm the expected ID and login. Wrong identity,
revocation and disabled accounts refuse the operation. Validation is on demand:
a Gitea outage does not prevent Host startup or ordinary Chat. Repository sharing
continues to follow Gitea permissions. A Gitea administrator retains Gitea's own
privileges, without an exception to Coffee Conversation/file/GitHub scoping.

The selected credential covers listing, creation, clone/fetch/push, PR and project
Skill access. Git author/committer defaults use that account's configured identity.
Tokens stay in private Host configuration/transport files, never browser responses,
repository URLs, prompts, Issues or logs. Native children do not inherit the master
account-file environment setting. Native CLI installations/logins are unchanged.

## Directories and prompts

Task-storage mappings retain independent account roots and one directory per
Conversation. HTTP/WS lists, lifecycle operations, file grants, GitHub bindings
and broadcasts stay account scoped. Archive retains files.

Work receives one English sentence naming its current account and account directory,
directing it to use its workspace and configured repository credentials and avoid
other accounts' data unless the system owner explicitly authorizes administration.
Pi's final Work provider hook retains it after optional Harness filtering without
duplicate accumulation. Other native Work adapters receive the same Host guidance.
Ordinary Chat retains its documented zero-Work-system/runner rules; its credential,
directory and API scoping still applies. No transcript or project AGENTS.md is rewritten.
Unrestricted native permissions remain: this is trusted-user application separation
and soft guidance, not an OS sandbox between processes sharing a Linux UID.

## Onboarding and acceptance

1. Verify the existing Gitea ID and provision its own credential with required
   repository/user/issue scopes. Do not reset passwords or copy the owner's token.
2. Bind the private credential, task-directory mapping and approved Web route.
3. Back up configuration, admit safe maintenance and restart Host. Verify both
   authenticated accounts advertise usable Gitea workspace capabilities.
4. Exercise both accounts' project creation, independent clone, edit, checkpoint,
   remote SHA and PR. Verify Git authors, repository ownership, cross-task denial,
   wrong-credential rejection and preservation of existing task paths.
5. Verify the actual browser repository entry/picker. Missing authorization is an
   account-binding problem, not an instruction to create another VM. Source,
   deployed version and real-Gitea acceptance remain separate evidence.

The public built-Host workflow is tested in `test/shared-gitea-onboarding.test.ts`;
native Git in `test/gitea-native-credentials.test.ts`; installed Pi/Host/Web provider
guidance in `test/pi-package-integration.test.ts`. Production evidence belongs to
#125. Verification is serial and does not authorize bulk Agent creation.
