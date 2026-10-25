# Managed native provider transport candidate

The managed namespace has no Host network. Its provider transport is one enrolled
provider per engine and endpoint, implemented by a fixed-route Unix HTTP broker
and a loopback listener inside the namespace. This is source infrastructure; no
service, provider, credential, task or model is activated by adding these modules.

`ProviderHttpBroker` accepts an expected kernel peer UID, a fixed Unix endpoint,
exact method/path → upstream URL operations and a current-credentials callback.
The independent provider worker supplies that callback and binds the
enrolled account, provider and private auth roots, refreshes native credentials privately,
and refuses revoked/missing credentials. Neither the HTTP request nor the model chooses an account,
upstream URL, host path or credential file. Operator-owned upstream configuration
can target the existing provider relay without granting its other routes.

The broker authenticates actual Linux SO_PEERCRED, rejects existing endpoint
replacement, bounds sockets, concurrent requests, headers, JSON request bodies,
response bytes and operation duration, and forwards SSE with backpressure. It
strips inbound credentials, cookies and forwarding headers, attaches only trusted
current credentials, filters response headers and rejects redirects, CONNECT,
upgrades and unlisted method/path/query combinations. Bodies and headers are never
logged. Request-body buffering enforces its bound before anything reaches the
upstream; provider responses stream incrementally.

The outside managed authority must authenticate the service UID and pin the exact
Unix socket inode with `O_PATH|O_NOFOLLOW`, verify its identity across connection,
then mount that socket read-only in the namespace. It must not mount its parent,
Host/key sockets, bus, credentials or locks. A host UID may map to the overflow UID
inside a user namespace, so the inside runner cannot use that mapped UID as proof.
`connectProviderEndpoint(socket, serviceUid)` supplies an outside peer/inode check;
the managed launcher owns final pinning and admission.

The supported runner shape for that pinned mount is:

```sh
node provider-loopback.mjs --socket /run/pi-coffee/provider.sock --port PORT -- NATIVE_EXECUTABLE NATIVE_ARGUMENTS
```

An optional `--fd FD --port PORT -- ...` mode uses an already authenticated
connected descriptor when the namespace runtime can preserve it. The endpoint
remains the only network capability. Native stdio passes through unchanged. The
runner closes its listener when the native process exits, so it cannot keep the
namespace alive indefinitely; the namespace init still owns the lifetime and
writer census of surviving real tool descendants.

For Pi1.1.0, append `managed-pi-provider.mjs` as an extension and provide the public
`PI_COFFEE_PROVIDER_ID` and `PI_COFFEE_PROVIDER_PORT`. The documented
`registerProvider` receives a safe authenticated model-catalog projection, the
same original provider/model IDs, loopback base URL and a nonsecret placeholder
JWT. No private `models.json`, headers or auth file enters native execution. Host
provider/model admission and the broker's exact model allowlist enforce the gate;
Pi catches extension hook exceptions. `piProviderTransportOverrides` remains a
base-URL helper; production startup uses the reviewed catalog projection.

`codexProviderTransportArgs(provider, port)` overlays only that existing provider's
base URL and a public placeholder environment key, explicitly seeds that approved
provider ID/name in a fresh source home, disables native OpenAI auth
inside the namespace, and selects HTTP streaming instead of WebSockets. It does
not set model, reasoning, tier, context or substitute a different provider ID. The runner supplies
`PI_COFFEE_PROVIDER_PLACEHOLDER`. This uses the official
[Codex provider configuration reference](https://developers.openai.com/codex/config-reference/).
A source adapter must reject unsupported auth transports, secret-bearing inline
headers or unsupported native versions until their sanitization and refresh path
are qualified; copying an original credential directory into the sandbox would
break this boundary.

The standalone `provider-broker-worker` now composes pinned Pi ModelRuntime and
Codex0.159.1 native auth RPC. See [source/auth configuration](managed-source-authority.md)
for supported mappings, example configuration, credential reload and refresh rules.
Synthetic evidence includes real Unix peer credentials, exact socket-FD pinning,
actual Pi/Codex SDK traffic to local synthetic error endpoints, API-key/custom-env
rotation, native OAuth refresh/persisted rotation, expired/failed-refresh refusal,
SSE first-frame streaming and route/redirect/bound denial. No production provider
message, real service-UID installation or legacy migration is claimed.
