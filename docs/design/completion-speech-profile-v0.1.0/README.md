# Completion speech profile 0.1.0 — draft

First prompt candidate for Server #152 / T1 #153. Not installed, model-tested or
approved as a native parser contract. This directory is a review artifact, not a
decision about the production plugin's source repository.

## Integration contract

Inject only the fixed Skill body into an opted-in native submission. Keep its
bytes, instruction slot and ordering stable. Pin the profile per Conversation;
reuse the native instruction mechanism without appending duplicate history
messages. Do not inject this README or attribution at runtime. Availability in a
Skill catalog alone must never enable speech; enforce explicit opt-in in the Host.

Current title and authenticated Conversation/turn/completion identity are Host
metadata. Bind the extracted brief to the actual final assistant response and
native turn; never accept a marker found in user/tool text, historical replies or
quoted examples as proof of identity. If dynamic metadata must reach the model,
place it at the current-input tail, outside the fixed profile.

The proposed `coffee-speech` fenced JSON block is a candidate transport, not a
security boundary. The implementation must validate placement, exact field types,
version, bounded size and unique current-turn origin. Treat ambiguous/duplicate,
malformed or incompatible blocks as unavailable, preserve the original answer
and apply truthful status fallback. A marker alone never establishes settlement.
Only remove a validated metadata block from the display projection; never rewrite
native history. Validate native output-schema compatibility before adopting this
format for each adapter. Keep metadata out of spoken text and the full-answer UI.

The Host prepends the current title once for playback. Character/word ranges in
the profile approximate a short brief; actual time depends on voice and language.
The plugin must bound playback and never truncate away material failure/uncertainty.

Disablement removes future active injection without erasing historical messages.
Do not rely on the model to manage lifecycle, cache retention, playback eligibility
or account isolation. Prompt stability does not guarantee provider cache hits.

## Review examples (not injected)

- Verified fix: “登录问题已修复，相关测试已通过。目前还没有部署。下一步请在测试环境验证登录。”
- Unverified change: “代码已修改，但测试没有跑完，暂时不能确认问题解决。需要先恢复测试环境再验证。”
- Failure: “部署失败，新版本尚未上线。失败原因是目标服务无法连接，需要先恢复连接。”
- User question/approval wait: no speech block.
- Exact JSON-only response: preserve the requested JSON; omit the extra block.

These are synthetic examples, not statements about the current project.

## Pending verification

Use the existing submission/native-adapter and browser-controller seams: valid
final result, failure, uncertainty, clarification, exact-format output, quoted
marker, duplicate/malformed blocks and preserved code/downloads. Check successive
unchanged turns, title changes, restart and plugin upgrades for stable pinned
instructions. Any live model probe must be bounded and sequential. No such probe
has been executed for this draft.

## Attribution

Adapted from the action-focused, concise output principles of
[ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), pinned at commit
`1ecea1993b7fce257ffbd686c070948b5e07eda6`, specifically its
`skills/i-have-adhd/SKILL.md`. See LICENSE.upstream for the original MIT notice.
This adaptation excludes diagnostic assumptions, permanent activation, unsolicited
time estimates and global modification of the user's requested answer format.
