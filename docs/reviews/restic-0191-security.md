# Restic 0.19.1 scoped dependency review — 2026-10-25

The Linux amd64 artifact and exact executable checksums are pinned in
[the repository runbook](../deployment/task-backup-repository.md). Upstream's
latest release resolves to 0.19.1 (2026-07-05); the downloaded executable reports
Go1.26.4. Official checksum signature verifies against fingerprint
`CF8F18F2844575973F79D4E191A6868BD3F7A907` from the upstream HTTPS key page.

This artifact is **not advisory-free**. An OSV batch query against 93 exact
upstream go.mod dependencies and the bundled standard library returned 37 GO
advisories plus GHSA aliases. The repository's own upstream advisory page has no
published advisories; that does not clear its transitive dependencies. Saved
release, checksum/signature, exact module list, OSV JSON and per-advisory source
records accompany the implementation evidence for Server #132.

| Advisory surface | Supported local-operation reachability |
| --- | --- |
| HTTP/TLS/DNS/SSH/gRPC, URL, multipart and OpenTelemetry | The adapter forces a local repository through an inherited checked directory descriptor. Environment is allowlisted; no peer, server, proxy credential, remote URL, profiling, self-update, FUSE mount or external transport command is accepted. Restic does construct HTTP transport objects during setup; no hostile connection, request or handshake is supplied by this operation surface. Linked affected symbols alone do not establish exploitability. |
| GO-2026-5841 / GHSA-259r-337f-4rfw | Affects `s2.NewDict` followed by `Dict.Encode` using a crafted dictionary. The repository path uses zstd EncodeAll/DecodeAll, receives no supplied S2 dictionary, and treats task file bytes as opaque input. |
| GO-2026-4970 / GO-2026-6604 | os.Root/OpenInRoot are absent from Restic product source; local storage uses os.OpenFile. Windows junction behavior excludes this Linux-only pin. |
| norm/PRECIS, ASN.1/XML, html/template and OpenPGP | Local filenames use filepath/strconv/JSON. Local file content is not parsed as those formats. Certificate/cloud/template code can be linked; fixed local operations supply no corresponding hostile input. |

This is a source-based scoped review, not a callgraph scanner or a guarantee for
all commands in the upstream executable. Adding a backend, flag, environment
variable or helper requires a new assessment. Primary advisory definitions are
available at <https://vuln.go.dev/> and <https://api.osv.dev/>; affected dependency
source is in the upstream v0.19.1 source archive.

A separate reachable availability risk was found during review: repository key
JSON selects scrypt N/r/p before authenticating the key. Creation calibration is
not an operational cap when opening modified data. Large valid parameters could
allocate gigabytes in the Host cgroup. This adapter now bounds raw key count,
envelope size, decoded fields and scrypt memory/work before calling Restic.
Every engine operation also requires a separate transient user cgroup with
verified memory/swap/CPU/task limits before launch. There is no fallback into the
Host cgroup. Idle IO priority and nice15 are verified; IO weight 10 is requested
and checked when that controller exists. The test uses a synthetic allocation
inside a 128 MiB scope to demonstrate containment; no repository OOM payload or
production fault injection was executed.

Encrypted repository blobs authenticate before zstd decode. Raw key envelopes
remain untrusted, and holders of a valid key can still provide authenticated
large inputs. Resource budgets therefore remain required even with encryption.
Current OS isolation of unrestricted model shells from the runtime secret is a
separate activation gate; ordinary status, file grants and logs never contain it.
