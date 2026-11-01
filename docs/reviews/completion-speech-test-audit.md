# Completion speech test audit

Scope: Server #152 and T1–T5 (#153–#157). The public seams are the authenticated
Host HTTP/WS, native submission/provider boundaries and browser controllers.
This report distinguishes controlled request/DOM behavior from audible voice
quality and provider cache metrics, which require actual platform observations.

## Claims

The claims are written in the owner's language for review. Each describes what
an assertion protects, rather than restating an implementation method name.

1. 播报前只领取当前结果一次；播放不会发送已读回执或新的模型请求。
2. 非指定浏览器不会领取或播放结果。
3. 播放权转移时立即取消音频，即使浏览器没有发送结束回调。
4. 主动取消语音会结束等待，不依赖原生结束事件。
5. 默认选择匹配语言的声音，可指定声音；超时后释放等待和计时器。
6. 语音失败后暂停自动播放，直到用户显式恢复；重播只读取已有摘要。
7. 归档或取消选中正在播放的对话会立即停止该对话的语音。
8. 待播超过十条时丢弃最旧项，播完其余项后不会重新出现；不会因此标记已读。
9. 领取时重新检查已读、结果替换、播放浏览器和并发占用，重启也保留尝试记录。
10. 关闭总开关后不补播旧队列；摘要文本过期不删除已尝试的结果身份。
11. 五分钟边界内可补播，超过边界不可补播；删除和归档会撤销对应结果。
12. 延迟的上一轮回调不能把旧摘要附加到新结果。
13. 即使查询任务时正在等待 I/O，新一轮开始也能使旧回调失效。
14. 已读摘要可显式重播，但不改变已读状态或原生提示词；其他浏览器不能领取。
15. 声音偏好能够恢复并受长度限制，改变声音不改变任务的提示词。
16. 历史摘要可手动重播，归档或不属于当前账号的任务不可重播。
17. HTTP 设置、任务选择和浏览器归属按账号独立持久化，非法或越界输入被拒绝。
18. Pi 和 Codex 只在开启的原回合使用同一固定摘要提示词；关闭后停止注入。
19. HTTP 并发领取和 Host 重启不会重复播报，也不启动额外 Agent。
20. 原生 Pi 的连续回合保持固定系统提示位置、工具和模型，用户历史不堆积 Skill。
21. 可选插件加载失败时，Host 和普通原生任务仍能运行。
22. 独立插件可使用合成 Host 适配器；工具消息不能冒充本轮摘要。
23. 只有已记录且同时匹配原生消息身份和完整原回答的摘要可折叠，代码、下载链接和展开状态保留。
24. 摘要已读证明要求匹配的结果身份和可见内容，分页完整回答的控件仍可用。
25. 其他账号的延迟元数据不会用于当前界面；展开和渲染不会发送模型输入。
26. 点击摘要重播使用记录的结果身份，不创建新的原生输入。
27. 超过原截断长度的回答仍按整体内容绑定摘要；摘要存储不复制完整回答。
28. 展示摘要缓存过期会回收文本，但保留已尝试的播报身份。
29. 首次授权失败后可以恢复控件，试听不调用 Agent；账号切换会取消音频并清理监听器。
30. 关闭总开关先同步停止音频，再保存设置；对话开关位于对话操作菜单。
31. 原生 Codex 保留默认和计划模式的原有指令，同一提示词复用不重建线程或改变模型及思考强度。
32. 准备原生提示词不枚举会话；每次播报操作只读取一次标题快照，下一次领取会读取重命名后的标题。
33. 相同内容对应多个结果时依赖原生消息身份；旧缓存淘汰、缺少身份或分页时均不能用内容摘要猜测结果，身份不明则保留完整回答。

34. 最终追问带有明确等待用户的标记时不播报；界面只移除已授权元数据，保留问题正文。
35. 错误版本的摘要或等待标记，以及损坏、冲突、过长或重复标记，只能触发真实状态回退，不能冒充有效摘要。
36. 对话保留已固定的提示词版本；不支持的版本明确报告且不自动替换，也不阻止普通任务。
37. 即使旧结果已经通过首次校验，在最终资格检查等待 I/O 时开始新一轮，旧摘要也不能写入持久状态。
38. Web 只提供两项明确允许的插件浏览器资源，任意其他插件路径不能借此读取文件。

39. 从未开启播报的 Pi 对话不发送私有关闭指令；状态未变不重复发送控制指令，也不制造消息或运行事件。
40. Pi 多个文本块按原生历史的相同规则连接，摘要绑定不会因换行差异失效。

Read these as business rules. Is any of them wrong?

## Coverage and mutation probe

Initial probe: ten independently chosen business-rule mutations on the integrated
T1–T4 candidate. Eight were killed and two survived. Every mutant was restored
before the next probe; mutation runs used a separate audit worktree.

| Rule deliberately broken | Initial result | Repair disposition |
| --- | --- | --- |
| Ignore profile-version mismatch | Survived | Add current-turn result and waiting-envelope rejection cases |
| Admit a completion beyond the five-minute boundary | Killed | Boundary assertion protects admission |
| Allow eleven pending results | Killed | Overflow/durable-drop assertion protects the bound |
| Allow a non-designated browser to claim | Killed | Scoped HTTP claim assertion protects ownership |
| Allow an already-read result | Killed | Late-read assertion protects delivery eligibility |
| Allow concurrent active claims | Killed | Concurrent-claim assertion protects serial playback |
| Omit durable attempt receipt | Killed | Restart/backlog assertion protects deduplication |
| Ignore answer digest | Killed | Exact-answer presentation assertion protects binding |
| Omit admission recheck after eligibility I/O | Survived | Add a race after initial admission but before commit |
| Reacquire Codex instructions on every turn | Killed | Native request evidence protects stable reuse |

Final re-probe after review repair integration: **11 mutants, 0 survivors**.
The version mismatch mutant is killed by both the wrong-version summary and
wrong-version waiting tests. The final-admission mutant is killed by a race that
blocks after the first admission check, then starts a new submission before commit.
The additional native-message-identity bypass is killed by the historical-answer
identity assertion (claims 23 and 33), independently of digest validation.
All source bytes were restored and the audit worktree remained clean. Logs:
`/tmp/coffee-speech-accepted-mutant-01.log` through `-11.log`; machine-readable
results: `/tmp/coffee-speech-accepted-mutations.json`. This bounded probe is not
exhaustive mutation coverage.

| Scope / acceptance requirements | Claims | Evidence boundary |
| --- | --- | --- |
| T1 opt-in, native settings, profile pin, provenance/fallback, optional failure | 17–22, 27, 31–32, 34–36 | Authenticated Host, native submission and provider requests |
| T2 exact authorized projections, original answers, read proof and replay identity | 23–28, 33–34 | Browser controller and scoped projection API |
| T3 bounded queue, deduplication, freshness, lifecycle and delayed captures | 8–13, 19, 28, 37 | HTTP, controlled clock, persistence/restart and browser effect |
| T4 voices, user controls, recovery and no model/read side effects | 1–7, 14–16, 29–30 | Voice boundary, account-scoped API and UI controls |
| T5 real browser integration, installation and served resources | 38 and all integrated journeys | Actual Chromium/Web/Host/Transfer path; candidate acceptance record |

The original two coverage gaps were repaired with red tests and the focused suites
returned green. No mutation survivor remains. Native-envelope quality on a hosted
model, actual speaker audibility and provider cache-hit statistics are outside the
claims of synthetic provider and speech-effect tests; they are explicitly disclosed
rather than inferred from green tests.
Audible platform voice quality, closed-browser behavior and unavailable provider
cache counters cannot be proved by these assertions. Browser synthesis is a
replaceable effect in automated checks; the real Browser/Web/Host/Transfer path
is verified separately in the T5 acceptance record.
