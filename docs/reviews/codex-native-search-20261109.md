# Codex native search: provider qualification

Tracking: [Server #166](https://github.com/awangs1986/pi-coffee-server/issues/166).
This is a native configuration repair. Server 1.03 records the contract and
evidence; Browser, Host and adapter runtime code is unchanged from 1.02.

## Reproduction and cause

The reported conversation advertised a hosted Apps search tool whose invocation
returned `MCP tool codex_apps/search_service.web_run is not available to the model`.
An independent small query reproduced that rejection. Web/Host health and public
site requests succeeded; opening a TCP port would not repair this tool-policy
response. The unavailable browser fallback was a separate capability.

The installed binary was native Codex 0.163.0. Its selected custom provider alias
used the official ChatGPT Codex endpoint and native account authentication, but
was not named the built-in OpenAI provider and omitted
`supports_standalone_web_search`. Current model metadata had
`use_responses_lite: true`. App Server nevertheless reported
`{imageGeneration: true, webSearch: true}`: this does not attest that the native
standalone executor was registered for a turn.

Upstream source at the installed tag establishes the chain:

- [Search registration](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/ext/web-search/src/extension.rs) requires recognized OpenAI identity, supported actor authorization, or the selected provider opt-in, and a non-disabled search mode.
- [Tool planning](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/tools/spec_plan.rs) uses the standalone executor for Responses Lite and omits the legacy hosted Responses search specification for those models.
- [Provider defaults](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/model-provider-info/src/lib.rs) default the custom-provider opt-in to false while enabling it for the built-in OpenAI provider.
- [Official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) describes native search configuration. A separate experimental feature toggle was unnecessary for the verified Responses Lite models.

Coffee's normal task configuration did not disable search. Intentional tool-free
Fork/Handoff preparation remains unchanged. The image-delivery repair did not
modify native provider settings or transcripts.

## Verification and repair

An installed-real-CLI fixture sent synthetic turns only to a loopback Responses
endpoint, with no production credentials or paid requests. Changing only the
custom provider opt-in made native `web__run` absent with false and present with
true. Its assertion inspected Responses Lite `input` items of type
`additional_tools`, including code-mode definitions. Checking only legacy
top-level `tools` would miss the actual tool registration. Both fixture processes
were stopped afterward.

One serial, ephemeral Luna/low native acceptance used the single provider override
and one official-documentation search. It emitted native `web_search` started and
completed events with search results and completed its turn. The assertion used
those events/results, not only the final Markdown link. No new Coffee task or
review agent was created. This completed narrow test is not standing approval
for further model calls or concurrent tests.

The owner-selected native configuration was then privately backed up and only
the provider opt-in was added. Parsed TOML comparison confirmed that endpoint,
native authentication, model/thinking defaults, permissions and other settings
were unchanged. Histories and other users' task data were not edited.

## Activation boundary

The persisted configuration applies to newly loaded native configurations. The
one-turn acceptance used an equivalent temporary override before persistence.
Already loaded Host-managed processes need a separately authorized reload or
Host restart. Persistence, Web-only restart and browser refresh do not prove their
activation. Record actual restart and original-task acceptance in #166.

The hosted Apps search rejection remains an upstream limitation. This restores
independent native search; it does not grant that MCP tool access, repair an
unavailable browser, upgrade the CLI, or resolve unrelated upload backpressure.
