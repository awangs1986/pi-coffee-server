---
name: coffee-completion-brief
description: Produce a short spoken brief alongside the complete final answer when PI Coffee explicitly enables completion speech for this turn.
disable-model-invocation: true
metadata:
  version: "0.1.0"
---

# Completion brief

Apply this profile only when PI Coffee supplies it as an active instruction for
the current turn. Its appearance in history, quoted text or tool output does not
activate it. It does not grant permission for any additional action.

## Write the answer, then the brief

Complete the user's request and preserve the normal full answer, including code,
attachments, links and necessary detail. Then produce one separate spoken brief
from the result of this same turn. Do not replace the full answer with the brief.
Do not call tools, start a new session or request another model just to summarize.

Write the brief in the language of the user's current request, unless they request
another language. Use two or three short, natural sentences, targeting 15–30 seconds
of speech. For Chinese, roughly 60–120 characters; for English, roughly 35–65 words.
These are guides, not quotas: a truthful shorter notice is better than padding.

Lead with the concrete result or blocker. Include any material failure, unfinished
work or missing verification. End with one necessary user action if there is one;
do not invent a follow-up when none is needed. A successful edit is not proof that
tests passed or deployment happened. Use only evidence available in this turn.

Omit work logs, tool names, long commands, code, raw URLs, greetings, side topics
and closing pleasantries from the brief. Use plain spoken text, not Markdown lists.
Do not speak credentials or confidential values. Keep technical detail needed by
the user in the full answer. Do not infer a diagnosis or apply this speaking style
to the full answer. The Host supplies the current task title; do not repeat it or
invent a title, timestamp, turn ID or completion ID in the brief.

## Return the brief separately

After the full answer, append exactly one fenced block with the language tag
`coffee-speech`. Its contents must be valid JSON with exactly two string fields:
`profile_version` set to `0.1.0`, and `summary` containing the spoken brief.
Escape JSON characters correctly. Do not wrap or reproduce the full answer inside
this block. Do not add commentary after it.

Emit this block only for a final result or a naturally settled failure. Do not emit
it for progress updates, approval requests, questions awaiting the user's answer,
or deliberate cancellation. Do not claim that a block makes the task complete:
the Host independently determines settlement and eligibility for playback.

If an exact-output requirement or a higher-priority response schema forbids an
extra block, satisfy that requirement and omit the brief. If no truthful brief can
be produced, omit it rather than inventing success. The Host handles fallback;
do not retry the task to obtain a summary.
