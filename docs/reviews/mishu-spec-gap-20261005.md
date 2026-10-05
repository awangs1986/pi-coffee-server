# MISHU 通信修复与 SPEC 差距核查 — 2026-10-05

跟踪：[Server #59](https://github.com/awangs1986/pi-coffee-server/issues/59)。

## 结论与基线

用户感觉当前 MISHU 与原设计不同，有实现依据。Coffee 入口目前主要是
**固定秘书身份 + 显式联系名单 + 原生会话消息桥 + 回执**。旧设计的任务记忆、
通信助手、长期跟进责任、低噪声终态通知和恢复并未接入。恢复性格提示和修复
消息工具调用，不等于完整恢复旧秘书协调器。

审查基线为 Server `c40f6e6bab0bf9d34bdfe1a34dc5c3898723f3f1`、插件
`0.1.4 / 857056529517a2ba12cec9748c33b583485773ba`。本次修复候选为插件
`0.1.5`，增加公共 Host HTTP/WS 回归测试；没有修改 Host 投递/权限代码。
插件源 `306b900fb35edab4ff6d6588248d1eef72db9893` 已发布不可变 v0.1.5；本报告编写时尚未部署候选，激活证据必须另行记录。

需求来源分三层，不互相覆盖：

1. 当前 Coffee [SPEC](../spec/mishu.md) 与 Issue #59：按当前 Pi Chat 显式启用，
   只联系用户选中的现有会话。此首版明确排除创建助手、后台 watcher 和自动回复循环。
2. 独立插件保留的 [下一版 SPEC](http://gitea/awangs/pi-coffee-mishu/src/commit/306b900fb35edab4ff6d6588248d1eef72db9893/docs/mishu-next-design.md)：§§1–8、P0-S、P0–P5、§10 验收、
   §§12/15 迁移与安全决策；相关 ADR-0005–0009 和 `CONTEXT.md`。
   [Coffee 接口](http://gitea/awangs/pi-coffee-mishu/src/commit/306b900fb35edab4ff6d6588248d1eef72db9893/docs/integration.md) 与入口源码提供当前实现证据。旧 SPEC 本身已注明局部实现不等于生产完成；此次不删除未满足要求。
3. [Firstmate 研究](../research/firstmate-mishu-20261005.md)：用户提供的设计参考，
   固定提交 `e5b9dddc982e546b81b4bfce754df1465270a59e`。
   旧 SPEC 明文引用 Rakazo，用户说明曾借鉴 Firstmate；研究不反推历史具体版本。

## 报告故障的实际原因

经用户授权只读检查指定任务的最新轮次、Host 状态和消息账本：原生轮次已正常
结束，最后只有“准备联系”的承诺，没有工具调用，也没有投递回执。因此不是
仍在运行的 Host 死锁，目标 Agent 实际没有收到消息。此前进度查询还存在只查
目录/空收件箱便停止的问题。此报告不记录真实任务 ID、联系对象或用户原话。

原测试使用脚本模型强制返回 `send`，证明了消息桥，但没有证明自然语言请求
会选择并执行它。新增原生 Pi/Harness 反馈环先复现空承诺零投递，再验证修复。

候选处理两项实际缺陷：

- 明确“解析已选对象 → information-only 询问 → 关联回执 → 据实汇报”的当前请求
  流程；directory 的 idle 或空 inbox 不表示项目进展。
- 对短句行动声明且本轮零 MISHU 工具尝试，`agent_before_settle` 只允许一次继续。
  重复空承诺给出可见未完成提示后结束。错误/取消/禁用/未知状态不继续；任何
  工具尝试都不自动重放。保守文本识别不能保证所有语言或元数据调用后的漏发。
- 本轮成功发送的 ID 可在 inbox 内短暂等待，初次 pending 响应后共用固定
  12 秒轮询预算；每次额外读取先检查启用状态，支持取消。超时返回已观察的
  pending 状态；老回执不启动等待，不留后台定时器，不补发消息。

原生 Pi 继续一轮需要可运行的边界条目。因此持久化一个固定、隐藏的
`pi-coffee-mishu-action-check` 审计标记，无用户内容、目标、凭据或授权。
context 在送模型前过滤它，再注入最新临时纠正。身份/性格/权限仍不写入永久历史。
12 秒是额外轮询预算；初始 HTTP 请求仍有各自的 15 秒超时，不能称总延迟为 12 秒。

## 当前 Coffee 合同逐项核查

“已实现”指代码可达且有已有/本次执行证据；未逐项重做旧 UI 验收时注明沿用证据。

| 要求 | 判断 | 可达实现与证据 |
| --- | --- | --- |
| 当前 Pi Chat 菜单安装，setup 单独授权 | 已实现，保持 | `public/app.js`、`src/host/server.ts`、插件 `coffee.ts`；菜单回归、真实原生 UI setup |
| 显式选对象/模式/确认；取消不保存 | 已实现，保持 | `coffee.ts` setup、Host setupWindow；`mishu-http.test.ts`，取消测试 |
| 最近 72 小时、新增上限 200/20、增量保留精确旧对象 | 已实现，保持 | Host directory、插件 retained set；近期目录 HTTP 与增量 setup 回归 |
| 当前标题、重命名/重启更新，标题不承担授权 | 已实现，保持 | Host status/directory、native summaries；已有 rename/restart 回归 |
| 手机/短窗口滚动，底部按钮可操作 | 已实现，沿用已部署验收 | `scripts/probe-extension-dialog.mjs`，0.1.3/cbbb701 的 Chromium 证据；此次不改 UI |
| 已选/未授权/启用/未知状态身份及默认性格 | 已实现，保持 | `coffee.ts` transient context；本次 6 个原生加载顺序用例保留状态/普通 Chat 验证 |
| 普通未选 Chat 零系统提示 | 已实现，保持 | Harness Chat 与插件 context；原生 provider payload 回归 |
| 账号 scope、source capability、exact native/workspace binding | 已实现，保持 | Host `mishuRuntime`、`MishuCoordinator.authorize`；公共 HTTP 拒绝异账号/旧 binding |
| Pi/Codex/Claude/Cursor/Grok 现有会话传信 | 已实现；真实验收有范围 | 原生 factory、Host prompt/follow-up；五 adapter fixtures。此次真实 Muse→Codex 成功；不能据此声称所有真实账号/上游额度均可用 |
| 自然请求真的发送并带回正确回复 | 基线有缺陷，候选修复已验证 | 空承诺 red→green，公共 HTTP/WS source→Codex fixture，真实 Muse→Codex 合成项目 |
| 忙目标排队、投递前再次撤权检查 | 已实现，保持 | Host session.enqueue/command；排队后禁用取消回归，不中断原目标任务 |
| stable ID 去重、硬大小预算、私有原子持久化 | 已实现，保持 | Host send/change/save；重试内容冲突/4001 字符拒绝/重启回执测试 |
| 只通知与授权执行分开；原生审批不代答 | 已实现，保持；意图证明有限 | Host allowInstructions + authorizationRef 检查，目标原生审批；自由文本 reference 不是独立授权证据 |
| 取消/禁用/换 binding 后不继承权限 | 已实现，保持 | Host sourceBinding/authorize + plugin status；新增等待期取消/撤权测试 |
| 回执迟到的当前请求跟进 | 候选部分改进 | 本轮 ID 的有界等待成功；超过预算需用户之后主动查询，没有主动通知 |
| 只观察近期实质项目活动，不唤醒目标 | 缺少专门接口 | directory 只有运行状态，inbox 只有已有消息；没有 recent-work/inspect 工具，不能把 idle 当完成 |

## 原设计清单与迁移缺口

| 旧清单 | Coffee 状态 | 证据与未完成内容 | 后续优先级 |
| --- | --- | --- | --- |
| 定位 §§1–3：理解、认识团队、选择、跟进、审批、记忆 | 部分 | 明确选中联系人、当前请求传信可达；跟进/记忆/临时执行者未迁移 | 核心产品差距 |
| CONTEXT：Managed Task / Task Brief | 缺失 | 没有独立持久任务摘要、关键点、责任和结案；标题和 receipts 不等价 | 高 |
| CONTEXT：Primary Secretary 持续可对话 / Communication Agent | 部分/缺失 | 目标执行在其原生会话；主秘书同轮等结果仍占用当前 run，无独立通信助手 | 中 |
| CONTEXT：index 优先级及同目标串行 | 部分 | Host follow-up 队列串行；未暴露秘书可调整的 index/优先级/任务队列管理 | 中 |
| §5/P1：精确执行者、无猜测/自动改派 | 基本保持 | 用户选定 ID/binding，重复核验；不创建新目标 | 保持 |
| P0-S/ADR-0007：双向 Target Attestation、Project Scope、Quarantine | 未等价迁移 | Host 有双方记录/绑定检查；无独立接收者 role/root attestation、原 quarantine 和对抗 Gate。不能称旧 P0-S 完成 | 扩展执行前高 |
| P0-S/ADR-0008：结构化 Handoff 与中立 Artifact | 部分 | text/结果 4000 硬预算、脱敏和 contact mode；没有结构化事实/动作 schema、artifact hash/range/retention。短文本也可能包含未筛选 dump | 高 |
| P0：Assignment 状态账本 | 部分 | Host 有 durable receipts，却没有业务 Managed Task/Assignment 的完整状态及验收证据模型 | 高 |
| P0：reload 对账、Outbox、exact-once terminal 通知 | 未迁移；当前首版范围不同 | 重启未结 receipt 标 uncertain，不自动回放；没有终态通知责任和 ACK。不等同于可靠通知 Outbox | 高，需范围决定 |
| P1：临时 Subagent 3/6 共享预算、去重、retry lineage | 未迁移；首版只联系现有会话 | `mishu-delegation.ts` 等遗留源码在，但 `coffee.ts` 不导入。消息 stable ID 去重不是委派去重 | 中，需范围决定 |
| P1：同任务长期/临时执行者互斥 | 缺失/当前仅一类 | 尚无跨执行者任务身份账本；不能因未提供临时助手就称旧规则全部验收 | 中 |
| P2：MEMO/偏好/项目约定持久记忆 | 未迁移 | 固定性格和原生历史可保留当前偏好，不是透明可编辑、带来源的长期秘书记忆 | 高 |
| P2：Role/Memory/Daily/Live Directory 预算 composer | 部分 | 固定有界临时身份 + 按需目录；`context-composer.ts`、`daily-context.ts`、`role-memory-context.ts` 未进入 Coffee | 高 |
| P2：历史/外部数据不可信、敏感清洗 | 基本边界保持；完整旧验收未迁移 | 工具指导不信任结果，Host envelope/clean；没有跑完整旧跨来源/跨项目污染矩阵 | 保持并扩展 |
| P3：riskClass、审批 TTL/一次性/审计集中路由 | 未迁移；原生审批留在目标 | `approval-router.ts` 非 Coffee 入口；当前不是秘书中心审批界面 | 中，需范围决定 |
| P3：不可伪造的 Authorization Evidence provenance | 部分/不足 | setup 明确授予能力，每单执行 reference 由模型填写；不是 cryptographic 或独立用户请求关联证明 | 扩展执行前高 |
| P4：统一 activity、可信结果分类 | 部分 | 状态/结果 bounded，提醒 settled 非业务验收；缺统一 Assignment/delegation 成果摘要模型 | 高 |
| P4：阻塞/失败/终态/阈值变化低噪声提醒 | 未迁移；当前明确排除 watcher | 没有无变化静默、一次终态通知责任的 active loop | 高，需范围决定 |
| P4：status/doctor、预算/阻塞/审批健康 | 缺失 | `/mishu` 仅当前配置/联系人，不是旧 `/mishu status` / `doctor` | 中 |
| P4：readable history/inspect | 部分 | inbox 原始 bounded JSON 交模型解释；无独立管理 history/inspect 工具 | 中 |
| P5：唯一 runtime composition 与真实重启闭环 | 部分/未完 | Coffee 简入口可安装卸载，native Host 接替 pane；旧模块仍遗留，不能称旧 P5 完成 | 后置 |
| §10：全生产隔离/Artifact/委派/审批/低噪声验收 | 未完整执行 | 当前 HTTP/WS 和真实合成通信只覆盖首版 + 本次缺陷，不能替代旧矩阵 | 分阶段 |
| §12/ADR-0009：旧状态、运行/开发/QA 与授权迁移 | 范围不同/部分 | 新 Host 账号工作区与隔离测试根，无旧 MEMO/授权自动导入；不能继承旧调度权限 | 保持隔离 |
| CONTEXT/遗留 WeChat Residency、接收/ACK/恢复 | 不在当前 Coffee 范围 | 原模块保留但无入口/凭据/常驻接入；用户此次未要求搬迁微信 | 另项需求 |

**这些是迁移缺口，不是建议直接复活 Herdr pane、旧 WeChat 规则或整屏交接。**
现有 Host、原生 Agent 和账号隔离应继续作为运行基础。Firstmate 值得吸收的是
持久责任、相关回复结案和预算化恢复，而不是第二套终端生命周期。

## 测试审计：数字不能替代产品闭环

本候选独立包 127 项检查通过，但多数属于保留的遗留模块。可达 Coffee 路径包括
9 个 `coffee.test.ts` 测试、6 个实际 native Pi/Harness RPC 用例，以及 package-loader
的 Coffee 入口用例。不得把 127 全部称为当前秘书用户流程测试。

| 测试主张 | 验证结果 | 边界 |
| --- | --- | --- |
| 说要联系后零工具就结束，会得到一次纠正并真的投递 | 原生两种加载顺序 red→green | 脚本模型、真实 Pi/Harness；不证明所有自然语言 |
| 模型反复空承诺不会无限请求 | 仅一个额外 provider request 后结束，有未完成提示 | 不隐式提高权限 |
| 询问信息不用代码执行授权，也不扩大目标 | 真实 Muse 路由与 Codex 状态回信 | 隔离合成会话，仅当前明确询问 |
| 延迟短回信可在同请求内返回 | 原生真实 Muse→Codex 候选通过 | 超过轮询预算仍 pending，需用户再问 |
| 撤权/取消停止等待；老回执不启动轮询；预算不续期 | public extension + HTTP gateway 通过 | 无后台通知保证 |
| 旧 binding 必须拒绝 | public Host HTTP 回归保护 | mutation 删除 Host exact binding 后失败 |

Mutation probes 三个、存活零：删除空承诺 hook，使两种原生加载顺序失败；删除
exact binding 检查，使公共 HTTP 拒绝测试失败；绕过 inbox 有界等待，使迟到回信
测试失败。所有 mutation 已恢复。这是定点探针，不是穷举证明。

## 实际验收证据

所有真实模型测试只用合成项目/会话，不重放、修改或清空报告任务。

- 初次真实 Muse→Codex 已成功发出并收到回信，但 Codex 没执行通知中的文件检查；
  此测试未达到标记验收。仅信息通知不应被当成新的项目工作授权。
- 改用用户单独明确授权的只读准备轮，目标先观察合成 `status.txt`；之后秘书仅询问
  目标已有状态。通信成功，但未加等待时需第二次用户查询回执。
- 最终候选相同隔离流程：一次 information-only 投递，关联 settled 回信含预期
  `MISHU_REAL_CODEX_REPLY_OK`，秘书同轮汇报，tracked files 无变化。

私有合成证据目录：`/home/awang/tmp/verify-mishu-real-codex-JkTRrs/evidence.json`。
原生空承诺、等待 red/green/mutation 日志位于本地忽略的 `.scratch`；没有用户 transcript
进入提交或 Issue。最终 Server/fresh-clone 检查与发布 SHA/部署探针另记 Issue。

## 后续建议顺序

1. 完成本次消息修复的发布/上线验收，保留 setup、原生 binding 和撤权约束。
2. 设计 Managed Task/Task Brief 和相关回信责任账本，定义待回复、已回复、待用户决定、
   uncertain 与验收证据；先做好只读询问和手动回执汇报，不把通知当完成。
3. 恢复透明的偏好/项目约定记忆和可编辑摘要，来源可追溯，旧记忆不继承执行权限。
4. 若要恢复“秘书主动跟进”的原体验，明确低噪声通知/Outbox/重启恢复范围，再增加
   用户显式开启的监督机制。当前 repair 不授权后台 watcher。
5. 临时助手、中心审批、微信等单独迁移；增强执行前先补独立授权证据与接收者验真。
