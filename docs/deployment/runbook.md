> Historical evidence and deployment instructions. For current source authority and deployment, use [ADR-0020](../adr/0020-unified-github-authority.md) and [the unified release procedure](../deployment/unified-release.md).

> Source authority and repository placement: superseded where conflicting by [ADR-0020](../adr/0020-unified-github-authority.md). GitHub pi-coffee-server owns Web and Host.

# PI Coffee deployment runbook

This runbook covers the MVP deployment shape — **original Pi + Agent Host in a
User VM, Web Server + LLM Relay on the server** — and the single-machine
developer smoke. It contains no credentials.

## Processes and what each one holds

```text
Browser ──HTTP/WS──> Web Server (server) ──WS + Host token──> Agent Host (User VM) ──RPC──> original Pi
                                                                        │
                                                                        └──HTTP + Relay token──> LLM Relay (server) ──upstream key──> CPA
```

| Process | Runs on | `node dist/src/main.js …` | Secrets it holds |
|---|---|---|---|
| LLM Relay | server | `relay` | the sole upstream key; the list of Relay tokens |
| Web Server | server | `web` | the Host token |
| Agent Host (+ Pi) | User VM | `host` | the Host token; this VM's Relay token |
| File transfer (part of `host`) | User VM, LAN port 53317 | — | per-Session tokens it issues itself |

No process on a User VM ever sees the upstream key. File transfer (ADR-0009)
is LocalSend v2 over plain HTTP served by the Host on the User VM's LAN
interface: browsers upload and download **directly to the User VM**; the
server never carries a file byte. Both the Host and the Relay
refuse to start on a non-loopback bind without their token (fail closed).

## Prerequisites (both machines)

- Debian 12 (server) or Linux Mint Xfce (User VM), internal network only.
- Node.js **>= 22.19** (`node -v`). Debian/Mint packages are older; use the
  NodeSource 22.x repository or an official tarball.
- `git`, `curl`. The pinned original Pi (`@earendil-works/pi-coding-agent@0.87.1`)
  and locked `pi-subagents@0.63.0` are installed by `npm ci` inside the
  checkout; nothing else to install for Pi.
- Firewall: the server must reach `USER_VM:8788` (Host); the User VM must reach
  `SERVER:8789` (Relay); browsers reach `SERVER:3000` (or your TLS proxy) **and
  `USER_VM:53317`** (file transfer, direct from the browser). Do not expose
  8788/8789 beyond their two peers.

## Checkout (both machines)

```bash
sudo mkdir -p /opt/pi-coffee /etc/pi-coffee
sudo chown "$USER" /opt/pi-coffee
git clone http://testpc:3000/awangs/pi-coffee.git /opt/pi-coffee
cd /opt/pi-coffee
npm ci --ignore-scripts
npm run check      # all repository tests must pass; this also builds dist/
```

## Server: Relay + Web Server

Generate the two shared secrets once and keep them in a password manager:

```bash
openssl rand -hex 32   # HOST_TOKEN  → web.env and the User VM's host.env
openssl rand -hex 32   # RELAY_TOKEN → relay.env (PI_COFFEE_RELAY_TOKENS) and host.env (PI_COFFEE_RELAY_TOKEN)
```

```bash
sudo useradd --system --home /opt/pi-coffee --shell /usr/sbin/nologin pi-coffee || true
sudo cp deploy/server/relay.env.example /etc/pi-coffee/relay.env
sudo cp deploy/server/web.env.example   /etc/pi-coffee/web.env
sudo chown root:pi-coffee /etc/pi-coffee/*.env && sudo chmod 0640 /etc/pi-coffee/*.env
sudoedit /etc/pi-coffee/relay.env   # PI_COFFEE_UPSTREAM_KEY, PI_COFFEE_RELAY_TOKENS
sudoedit /etc/pi-coffee/web.env     # PI_COFFEE_HOST_URL=ws://USER_VM_IP:8788/host, PI_COFFEE_HOST_TOKEN
sudo cp deploy/server/pi-coffee-relay.service deploy/server/pi-coffee-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-coffee-relay pi-coffee-web
```

Checks:

```bash
curl -s http://127.0.0.1:8789/healthz        # {"ok":true,"role":"relay"}
curl -s http://127.0.0.1:3000/healthz        # {"ok":true,"role":"web"}
curl -s -H "Authorization: Bearer $RELAY_TOKEN" http://127.0.0.1:8789/v1/models | head -c 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8789/v1/models   # 401: no token, no upstream
journalctl -u pi-coffee-relay -n 20 --no-pager   # one JSON metadata line per request, no bodies
```

### Gitea login (one shared User VM, ADR-0010)

Both colleagues share one User VM and one enterprise model login; Gitea tells
the Web Server who is who, and the Host keeps their conversations and files in
separate folders.

1. In Gitea, as the PI Coffee owner: *Settings → Applications → Manage OAuth2
   Applications → Create*. Name `PI Coffee`, redirect URI
   `http://SERVER_IP:3000/auth/callback` (exactly the origin users type, plus
   `/auth/callback`), confidential client. Copy the client id and secret.
2. In `/etc/pi-coffee/web.env` set `PI_COFFEE_GITEA_URL`,
   `PI_COFFEE_GITEA_CLIENT_ID`, `PI_COFFEE_GITEA_CLIENT_SECRET`,
   `PI_COFFEE_ALLOWED_USERS=alice,bob`, `PI_COFFEE_PUBLIC_URL=http://SERVER_IP:3000`
   and a fresh `PI_COFFEE_COOKIE_SECRET` (`openssl rand -hex 32`).
3. `sudo systemctl restart pi-coffee-web`.

Checks:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3000/        # 302 → /login
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/auth/me                 # 401 without a cookie
curl -s -o /dev/null -w '%{redirect_url}\n' http://127.0.0.1:3000/auth/login           # Gitea /login/oauth/authorize?...
```

From a browser: open the page, click *用 Gitea 登录*, approve in Gitea, and the
shell shows the login name in the sidebar foot (click it to log out). A Gitea
user not in `PI_COFFEE_ALLOWED_USERS` sees a 403 page after approving. On the
VM, `~/work/<login>/` and `~/.pi-coffee/sessions/<login>/` appear on that
user's first connection. Adding a colleague is one edit to
`PI_COFFEE_ALLOWED_USERS` and a Web Server restart; removing a name plus the
same restart logs that person out immediately (the list is read at start).
Emergency revocation of every browser at once: change `PI_COFFEE_COOKIE_SECRET`
and restart the Web Server. Set `PI_COFFEE_REQUIRE_USER=1` in `host.env` so the
Host refuses any connection that arrives without a login name.

## User VM: Agent Host + original Pi

Run as the VM owner (the account whose shell and files Pi should use):

```bash
mkdir -p ~/work ~/.pi-coffee/agent ~/.pi-coffee/sessions
sed "s/SERVER_IP/<server ip>/" deploy/uservm/models.json.example > ~/.pi-coffee/agent/models.json
sudo cp deploy/uservm/host.env.example /etc/pi-coffee/host.env
sudo chown root:"$USER" /etc/pi-coffee/host.env && sudo chmod 0640 /etc/pi-coffee/host.env
sudoedit /etc/pi-coffee/host.env    # HOST_TOKEN, RELAY_TOKEN, replace REPLACE_WITH_VM_OWNER with $USER
sed "s/REPLACE_WITH_VM_OWNER/$USER/g" deploy/uservm/pi-coffee-host.service | sudo tee /etc/systemd/system/pi-coffee-host.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now pi-coffee-host
```

Checks:

```bash
curl -s http://127.0.0.1:8788/healthz        # {"ok":true,"role":"host"}
journalctl -u pi-coffee-host -n 20 --no-pager
```

`"apiKey": "$PI_COFFEE_RELAY_TOKEN"` in `models.json` is Pi's environment
interpolation: the token comes from the Host's environment at request time and
is never written to disk by PI Coffee.

File transfer listens on `PI_COFFEE_TRANSFER_BIND:PI_COFFEE_TRANSFER_PORT`
(default `0.0.0.0:53317`). The Host advertises the address browsers should use
as its first non-internal IPv4; set `PI_COFFEE_TRANSFER_ADVERTISE=<ip or name>`
when the VM has several interfaces or sits behind a port forward. Uploaded
files go to `<PI_COFFEE_WORKDIR>/<login>/.pi-coffee/inbox/<session>/` (the
user's own Pi cwd, so Pi's tools read them by that relative path); downloads
are confined to that user's folder. Check from a browser-side machine:

```bash
curl -s http://USER_VM:53317/api/localsend/v2/info     # LocalSend device description
```

The Host automatically loads the PI Coffee Web adapter, bundled V5 Harness,
`pi-subagents`, and the official `pi-web-access` adapter. The `web_search`
tool calls the Control Plane's `/v1/search/serper` route; only the Relay has
`PI_COFFEE_SERPER_KEY`. The `research_seal` tool writes Markdown under the
User VM research directory and future model context keeps its pointer and
conclusion. `fetch_content`, `source_check`, and `get_search_content` from
`pi-web-access` remain optional until their runner conformance is recorded.
The `subagent` and `bg_wait` tools remain optional until activated through
Harness `search_tools`, so the frozen Chat/Work base counts stay 8/10. Set
`PI_COFFEE_WEB=off` or `PI_COFFEE_WEB_ACCESS=off` to disable either Web layer;
set `PI_COFFEE_SUBAGENTS=off` to keep only Harness; set
`PI_COFFEE_EXTENSIONS=off` for a transport-only diagnostic, or provide a
colon-separated list of explicit extension paths to replace the defaults.
The package's built-in commands and prompt templates are visible in the Pi RPC
command list after startup.

## End-to-end evidence

From the server (or any machine that can reach the Web Server):

```bash
cd /opt/pi-coffee
node scripts/smoke-real-model.mjs ws://127.0.0.1:3000/ws
```

It speaks the browser protocol (open → prompt → streamed `text_delta` →
`agent_settled`), disconnects, reconnects with an older cursor and asserts the
bounded replay, then runs a second turn on the same Session. Exit 0 and a JSON
evidence block (no secrets) means the whole two-machine path works; paste that
block into the Gitea Issue. Exit 1 names the first failing seam.

Then open `http://SERVER:3000/` in a browser and use the shell.

## Failure semantics you should see

| Fault | What the browser shows | Recovery |
|---|---|---|
| Web Server cannot reach the Host | `错误（host_unavailable）` note | fix network/token; the Host and its Pi Sessions are untouched |
| Host token mismatch | Web logs 401 from the Host; browser gets `host_unavailable` | make `PI_COFFEE_HOST_TOKEN` identical on both sides |
| Relay down or Relay token wrong | `模型调用失败：…` note after the prompt | `systemctl status pi-coffee-relay`; check `PI_COFFEE_RELAY_TOKEN(S)` |
| Upstream (CPA) error | `模型调用失败：…` or Pi's auto-retry note; Relay log line has `outcome: upstream_error` | upstream side |
| Browser cannot reach `USER_VM:53317` | attachment chip turns red: "无法连接 User VM 的传输端点" | firewall/route from the user network to the VM; `PI_COFFEE_TRANSFER_ADVERTISE` if the auto-detected address is wrong |
| Upstream/CPA rate limit (HTTP 429) | `exceeded retry limit, last status: 429 Too Many Requests` (often with a Cloudflare request id) | This is upstream quota/concurrency/rate limiting. Check the CPA dashboard/logs and `Retry-After`; wait or reduce concurrency. Pi retries transient 429s up to its configured limit (`retry.maxRetries`, default 3, with 2/4/8 s backoff). The Relay does not retry or hide the 429. Set `retry.enabled: false` temporarily when repeated retries are undesirable. |
| Browser closed / refreshed / opened on another machine | nothing — the run continues on the Host; the browser reloads the conversation list and history from Pi's session store in the User VM | none needed |
| Idle Pi process stopped (`PI_COFFEE_IDLE_TIMEOUT_MS`, default 10 min) | nothing visible; the next open resumes the conversation from the store | none needed |
| Host restarted | browser reconnects; every completed conversation is listed and readable; a message that was mid-stream at the crash is cut at its last completed message | resend the last prompt; mid-run recovery is `REC-001` (0.1) |

## Two-machine smoke with Podman (no VMs)

`scripts/smoke-podman.mjs` reproduces the deployment shape on one machine:
three containers on a private network — `pi-coffee-relay` (sole upstream key),
`pi-coffee-web` (Host token), `pi-coffee-uservm` (Host running as an
unprivileged user with only its Relay token) — with just the Web port
published.

```bash
export PI_COFFEE_UPSTREAM_KEY=…        # passed only to the relay container
node scripts/smoke-podman.mjs          # builds deploy/podman/Containerfile, runs, tears down
node scripts/smoke-podman.mjs --keep --publish 0.0.0.0:3300   # leave it up for others on the LAN
```

Options: `--image <name> --mount-source --no-build` runs from a locally
imported base image with the checkout bind-mounted (for hosts that cannot
reach a registry; run `npm ci && npm run build` for Linux inside the checkout
first). Host proxies are not forwarded into the containers
(`--http-proxy=false`). `PI_COFFEE_SMOKE_TIMEOUT_MS` raises the real-model
waits when Pi starts slowly (a bind mount from Windows adds ~15 s to the first
open). On Windows/WSL, publishing to the LAN additionally needs
`netsh interface portproxy add v4tov4 listenport=3300 listenaddress=0.0.0.0 connectport=3300 connectaddress=127.0.0.1`
and a firewall rule for the port.

The script waits for the three `/healthz`, then asserts: the upstream key is
absent from the uservm and web containers, the Relay answers 401 without a
token, the Host refuses a tokenless upgrade, the real-model smoke passes
through the whole path, a `hostname; whoami` tool call reports the uservm
container and the unprivileged user, Relay metadata carries no content, and
stopping the uservm container surfaces `host_unavailable` to the browser. It
is a pre-flight rehearsal, not the deployment: systemd units, firewalling and
the owner's VM remain the sections above.

## Developer smoke on one machine (no VMs)

```bash
npm ci && npm run check && npm start        # Host + Web on loopback, Pi with its default credentials
```

安装或升级后可先运行 `npm run smoke:subagents`；它使用离线临时目录验证
`pi-subagents` 扩展和命令注册，不需要模型凭据。

`npm start` (`all`) also starts the Relay when either `PI_COFFEE_UPSTREAM_KEY`
or `PI_COFFEE_SERPER_KEY` is set. A Relay configured with only Serper serves
the search route while LLM routes return a structured unavailable response.
To test a Host that has **no** upstream key on one machine, run three shells:

```bash
# 1. Relay
PI_COFFEE_UPSTREAM_KEY=… PI_COFFEE_RELAY_TOKENS=t1 npm run start:relay
# 2. Host (models.json baseUrl http://127.0.0.1:8789/v1, apiKey "$PI_COFFEE_RELAY_TOKEN")
PI_COFFEE_RELAY_TOKEN=t1 PI_COFFEE_AGENT_DIR=… PI_COFFEE_PROVIDER=cpa PI_COFFEE_MODEL=gpt-5.4-mini npm run start:host
# 3. Web
npm run start:web
node scripts/smoke-real-model.mjs ws://127.0.0.1:3000/ws
```

### Running Codex CLI instead of Pi (ADR-0011)

The VM admin logs Codex in once as the VM owner user (`codex login`, or put the API key in
`~/.codex/auth.json` / `OPENAI_API_KEY` in `host.env`). Then in `host.env`:

```
PI_COFFEE_AGENT=codex
PI_COFFEE_CODEX_BIN=/usr/local/bin/codex
PI_COFFEE_CODEX_HOME=/home/<owner>/.codex
PI_COFFEE_MODEL=<codex model id>
```

Restart the Host. Each Gitea user still works in `<WORKDIR>/<user>`; the Host starts one
`codex app-server` per user on demand, lists only that user's threads and stops that
process again after `PI_COFFEE_IDLE_TIMEOUT_MS` with no open session. Conversations are
Codex's own rollouts under `CODEX_HOME/sessions`; PI Coffee ids that were created before
their thread are kept in `<SESSION_DIR>/<user>/codex-threads.json` (outside the directory
the agent edits). Smoke test:
`PI_COFFEE_AGENT=codex PI_COFFEE_CODEX_HOME=/home/<owner>/.codex npm run start:host` and open
a new session in the browser; the startup log prints `agent=codex`.


For search-only testing, configure `PI_COFFEE_SERPER_KEY` and optionally
`PI_COFFEE_SERPER_ENDPOINT` on the Relay, then use the Web Host with
`PI_COFFEE_RELAY_TOKEN` and `PI_COFFEE_SEARCH_URL`.

Both `https://awangsawangs.xyz/v1` and `https://b.awangsawangs.xyz/v1` serve the
same model list; use the one your network resolves.

## Optional route: HTTPS with an internal CA

0.1 runs plain HTTP (owner decision: internal LAN, browsers accept `http://`
private addresses without warnings). The HTTPS route is built in and switched
on by certificate files; it exists for when the network policy changes.

The rule is **all or nothing**: a browser on an `https://` page refuses
plain-HTTP uploads to the User VM as mixed content, so the Web Server and every
User VM's transfer port must use certificates the browsers trust. That means an
internal CA distributed to the user machines (group policy or manual import),
a certificate for the Web Server, and one per User VM — sign them for a DNS
name (`vm-alice.corp`) rather than an IP, and give `PI_COFFEE_TRANSFER_ADVERTISE`
that name.

```bash
# server (web.env)
PI_COFFEE_WEB_TLS_CERT=/etc/pi-coffee/tls/web.crt
PI_COFFEE_WEB_TLS_KEY=/etc/pi-coffee/tls/web.key
# each User VM (host.env)
PI_COFFEE_TRANSFER_TLS_CERT=/etc/pi-coffee/tls/vm.crt
PI_COFFEE_TRANSFER_TLS_KEY=/etc/pi-coffee/tls/vm.key
PI_COFFEE_TRANSFER_ADVERTISE=vm-alice.corp
```

With TLS on, the Web Server serves `https://` and `wss://`, the transfer port
answers `protocol: "https"` with the certificate's SHA-256 as its LocalSend
fingerprint, and `npm start` refuses a configuration that secures only one of
the two browser-facing surfaces. The private Host port (8788, server ↔ VM) and
the Relay (8789, VM ↔ server) stay HTTP with bearer tokens; they never face a
browser. Secure contexts also unlock browser features the shell degrades
without: clipboard API, in-browser SHA-256 of uploads, desktop notifications.

## Reverse proxy

Terminate TLS and expose only the Web Server to the internal browser network.
Forward WebSocket upgrades on `/ws`. Keep 8788 (Host) and 8789 (Relay) private
to their peers. Do not publish Gitea, the Host or the Relay to the public
internet.

Note the file-transfer trade-off (ADR-0009): browsers reach the User VM's
53317 directly, so a TLS-terminating proxy in front of the Web Server alone
would turn those uploads into blocked mixed content. Either keep everything on
HTTP (0.1) or follow the HTTPS route above for both surfaces.

## Recovery

1. Check `/healthz` on Relay, Web and Host.
2. If the browser is disconnected, reconnect; do not kill the Host.
3. If the User VM is damaged, stop routing to it and restore its owner-managed snapshot.
4. Record the incident and evidence in the relevant Gitea Issue.
