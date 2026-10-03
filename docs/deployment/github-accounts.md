# Activate GitHub account binding

Source and scope: [contract](../spec/github-accounts.md), [Server #36](https://github.com/awangs1986/pi-coffee-server/issues/36).

1. Create a GitHub **OAuth App** at https://github.com/settings/applications/new.
   Use the configured `PI_COFFEE_PUBLIC_URL` as Homepage URL. Set Authorization
   callback URL to `<PI_COFFEE_PUBLIC_URL>/auth/github/callback`. For the currently
   configured LAN deployment these are `http://webserver:3000` and
   `http://webserver:3000/auth/github/callback`.
2. Generate the App's Client Secret. Place `PI_COFFEE_GITHUB_CLIENT_ID` and
   `PI_COFFEE_GITHUB_CLIENT_SECRET` in the Web service's private environment file.
   Current deployment path: `/etc/pi-coffee/workbench-web.env` on the Web server.
   Preserve a private backup and existing Gitea configuration. Do not put the secret
   in Git, Issues, browser local storage, or conversation messages.
3. Stage the same published main release on Web and Host. The source change alone
   does not deploy the feature. Check active task/background work before switching
   Host. Pause each watchdog before planned service interruption and resume after
   health and asset checks. See [release runbook](unified-release.md).
4. Use the canonical public URL consistently so the Gitea session remains present
   on the GitHub callback. Open Logo → 代码托管账号 → 连接 GitHub 账号. Select the
   intended GitHub account in the provider consent page, return, then Refresh.
   Repeat for a second account. Check the displayed login before selecting a repository.
5. New GitHub tasks choose their account in the repository picker. Retained unbound
   projects must be explicitly bound in account management with tasks idle. No shared
   VM token is imported. Remove obsolete VM `gh`/GitHub connectors after verifying
   the managed path; keep native Pi/Codex/Claude model login intact.

## Release acceptance

- Source and independent-clone `npm run check`: 68 files, 546 checks at candidate
  `d5a16a7`. Browser fixture exercised actual Gitea login, two GitHub OAuth bindings
  and disconnect with zero page errors. Credentials were synthetic.
- Real installed Codex 0.159.1 `command/exec` ran a login Bash shell and retained
  the selected Git/gh context, with a synthetic credential and no model turn.
- Three review issues were reproduced and fixed: retained idle Codex app-server
  credentials, unopened background-work validation and `gh auth status` token flags.
  Login-shell PATH reset was separately reproduced and fixed.
- Real GitHub OAuth consent, live repository access and deployment remain **pending**
  until the operator provisions the OAuth App and authorizes a service cutover.
  Fixture results must not be reported as production OAuth acceptance.

For live acceptance, bind two intended accounts, choose one repository for each,
verify the account and repository from a task, then exercise a disposable branch
and PR. Repeat with the second Web user to confirm the first user's account list
is absent. Disconnect one binding and confirm subsequent access fails without
switching accounts. Already-running remote operations cannot be recalled.
