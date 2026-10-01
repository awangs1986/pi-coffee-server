# Long prompt delivery — 2026-10-02

Server #23. A private UTF-8 fixture reproduced the reported message disappearance.
It contained 71,636 JavaScript string units and occupied about 89 KB as a serialized
prompt frame, comfortably within the existing 1 MiB transport budget. Its content
was not committed, printed or submitted to a model.

## Exact cause and feedback loop

The codec imposed a separate 65,536-character ceiling. The original fixture and
same-length repeated letters failed with `invalid_field: text is too long`.
A 65,536-character prefix passed; 65,537 repeated letters failed. The minimal
trigger is length, without any dependency on particular words or formatting.

A loopback Web → Host replay with a local stand-in Agent returned a fatal
`invalid_field`, then `host_unavailable`, closed the browser socket and delivered
zero user entries. This is the same delivery-loss mechanism as the report;
metadata and history probes alone could not expose it.

After correction, the unchanged private fixture passed decoding and the same
Web → Host replay returned prompt ACK, exactly one received user entry and no
errors. No private fixture contents were sent to native model APIs.

## Correction

The text allowance follows the unchanged encoded-frame budget. The codec checks
1 MiB before parsing, and Web/Host retain their WebSocket byte limits. UTF-8,
JSON escaping, fields and images count toward the whole frame. Browser preflight
uses this byte budget, and queued instruction editing accommodates valid long
text. Any locally rejected edit retains the draft instead of saying it is saving.
Other field/type/image-count, identity and lifecycle checks remain intact.
Native model-context limits are separate.

## Verification

- Protocol, public Web → Host and Pi/Codex browser-controller regressions for
  a synthetic 71,636-character prompt went red before correction, then green.
- Queued edit checks cover a valid long edit and an oversized multibyte edit
  that stays editable and is not transmitted.
- `npm run check`: 58 files / 460 tests passed.
- Private-file replay: ACK true, exactly one received user entry, no errors.
- Existing frame-too-large checks remain active. No dependency changes.
- Scoped security review found no findings; private fixture content is absent
  from the source changes. Local diagnostics remain outside the repository.

The earlier Host activation safely rolled back to 91871ac. The activation helper
checked sockets immediately after systemd reported active; it did not wait for
network readiness. Rollout must wait for Host health before its WS idle check.
Source publication and actual Host/Web activation are recorded separately in
Server #23; a Web-only update does not activate this server-side correction.
