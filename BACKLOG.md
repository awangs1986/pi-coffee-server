> Source authority and repository placement: superseded where conflicting by [ADR-0020](docs/adr/0020-unified-github-authority.md). GitHub pi-coffee-server owns Web and Host.

# PI Coffee Backlog

> **当前新增决策（2026-09-21）**：[ADR-0012](./docs/adr/0012-owner-privileges-and-gitea-checkouts.md) 接受 VM owner + 无限制 sudo、Gitea 代码权威与每 Conversation 独立 clone；[T0–T4](./docs/development/t0-t4-gitea-workspaces.md) 的 Agent/Server 代码、双 User VM、2 × 3 Conversation、VM 快照回滚与普通用户对称私库验收均已落地，[真实证据](./docs/reviews/t0-t4-implementation-20260921.md)已记录，T0–T4 已完成。替代以下历史工作区/本地合并条目时以该合同为准。

> **2026-09-21 仓库拆分**：本文件保留历史产品 Backlog，但当前仓库的执行范围只包括 Agent Runtime。Web UI、统一网关、身份、固定路由、Relay 和 Server 部署进入 [`awangs/pi-coffee-server`](http://gitea:3000/awangs/pi-coffee-server)；新工作按两个仓库各自 Issue 追踪。

> **工作台产品排期**：[P0–P5（仅 Pi Agent 讨论前的产品 SPEC）](./docs/development/product-priorities-20260916.md)。与下方 Pi/工具交接记录分开，以此安排产品增量开发。

> **Pi Agent 当前规格入口**：[主 SPEC](./docs/spec/pi-agent.md)统一维护 PA 决定、Chat/Work、未决项、实现状态与验收；[Work 专项 SPEC](./docs/spec/harness-prompt.md)维护 WP 规则。下方 2026-09-02/03 的模式、工具表和完成记录是历史切片；被替代的设计不得重新作为当前要求。Gitea 已同步本轮实现和目标机证据；T0–T4 的未满足项以 #33–#36 的最新验收评论为准。


> 讨论汇总日期：2026-09-02\
> 本文件把今天多轮设计讨论整理成可执行、可验收、可追踪的 backlog。它不是聊天记录的逐字导出，也不包含任何密钥、Cookie、VM 凭据、完整对话或用户文件。

## 这份 Backlog 解决什么问题

今天讨论持续了多个小时，内容横跨产品边界、VM 拓扑、身份、LLM 转发、文件/图片、浏览器生命周期、部署自动化、V5 关系和后续架构。此前的文档已经记录了稳定决策，但没有把“为什么做、先做什么、哪些暂缓、哪些明确不做”放在同一张工作清单中。

因此本文件同时承担三项职责：

1. 作为讨论结论的索引，避免同事只能从零散 Issue 猜测背景。
2. 作为 MVP → 0.1 → 后续版本的交付顺序和依赖表。
3. 作为新增 Gitea ticket 的拆分基线；Issue 的状态和验收评论仍然是执行权威。

Gitea 入口：[Issue #13：PI Coffee 今日讨论全量 Backlog](http://testpc:3000/awangs/pi-coffee/issues/13)。它已放入 [项目 1 的 `Backlog` 列](http://192.168.100.232:3000/awangs/pi-coffee/projects/1)。完整条目以本文件的当前 `main` 版本为准，Issue 用于讨论、认领和验收链接。

## 权威顺序与范围

| 层级 | 权威内容 |
|---|---|
| 1 | [Gitea Issues](http://testpc:3000/awangs/pi-coffee/issues)：状态、负责人、依赖、验收证据 |
| 2 | ADR：不可逆的架构决策 |
| 3 | 代码与测试：已经实现的行为 |
| 4 | 本 Backlog 与 `docs/spec/`：计划、范围和讨论索引 |
| 5 | Gitea Wiki：给同事浏览的镜像，不取代 Git 中的版本化文档 |

范围只包括独立仓库 **PI Coffee**。现有 Picode 最新 Gitea 版本称为 **V5**，是冻结参考，不是本 backlog 的工作树，也不是本 backlog 的代码依赖。

## 状态标记

| 标记 | 含义 |
|---|---|
| `DECIDED` | 讨论已经作出决定，后续实现不得擅自改义 |
| `DONE` | 代码/文档/测试已在当前 `main` 中完成；Issue 仍需按验收流程关闭 |
| `READY` | 范围和验收条件明确，可以开始实现 |
| `DISCOVERY` | 需要工程验证或小型 spike，不等于改变产品决定 |
| `LATER` | 明确延后到 0.1 之后或另一个版本 |
| `HOLD` | 明确不做，除非前提发生变化 |
| `OPEN` | 需要补充一个具体工程选择；不能阻塞已确定的 MVP |
| `SUPERSEDED` | 设计已由链接的新规格取代；保留追溯，不再作为目标要求。既有兼容实现是否保留另看源码与迁移计划 |

## Pi Agent 持续维护入口（2026-09-20）

- [PA 主规格](./docs/spec/pi-agent.md)：已确认决定与 PA-Q 未决项、PA-AC 验收与当前检出实现分别记录；PA-011 精简 Work 工具集合，PA-012 要求 Skill + CLI 的完整 LSP 中间层。
- [LSP 中间层](./docs/spec/lsp-middle-layer.md)：V1 CLI、Skill、TS/Python Profile、按需复用和 3×3 真实模型门槛已完成；故障/性能矩阵与 V2 编辑仍有待办。不采用 MCP，不依赖 pi-lens。2026-09-21 Gitea 连接失败，实现证据与依赖待同步。
- [WP 提示词规格](./docs/spec/harness-prompt.md)：唯一正文、稳定行为规则、工程预算与持续维护的验收样例。
- 下一步只按已确认范围推进：模式/工具清单问题先逐项对齐；上下文统计与真实模型调用质量仍需代码/实测证据。Work 正文已做本地验证，不等于新模式已发布。
- Gitea 同步待恢复；下方 `HARNESS-001/002` 等 `DONE` 是当时的切片记录，不表示 Chat/Work 已完成。不要在本 Backlog 复制一套主规格正文。

---

## Native Codex and Claude Code integration (2026-09-23)

- **D-046 / DECIDED**: support the user's own native Codex and Claude Code through Host Adapters; preserve their native design and official user authentication. Pi prompts, Chat/Work behavior, tools, LSP, plugins and context policies remain Pi-only.
- **Implementation sequence**: [M0–M5](./docs/development/native-agents-m0-m5.md) defines six delivery Issues under Agent #48 and Server #6. M0 validates native interfaces; M1 establishes the shared contract; M2/M3 deliver Adapters; M4 adds Browser support; M5 proves and releases the integrated workflow. M0–M5 are merged and deployed on both User VMs and the separate Web host. See [M5 evidence](./docs/reviews/native-agents-m5-20260923.md) and the bounded [M0–M4 checks](./docs/reviews/native-agents-m0-m4-20260923.md).
- **Owner-confirmed selection rule**: new Tasks choose Pi, Codex or Claude Code once at creation. The engine is immutable; model selection stays within that engine. Another engine requires a new Task.
- **M0–M5 implemented and deployed**: [maintained SPEC](./docs/spec/native-agent-engines.md), [ADR-0013](./docs/adr/0013-native-agent-engines.md), Agent delivery [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48) and Server companion [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6). Existing Pi behavior remains supported.
- Reuse fixed User VM routing, one Conversation/Workspace, independent clones and Gitea Checkpoint/PR management. No platform worktree, new provider account system, subscription relay or wholesale UI redesign.
- Primary acceptance remains the existing public Host HTTP/WebSocket seam plus a small real-engine workflow. Issues own implementation status; this entry records design and scope only.

## 1. 讨论结论登记（Decision Register）

下面的登记表覆盖今天讨论中形成的产品、运行和工程约束。详细定义放在链接文档中；这里保留决策、影响和交付位置，方便追溯。

### 产品边界、仓库和用户

| ID | 状态 | 结论 | 交付影响 |
|---|---|---|---|
| `D-001` | `DECIDED` | 产品名称为 **PI Coffee**。 | 所有新代码、Issue、部署和交接使用 PI Coffee 名称。 |
| `D-002` | `DECIDED` | `awangs/pi-coffee` 是主仓库，独立于 Picode。 | 同事从该仓库和 Gitea Issues 开始工作。 |
| `D-003` | `DECIDED` | Gitea 上现有的唯一最新 Picode 版本定义为 **V5**，保持不动；早期误称的 V4/其他历史版本不属于本计划依据。 | 禁止把 V5 拆分、重命名、回移植或作为当前实现的隐式依赖。见 [ADR-0002](./docs/adr/0002-v5-is-a-frozen-reference.md)。 |
| `D-004` | `DECIDED` | 第一阶段以未修改的原版 Pi Agent 为最小 MVP。 | 先证明 Browser → Web Server → Host → Pi 的闭环，再逐步增加能力。 |
| `D-005` | `DECIDED` | 目标使用者是内部用户，不做公共 SaaS。 | Gitea、Web、Host 和控制面按内网部署假设设计。 |
| `D-006` | `DECIDED` | 交付单位是可执行 tickets；工作、状态和验收证据进入 Gitea Issues。 | 本文件是 backlog 索引，不能代替 Issue 的验收评论。 |
| `D-007` | `DECIDED` | Gitea 是唯一的人类身份和 ticket authority。 | 0.1 使用 Gitea OAuth；不要另造一套用户身份源。 |
| `D-008` | `DECIDED` | Gitea 只是本地/服务器之间以及少量用户之间的协作中转站，不是最终代码仓库。 | 不把最终归档、公共发布或额外治理流程塞进 PI Coffee。 |
| `D-009` | `DECIDED` | Gitea 不开放互联网；不额外设置分支保护策略。 | 特权动作由账号权限保护；网络边界和密钥仍必须按运行手册配置。 |

### VM、主机和数据归属

| ID | 状态 | 结论 | 交付影响 |
|---|---|---|---|
| `D-010` | `DECIDED` | 使用现有超强服务器承载隔离 VM；PI 和相关运行组件在 VM 中运行。 | 设计针对稳定的内部服务器，而不是托管商的多租户环境。 |
| `D-011` | `DECIDED` | Debian VM 承担 Control Plane + Web Server；二者可以同 VM，但必须保持模块/进程边界。 | Web 不应因为某个 User VM 的 Pi 进程退出而丢失自身服务。 |
| `D-012` | `DECIDED` | 每个内部用户拥有一个长期运行、由用户管理的 Linux Mint Xfce Edition User VM。 | User VM 承载 Agent Host、Pi、Task、上下文、worktree 和上传文件。 |
| `D-013` | `DECIDED` | Picode/PI Coffee 不管理 VM 生命周期。 | 不创建、销毁、快照、迁移或自动恢复 VM；这些是所有者的运维动作。 |
| `D-014` | `DECIDED` | VM 快照是故障恢复手段；允许用户接受损坏并手动恢复快照。 | 0.1 要提供明确的 health、停止、恢复和验收步骤，而不是 VM 管理器。 |
| `D-015` | `DECIDED` | VM 隔离是执行安全边界。 | 不复制 V5 的进程内 Guard、审批、权限等级或命令 sandbox。见 [ADR-0005](./docs/adr/0005-vm-isolation-replaces-in-process-sandbox.md)。 |
| `D-016` | `SUPERSEDED` | 平台管理的 worktree 改为独立 Conversation clone；Gitea 负责协作和集成。 | ADR-0012 / GW-04～12 / T0–T4；V5 仍冻结。 |
| `D-017` | `DECIDED` | 持久的上下文属于 User VM，不属于 Web VM/Control Plane。 | Transcript、Pi model context、Task 文件、插件状态和 worktree 内容不进控制面数据库。 |
| `D-018` | `DECIDED` | Control Plane 只保留最小路由索引和有界 usage metadata。 | 可保存 user → fixed User VM、opaque ID、health、cursor、耗时/计数；不得保存 prompt、tool output、context 正文。 |
| `D-019` | `DECIDED` | 术语中不引入独立的 “worker” 产品组件。 | 使用 **Agent Host** 表示 User VM 中的长期进程，使用 **Pi Session** 表示其会话；文档避免含义不清的 worker。 |

### LLM、密钥和上游协议

| ID | 状态 | 结论 | 交付影响 |
|---|---|---|---|
| `D-020` | `DECIDED` | 唯一上游 LLM key 由 Control Plane 保存。 | Relay 启用后 User VM/Host 不接收上游 key；仓库、Wiki、Issue 和日志不得出现 key。 |
| `D-021` | `DECIDED` | 上游是现有 CPA 反代：`https://b.awangsawangs.xyz/v1`。 | 这是部署配置，不把凭据写进代码或文档。 |
| `D-022` | `DECIDED` | 必须保留 OpenAI-compatible Chat Completions 和 Responses 两套接口。 | 支持 `/v1/chat/completions`、`/v1/responses`、`/v1/models`、`/v1/responses/compact`。 |
| `D-023` | `DECIDED` | 普通 JSON 和 SSE 流式响应都要透传。 | Relay 不增加第二套模型协议，不整段缓存 SSE；错误、断流、超时和 backpressure 要可观察。 |
| `D-024` | `DISCOVERY` | 多级转发可能增加延迟。 | 先测量端到端首 token/吞吐/断流，再决定是否合并 hop；不能凭感觉引入额外代理层。见 `PERF-001`。 |

### 浏览器、Task、Session 和交互模型

| ID | 状态 | 结论 | 交付影响 |
|---|---|---|---|
| `D-025` | `DECIDED` | 一个浏览器标签页就是一个 Browser Shell。 | 不以多标签页作为主要交互模型；0.1 在一个 Shell 内切换多个 Task/Session。 |
| `D-026` | `DECIDED` | 一个 Shell 可以有多个 Task、多个对话，体验类似本地 Codex/Cursor。 | Task/Session ID、cursor 和状态必须可恢复，不能只存在浏览器内存。 |
| `D-027` | `DECIDED` | 刷新或关闭浏览器不打断 Host 中正在运行的 Pi Task。 | 浏览器断开只是 transport detach；重连后按 Session ID + Cursor replay/resync。 |
| `D-028` | `DECIDED` | 同一 Conversation 的 Checkout 写入串行，不同 Conversation 可并行。 | ADR-0012 取消项目级 merge 锁；跨主机接续新建独占分支，见 GW-06/10。 |
| `D-029` | `DECIDED` | MVP 先做一个文本对话；多 Task/Session 属于 0.1。 | MVP 保持窄接口，避免提前引入复杂编排。 |

### 文件、图片和隐私

| ID | 状态 | 结论 | 交付影响 |
|---|---|---|---|
| `D-030` | `DECIDED` | 上传文件直接流入 owning User VM 的当前 Conversation inbox；路径由其 Workspace 解析。 | Control Plane 不做 durable body 存储；上传过程支持断线/失败状态。Chat/Work 布局见 `D-045`。 |
| `D-031` | `DECIDED` | 初始限制为单文件 256 MiB、单批次 1 GiB。 | 服务端强制限制，不能只依赖前端校验。 |
| `D-032` | `DECIDED` | 文件校验 name、MIME 和 SHA-256，并留下可审计的有限元数据。 | 文件名要安全化；hash 用于重试/去重/验收，不把正文复制到控制面。 |
| `D-033` | `DECIDED` | 图片保留原始 bytes。模型支持时发送 image block，否则发送 User VM 中的安全路径/reference。 | 不假设所有模型都支持视觉；需要 capability negotiation 和清晰的 UI 状态。 |
| `D-034` | `DECIDED` | 不生成额外的缩略图/图片归档。 | 原图只在 User VM 持久化；Control Plane 不建立 thumbnail archive。 |
| `D-035` | `DECIDED` | 下载/引用链接必须限定 owning user 和 Conversation。 | 不能用可猜测的全局文件 URL；过期、撤销和错误状态要有测试。 |
| `D-045` | `DECIDED` | 一个任务 = 一个 Conversation = 一个所属 VM 本地 Workspace；Chat 集中于 `chats/<conversation-id>/`，Work 使用独立 Gitea Checkout。 | 附件、搜索证据、图片和工具产物按 Conversation 归档；运行模式切换不移动或静默转换 Workspace。见 [`conversation-workspaces.md`](./docs/spec/conversation-workspaces.md)。 |

### 部署、模块化和后续演进

| ID | 状态 | 结论 | 交付影响 |
|---|---|---|---|
| `D-036` | `DECIDED` | Deployment Skill 做成自动化、幂等的 PI Agent 原生 Skill。 | 安装 Pi 后可把 Skill 提供给 Pi Agent，完成 Host/systemd/enrollment/report；Skill 不管理 VM。 |
| `D-037` | `DECIDED` | 2026-09-20 owner 明确：Agent 增强只通过原版 Pi 插件扩展，保留上游升级能力。 | 当前合同归 [PA-001](./docs/spec/pi-agent.md)；不维护内核分叉，Host/Web 保持窄接缝。 |
| `D-038` | `DISCOVERY` | 可参考/folk `pi-web`，但不承诺直接套用。 | 先评估许可证、协议、维护成本和可删减部分；必要时大量改造或重写，不能牺牲 PI Coffee 窄 seam。见 `ARCH-001`。 |
| `D-039` | `DECIDED` | 尽量复用 Gitea 上已有代码，但只复用兼容且可验证的模块。 | 不为“复用”把 V5 的 Guard、Worktree 或领域对象偷偷带入 MVP/0.1。 |
| `D-040` | `DECIDED` | Rust 只在测出实际性能瓶颈后引入。 | 第一实现使用 Node/TypeScript；Rust 模块必须有基准、边界和回滚方案。 |
| `D-041` | `LATER` | 除已明确登记的 Harness 基础表外，V5 的插件、Worktree 增强及其他能力以后逐项拆分合并。 | 每个后续迁移必须单独评审、单独验收；不得借 Harness ticket 偷渡其他模块。 |
| `D-042` | `SUPERSEDED` | 该项模式方案已撤下；历史事实见 `git show b027838:BACKLOG.md`，当前设计只见 PA 主规格 | 当前目标见 [PA-002/004 与 WP SPEC](./docs/spec/harness-prompt.md)：Chat/Work 与唯一 Work 正文；不以本条要求回读 V3。旧交付见 `HARNESS-001`。 |
| `D-043` | `SUPERSEDED` | 该项模式方案已撤下；历史事实见 `git show b027838:BACKLOG.md`，当前设计只见 PA 主规格 | 运行时已迁移，当前模式与工具清单归 [PA-002/005、PA-Q01](./docs/spec/pi-agent.md)；不能把旧 8/10 当新设计。旧交付见 `HARNESS-002`。 |
| `D-044` | `DECIDED` | 本地 Web 工具接 Serper Relay；有界完整证据先留 User VM，历史只保留摘要和索引。 | 实现/失败语义见 [Web SPEC](./docs/spec/web-search-plugin.md)；新模式工具/委派分配待 PA-Q01/04，旧基础表计数不是目标约束。 |

### 1.1 被替换的早期方案

讨论过程中有几次方向调整。下面记录它们是为了防止同事把已经被否决的中间方案重新实现；最终结论以 `D-*`、ADR 和 Gitea Issue 为准。

| 早期想法 | 最终处理 | 原因/影响 |
|---|---|---|
| 直接在原 Picode/V5 目录拆分、增强 Worktree、移植插件，并让整套功能直接跑在服务器上。 | **替换为 PI Coffee 独立产品线**；V5 冻结，先做原版 Pi MVP。 | 先验证最小 Web 对话闭环，避免把未确认的 V5 设计带入新产品。 |
| 把 tickets 只放在本地或 V5。 | **移动到 `awangs/pi-coffee` Git + Gitea Issues**。 | 同事必须只依赖主仓库和内部 Gitea；Issue 是状态/验收权威。 |
| 在 User VM 内继续复制 V5 的 sandbox、Guard、权限审批。 | **不做**；VM 边界就是执行 seam。 | 用户明确接受 VM 内损坏并自行恢复快照；只有威胁模型改变才重新评估。 |
| 让 Web 服务器保存完整上下文、Transcript 或上传正文。 | **不做**；持久内容留在 owning User VM。 | Control Plane 只做路由和有界 usage metadata，避免变成内容仓库。 |
| 为了“worker”另造一个不清晰的执行层。 | **不引入 Worker 组件**；统一用 Agent Host / Pi Session / Task。 | 消除术语歧义，保持模块边界简单。 |
| 直接照搬 `pi-web`。 | **只做 fork/删改/重写评估**，不改变当前 Host/Protocol seam。 | 需要先验证许可证、协议和维护成本；能复用就复用，不能复用就重写。 |
| 立即用 Rust 重写性能路径。 | **暂缓**，先用 Node/TypeScript 测量。 | 没有可重复的性能瓶颈数据就不扩大技术栈。 |
| 先做多标签页或浏览器内持久运行。 | **一个 Browser Shell/tab，多 Task/Session；执行寿命归 Host**。 | 关闭浏览器只断开 transport，不取消任务。 |

---

## 2. 交付 Backlog

### 2.1 已完成的 MVP 垂直切片

这些条目已经在当前 `main` 实现，但 Gitea Issue 仍需由协作者按验收证据关闭。

| ID | 状态 | 内容 | Gitea | 验收证据 |
|---|---|---|---|---|
| `MVP-001` | `DONE` | 建立独立 PI Coffee 仓库、文档入口、V5 冻结边界。 | [#1](http://testpc:3000/awangs/pi-coffee/issues/1)、[#6](http://testpc:3000/awangs/pi-coffee/issues/6) | fresh clone 可读到 `AGENTS.md`、`docs/index.md`。 |
| `MVP-002` | `DONE` | Host ↔ Web 窄 JSON WebSocket 协议：`open/prompt/abort/ping/close`、ack/event/error、cursor replay。 | [#2](http://testpc:3000/awangs/pi-coffee/issues/2) | `test/protocol.test.ts`、`test/host-server.test.ts`、`test/web-server.test.ts`。 |
| `MVP-003` | `DONE` | User VM 侧原版 Pi RPC adapter、Session registry、native `--session-id` 传播。 | [#3](http://testpc:3000/awangs/pi-coffee/issues/3) | `test/pi-adapter.test.ts` 与 fake RPC fixture。 |
| `MVP-004` | `DONE` | 独立 Web Server、静态浏览器 Shell、Host Bridge、流式 `text_delta`。 | [#4](http://testpc:3000/awangs/pi-coffee/issues/4) | `test/web-server.test.ts`、浏览器入口 `/`、`/healthz`。 |
| `MVP-005` | `DONE` | 端到端测试、启动命令、分离进程配置、交接文档和远程 main。 | [#5](http://testpc:3000/awangs/pi-coffee/issues/5)、[#6](http://testpc:3000/awangs/pi-coffee/issues/6) | 当前 main `0ca71e7`；fresh clone `npm ci && npm run check`，15 个测试文件/90 个测试通过；真实 VM 验收仍见 #5。 |
| `MVP-006` | `DONE` | Codex 式白色主题浏览器 Shell：侧栏对话列表、Markdown 子集、工具卡片、停止键、本地显示缓存；静态资源白名单。 | [#4](http://testpc:3000/awangs/pi-coffee/issues/4) | `5b6a6e43`；headless 浏览器驱动截图贴在 #4。 |
| `MVP-007` | `DONE` | MVP 部署形态定为 **User VM 内 Pi + Host，服务器上 Web + Relay**；`CP-001` Relay 提前进入 MVP；两侧 systemd 单元与 env 模板（`deploy/`）；跨接口三进程分离验证。 | [#5](http://testpc:3000/awangs/pi-coffee/issues/5)、[#7](http://testpc:3000/awangs/pi-coffee/issues/7) | `test/relay-server.test.ts` 13 tests；工作站三进程经局域网 IP 的 smoke；服务器/User VM 实装由 owner 按 #5 任务书执行。 |

### 2.2 0.1 必做切片

执行顺序按依赖推进；每项都必须在对应 Gitea Issue 留下测试、部署探针或故障演练证据后才能关闭。

| ID | 状态 | 优先级 | 目标 | 依赖 | Gitea |
|---|---|---:|---|---|---|
| `HARNESS-001` | `DONE` | P0 | 该项模式方案已撤下；历史事实见 `git show b027838:BACKLOG.md`，当前设计只见 PA 主规格 | `MVP-005` | [#14](http://testpc:3000/awangs/pi-coffee/issues/14) |
| `HARNESS-002` | `DONE` | P0 | 该项模式方案已撤下；历史事实见 `git show b027838:BACKLOG.md`，当前设计只见 PA 主规格 | `HARNESS-001`, `MVP-003` | [#15](http://testpc:3000/awangs/pi-coffee/issues/15) |
| `CP-001` | `DONE` | P0 | Debian Control Plane 的透明 LLM Relay，唯一 key、双 API、JSON/SSE、models/compact、限量 metadata。**已随 `MVP-007` 提前交付**；`PERF-001`/`OBS-001` 仍归 0.1。 | `MVP-005` | [#7](http://testpc:3000/awangs/pi-coffee/issues/7) |
| `ID-001` | `DONE` | P0 | 内部 Gitea OAuth、logout/cookie 生命周期、身份撤销（allow-list）和 fail-closed。**拓扑按 ADR-0010 调整**：公司只发一个企业模型帐号，因此改为 1 Web + 1 共享 User VM + 1 Host；Web 把 Gitea 登录名经私有 Host 传输转发，Host 按用户建独立 registry、`<WORKDIR>/<user>`、`<SESSION_DIR>/<user>` 与 inbox root，互相看不到对方会话与文件。"固定 User VM 路由" 退化为 `PI_COFFEE_ALLOWED_USERS`。 | `MVP-005` | [#8](http://testpc:3000/awangs/pi-coffee/issues/8) |
| `AGENT-001` | `DONE` | P0 | **Codex CLI 兼容**（[ADR-0011](./docs/adr/0011-agent-seam-admits-codex-app-server.md)）：`src/host/codex-adapter.ts` 以 `codex app-server`（stdio JSON-RPC）实现同一个 `PiSessionFactory`/`PiSession` seam；`PI_COFFEE_AGENT=codex` 切换。每用户一个 app-server 子进程、共用一份 `CODEX_HOME` 登录，`thread/list {cwd}` 只列本人会话；不加占用锁。事件、工具、审批（confirm 对话框）、中断/追加、历史投影全部翻译到浏览器已有的协议。 | `ID-001` | — |
| `UX-002` | `DONE` | P1 | **参照 termdeck 的 Web 体验补齐（P0–P4）**：① 侧栏按"谁需要你"排序（`sessions[].attention`：`waiting` 未答对话框 / `finished` 无人在看时完成；标签页标题带计数）；② 顶栏帐号用量条（`stats.rateLimits`，Codex `account/rateLimits/read` + `updated` 推送，5h/周窗按时长分类，≤25% 黄、≤10% 红）；③ "本轮改动"停靠式审阅面板（≥1100px 右侧停靠、文件列表 +/− 跳转、随 `turn_diff` 实时刷新，窄屏回退弹窗）；④ 终端会话可见与接管（`sessions[].source`，`cli`/`exec` 线程列在"本机终端会话"，打开即 `thread/resume`，外部 turn 运行中只读并由 Host 轮询 `getState` 直到结束）；⑤ 传输下载加固（realpath 根限定、凭据文件名黑名单、`docs/INVARIANTS.md`）。不做手机端（PWA/Web Push）。 | `AGENT-001`, `FILE-001a` | — |
| `DEP-001` | `READY` | P0 | Linux Mint Xfce User VM 的 Deployment Skill、固定 Pi 版本、systemd、一次性 enrollment、report/health/stop。 | `MVP-003`, `MVP-005` | [#9](http://testpc:3000/awangs/pi-coffee/issues/9) |
| `SHELL-001` | `READY` | P0 | 单 Browser Shell 多 Task/Session、持久 ID/cursor、同 Task 串行、跨 Task 并行、refresh/close 后继续。 | `MVP-002`–`MVP-004`, `ID-001` | [#10](http://testpc:3000/awangs/pi-coffee/issues/10) |
| `SHELL-001b` | `DONE` | P0 | **会话列表与历史来自 User VM 的 Pi 会话存储**（ADR-0008）：Host `list_sessions` / `history` 帧，按 id 用 `--session <file>` 恢复，浏览器零本地缓存，空闲 Pi 进程自动停止并可恢复。owner 决策：计算全在 Host、记录永久存 VM、每次打开可见历史。 | `MVP-006` | [#10](http://testpc:3000/awangs/pi-coffee/issues/10) |
| `SHELL-001a` | `DONE` | P0 | **Extension UI 走通到浏览器**：`ui_response` 帧、confirm/select/input/editor 对话框（排队、`Esc` 取消、刷新/换设备后重发挂起对话）、notify/setStatus/setWidget/set_editor_text 呈现；Host 经 RPC 子协议回写 Pi。真实 Pi 扩展验证通过。V5 插件在网页上可"问"可"答"的前提已就位。 | `SHELL-001b` | [#10](http://testpc:3000/awangs/pi-coffee/issues/10) |
| `SHELL-001c` | `DONE` | P0 | **Codex 式体验 A/B/C**：完整 Markdown + 高亮 + 复制、工具卡（edit 用 Pi 记录的 patch）、工作过程折叠、重命名/删除/搜索/分组/列表推送、运行中排队与插话、模型/thinking 选择、斜杠命令面板、图片粘贴、用量与压缩、快捷键。缺口与排期见 [`docs/spec/web-shell-roadmap.md`](./docs/spec/web-shell-roadmap.md)。 | `SHELL-001b` | [#10](http://testpc:3000/awangs/pi-coffee/issues/10) |
| `FILE-001` | `READY` | P0 | Conversation inbox 上传、文件校验/限额、原图保存、image block/path fallback、用户/Conversation 限定下载引用。**第一切片已交付（`FILE-001a`）**：ADR-0009，Host 提供 LocalSend v2 传输 API（53317，明文 HTTP，CORS），浏览器直传 User VM，B 不经手字节；限额、文件名安全化、SHA-256、进度事件、inbox 引用随 prompt 发送、Download API 下载。剩余：按 Gitea 身份的作用域（`ID-001`）、inbox 浏览面板、大图 path fallback 的模型侧策略，以及 `D-045` 的逐 Conversation 路径迁移。 | `ID-001`, `SHELL-001` | [#11](http://testpc:3000/awangs/pi-coffee/issues/11) |
| `OPS-001` | `READY` | P0 | Web/Relay/Host/Gitea/VM 故障语义、健康检查、浏览器断线连续性、手动快照恢复和发布验收。 | `CP-001`, `ID-001`, `DEP-001`, `FILE-001` | [#12](http://testpc:3000/awangs/pi-coffee/issues/12) |

### 2.3 0.1 横切子任务

这些子任务可以作为对应主 Issue 的 checklist 或拆成子 Issue，不改变 0.1 六个交付切片的边界。

| ID | 状态 | 归属 | 工作项 | 完成条件 |
|---|---|---|---|---|
| `SEC-001` | `READY` | `CP-001`, `ID-001`, `FILE-001` | secret store、OAuth cookie、Host transport token、日志脱敏和权限边界。 | 静态扫描/运行日志证明没有 key、cookie、正文或图片 bytes 泄漏。 |
| `PERF-001` | `DISCOVERY` | `CP-001` | 测量 CPA 多级转发的首 token、持续吞吐、内存占用、断流和 backpressure。 | 有可重复 benchmark；只有在数据表明有收益时才减少 hop 或引入 Rust。 |
| `MODEL-001` | `OPEN` | `FILE-001` | 定义模型 capability 检测、image block 格式和 path/reference fallback。 | 至少一个支持图片和一个不支持图片的 stub 测试，用户能看到明确状态。 |
| `TASK-001` | `OPEN` | `SHELL-001` | 定义 Task 创建/归档/删除、worktree 命名、并发锁、冲突和取消语义。 | 同 Task 不发生并发写坏；不同 Task 的并行行为有测试。 |
| `REC-001` | `READY` | `OPS-001` | Host 重启后用 native Pi session/transcript 恢复；Web 重启不杀 Host。**已完成一半**：已完成消息随 `SHELL-001b` 从会话存储恢复（Host 重启后 12 个会话与历史全部可见）；剩余为重启瞬间进行中的那一轮。 | 故障演练有命令、预期状态、恢复后 cursor/事件不重复不丢失。 |
| `OBS-001` | `READY` | `CP-001`, `OPS-001` | 健康、路由、usage metadata、事件延迟和错误码的最小可观测性。 | metadata 有界且不含正文；每种故障有 user-visible 状态。 |
| `QA-001` | `READY` | `OPS-001` | Debian Web/Control Plane + Linux Mint User VM 的 clean install/restart/upgrade 验收矩阵。 | fresh VM/快照恢复记录和发布清单附在 Issue。 |
| `DOC-001` | `OPEN` | `OPS-001` | 将 `BACKLOG.md`、决策、MVP、0.1、拓扑、部署和开发入口镜像到 Gitea Wiki。 | Wiki 页面与 Git commit 对齐；不放敏感数据；Git 仍为版本化源。 |

### 2.4 Harness 后续计划

| ID | 状态 | 优先级 | 目标 | 依赖 | Gitea |
|---|---|---:|---|---|---|
| `HARNESS-003` | `READY` | P1 | 先在真实 Linux Mint User VM 和 Web 端验证 10 个基础工具的可靠性、取消、错误和恢复语义，再按单个 ticket 接入扩展工具。首个候选是 API 版增强 Web Search。 | `HARNESS-002` | [#16](http://testpc:3000/awangs/pi-coffee/issues/16) |

### 2.5 `pi-subagents` 扩展切片

| ID | 状态 | 优先级 | 目标 | 依赖 | Gitea |
|---|---|---:|---|---|---|
| `SUBAGENT-001` | `DONE` | P1 | 该项模式方案已撤下；历史事实见 `git show b027838:BACKLOG.md`，当前设计只见 PA 主规格 | `HARNESS-002`, `MVP-003` | [#17](http://testpc:3000/awangs/pi-coffee/issues/17) |
| `SUBAGENT-002` | `READY` | P1 | 在真实 Linux Mint User VM + Web Shell 验证 foreground/background child、完成通知、停止/取消、浏览器断开后继续、Host 重启恢复和资源清理；未通过前不宣称生产可靠。 | `SUBAGENT-001`, `HARNESS-003` | [#18](http://testpc:3000/awangs/pi-coffee/issues/18) |

### 2.6 Web Search 扩展切片

| ID | 状态 | 优先级 | 目标 | 依赖 | Gitea |
|---|---|---:|---|---|---|
| `WEB-001` | `DONE` | P1 | 接入官方 `pi-web-access@0.27.0` 的 Pi-native adapter；提供 Relay-backed Serper `web_search`、原生 `pi-subagents` research brief、User VM Markdown 封盘和 pointer-only context。 | `HARNESS-002`, `SUBAGENT-001`, `CP-001` | [#23](http://testpc:3000/awangs/pi-coffee/issues/23) |
| `WEB-002` | `READY` | P1 | 在真实 User VM/Control Plane 验证 Serper key 隔离、官方内容工具、子 Agent 超时/取消、浏览器断开后继续和 Host 重启恢复。 | `WEB-001`, `SUBAGENT-002`, `OPS-001` | [#24](http://testpc:3000/awangs/pi-coffee/issues/24) |

---

## 3. 后续版本 Backlog（0.1 通过后再启动）

这些项目保留了讨论中提到的 V5/插件/worktree 方向，但目前不能被 0.1 ticket 顺手实现。

| ID | 状态 | 方向 | 启动门槛 | 第一项工作 |
|---|---|---|---|---|
| `ARCH-001` | `DONE` | 评估 `pi-web` fork、大量删改或重写的边界。评估见 [`docs/research/pi-web-evaluation-20260903.md`](./docs/research/pi-web-evaluation-20260903.md)：pi-web 依赖同机进程内 SDK，与 MVP 形态和 ADR-0001 冲突，不可直接采用。**owner 选定路线 B**——保持 seam，借其设计。 | — | 已拆 `SHELL-001b`（完成）与 `SHELL-001a`（READY）。 |
| `ARCH-002` | `LATER` | Pi 原生插件/Skill 的扩展目录、版本锁定、安装和回滚。 | `DEP-001` 完成。 | 列出现有 Pi 原生扩展点，标出可复用模块。 |
| `V5-001` | `LATER` | 从冻结 V5 参考中逐项提取有价值的领域能力。 | 0.1 release gate 通过；每个能力单独 ADR。 | 只做只读差异/依赖审计，不修改 V5。 |
| `WORK-001` | `LATER` | Worktree 增强、Task 与仓库分支/补丁的生命周期。 | `TASK-001` 的 0.1 语义稳定。 | 定义组织模型和迁移策略；不得声称它提供安全隔离。 |
| `PLUGIN-001` | `LATER` | 将 V5 时代插件能力按 PI Coffee 原生 seam 逐个合并。 | `V5-001` 审计完成且有明确收益。 | 一个插件一个 ticket、测试和回滚点。 |
| `SEC-002` | `HOLD` | 在 VM 信任模型改变时重新评估 sandbox/permission。 | 出现跨用户不可信代码、公共部署或 VM 边界不再可信。 | 先更新 threat model/ADR，再决定是否实现。 |
| `PERF-002` | `HOLD` | 用 Rust 重写热点路径。 | `PERF-001` 有可重复的瓶颈数据和收益假设。 | 先保留 TypeScript seam，做可回滚 benchmark 分支。 |

---

## 4. 明确不做（除非产品前提改变）

- 不修改、拆分、迁移或反向污染冻结的 V5 仓库。
- 不在 MVP/0.1 引入 V5 Guard、权限审批、命令 sandbox 或第二套安全模型。
- 不创建 VM manager，不自动操作快照，不把 VM 恢复责任转给 PI Coffee。
- 不把完整 transcript、model context、prompt、tool output、文件正文或图片 bytes 存进 Control Plane。
- 不把唯一 CPA key 下发给 User VM/Host，也不写入 Git、Wiki、Issue、浏览器包或日志。
- 不把 Gitea 暴露到公网，不另建平行的人类账号体系。
- 不把多浏览器标签页作为主要产品模型；0.1 的目标是一个 Shell/tab 内多 Task/Session。
- 不生成缩略图归档或把图片复制到 Control Plane。
- 不为 Relay 发明自定义模型协议，不整段缓存 SSE。
- 不在没有性能证据时引入 Rust。

---

## 5. 开放问题与工程调查

以下问题不是产品方向反复，而是实现前需要留下证据的工程选择。解决方式是把结论写回对应 Issue/ADR，而不是靠口头约定。

| ID | 问题 | 默认处理 | 负责人/归属 |
|---|---|---|---|
| `OPEN-001` | CPA 多级转发的可接受延迟、超时、重试和断流语义是什么？ | 先做 `PERF-001` benchmark；不增加无证据的 hop。 | `CP-001` |
| `OPEN-002` | Gitea OAuth app 的 callback、cookie、logout 和内部 DNS 如何配置？ | 按内部 Gitea 实例做最小集成测试；密钥只进 secret store。 | `ID-001` |
| `OPEN-003` | 用户到固定 User VM 的注册、健康和 Host identity 撤销数据结构是什么？ | Control Plane 只存 opaque routing index；Host 缺失时 fail-closed。 | `ID-001` |
| `OPEN-004` | Enrollment Token 的生成、一次性消费、过期和撤销接口是什么？ | 由 `DEP-001` 与 `ID-001` 联合定义；不与 LLM key 混用。 | `DEP-001` |
| `OPEN-005` | 一个 Task 的 worktree 锁和不同 Task 的并行上限是什么？ | 先实现最小串行锁和明确冲突错误，再测量扩展需求。 | `TASK-001` |
| `OPEN-006` | Host 重启时 native transcript、cursor 和未完成事件如何恢复？ | 以 Pi 原生 session/transcript 为源；用 `REC-001` 故障演练定稿。 | `REC-001` |
| `OPEN-007` | 图片模型 capability 如何发现，路径引用如何安全地展示/下载？ | `MODEL-001` 用两个 stub 模型覆盖。 | `FILE-001` |
| `OPEN-008` | Deployment Skill 的具体 Skill 包格式、执行用户、systemd 单元和升级回滚策略是什么？ | 先写 idempotent dry-run/report，再做真实 VM 演练。 | `DEP-001` |
| `OPEN-009` | `pi-web` fork 与自研 UI 的取舍是否改变？ | **已回答（owner 2026-09-03）**：不 fork、不整机采用；保持 seam，借设计与协议用法，按需移植组件。 | `ARCH-001` |
| `OPEN-010` | Wiki 由谁发布、多久同步一次、是否自动化？ | Git 保持唯一版本源；`DOC-001` 记录发布流程。 | `DOC-001` |
| `OPEN-011` | 是否需要把更多 Pi 原生插件装进 User VM？ | 先完成 `ARCH-002` 清单；没有具体收益不扩 scope。 | `PLUGIN-001` |

“worker 是什么”已在术语层解决：PI Coffee 不新增 Worker 组件；后续 Issue 统一使用 Agent Host、Pi Session、Task。如果实现者仍需要进程池/队列，应先提出独立 ADR，不得把 worker 作为未定义的隐式架构层。

---

## 6. 执行顺序和完成规则

```text
MVP-001..005 (已完成)
          │
          ├── CP-001 ──┐
          ├── ID-001 ──┼── SHELL-001 ── FILE-001 ──┐
          └── DEP-001 ─┘                            ├── OPS-001 ── 0.1 release
                                                    └── DOC-001
```

执行约定：

1. 先读 [Issue #1 地图](http://testpc:3000/awangs/pi-coffee/issues/1) 和对应主 Issue，再开始编码。
2. 一个变更尽量对应一个 active ticket；新增范围先更新本 Backlog 和 Issue。
3. 在公共 seam 先写失败测试，再实现最小垂直切片；每次提交前运行 `npm run check`。
4. 完成不是“代码能跑”就算：必须有测试/部署/故障证据、Issue 评论和 fresh clone 或目标 VM 验证。
5. Agent 讨论决定与行为变更按 [PA 主规格](./docs/spec/pi-agent.md)和 [WP 规格](./docs/spec/harness-prompt.md)维护；同步理由、未决项、实现状态与验收依据。需要架构决定时更新 ADR；Gitea 管工单状态，离线时标待同步，不复制第二份主规格。
6. 除已登记并验收的 `HARNESS-002` 基础工具表外，V5 相关想法只能进入本文件的 `LATER/HOLD` 区，直到 0.1 release gate 通过。

## 7. 讨论主题到交付物的追踪

| 讨论主题 | 当前权威文档 | 当前 backlog |
|---|---|---|
| 原版 Pi 插件扩展、Chat/Work、Work 提示词、上下文与工具调用、持续维护 | [Pi Agent 主 SPEC](./docs/spec/pi-agent.md)、[Work SPEC](./docs/spec/harness-prompt.md) | PA-001～008；PA-Q/PA-AC 与 WP 验收，不以历史 DONE 代替 |
| PI Coffee 命名、V5 冻结、从原版 Pi 做 MVP | [`docs/product/decisions.md`](./docs/product/decisions.md)、ADR-0001/0002 | `D-001..D-004`, `MVP-001..005` |
| 超强服务器、Debian Web/Control Plane、Linux Mint User VM、手动快照 | [`docs/architecture/topology.md`](./docs/architecture/topology.md)、[`docs/deployment/runbook.md`](./docs/deployment/runbook.md) | `D-010..D-016`, `DEP-001`, `OPS-001` |
| 上下文归属、隐私和唯一 key | ADR-0003、[`docs/product/decisions.md`](./docs/product/decisions.md) | `D-017..D-024`, `CP-001`, `SEC-001` |
| Gitea 身份、Issue、内网和账号保护 | ADR-0004 | `D-007..D-009`, `ID-001`, `DOC-001` |
| 单标签 Browser Shell、多 Task/Session、断线连续性 | ADR-0006、[`docs/protocol.md`](./docs/protocol.md) | `D-025..D-029`, `SHELL-001`, `TASK-001`, `REC-001` |
| 文件上传、图片消息、原图和引用 | ADR-0007 | `D-030..D-035`, `FILE-001`, `MODEL-001` |
| 自动化 Deployment Skill、Pi 原生插件、模块化、Rust | [`docs/development/workflow.md`](./docs/development/workflow.md) | `D-036..D-040`, `DEP-001`, `ARCH-002`, `PERF-001/002` |
| pi-web fork/改造/重写 | README、架构 seam 约束 | `D-038`, `ARCH-001`, `OPEN-009` |
| V5 worktree/插件/能力后续合并（Harness 基础表除外） | ADR-0002、0.1 non-goals、[`harness-plugin.md`](./docs/spec/harness-plugin.md) | `D-041`, `D-043`, `V5-001`, `WORK-001`, `PLUGIN-001`, `HARNESS-003` |
| 该项模式方案已撤下；历史事实见 `git show b027838:BACKLOG.md`，当前设计只见 PA 主规格 | [Harness 兼容说明](./docs/spec/harness-plugin.md)与历史审计；设计已替代 | `D-042..D-043`（SUPERSEDED），`HARNESS-001..002` 历史切片 |
| `pi-subagents` 上游扩展接入 Agent Host | [`docs/spec/subagents-plugin.md`](./docs/spec/subagents-plugin.md)、[`docs/research/pi-subagents-audit-20260903.md`](./docs/research/pi-subagents-audit-20260903.md) | `SUBAGENT-001..002`, `HARNESS-003` |
| Web 搜索、Serper Relay、原生子 Agent 研究和 Markdown 封盘 | [`docs/spec/web-search-plugin.md`](./docs/spec/web-search-plugin.md)、[`docs/research/pi-web-access-audit-20260903.md`](./docs/research/pi-web-access-audit-20260903.md) | `D-044`, `WEB-001..002` |

## 8. 维护记录

| 日期 | 变更 |
|---|---|
| 2026-09-02 | 根据今天的多轮讨论建立本 Backlog；MVP 标记为当前 main 已实现，0.1 六个切片映射到 Gitea Issues #7–#12。 |
| 2026-09-02 | 在项目 1 建立 `Backlog` 列并加入 Issue #13，作为后续功能 ticket 的默认入口。 |
| 2026-09-02 | 该项模式方案已撤下；历史事实见 `git show b027838:BACKLOG.md`，当前设计只见 PA 主规格 |
| 2026-09-03 | 复核 Gitea V5 基线 `778a3d5`，完成 PI-native Harness extension、8/10 工具表和 VM-native git/verify 适配，登记 `HARNESS-002`（Issue #15）。 |
| 2026-09-02 | owner 补充 MVP 范围：包含 Codex 式白色主题 Web 界面（`MVP-006`）；MVP 部署形态为 User VM 内 Pi agent + 服务器端 Web/Relay（`MVP-007`），`CP-001` 由此提前进入 MVP。 |
| 2026-09-03 | 建立 `HARNESS-003`（Issue #16）：先验证 10 个基础工具可靠性，再逐个接入扩展工具。 |
| 2026-09-03 | 接入锁定的 `pi-subagents@0.63.0`（Issue #17）：保留 Harness 8/10 基础表，增加可选 `subagent`/`bg_wait` 和资源 Adapter；真实 User VM 验收拆为 `SUBAGENT-002`。 |
| 2026-09-03 | 完成 `ARCH-001` pi-web 评估（`docs/research/pi-web-evaluation-20260903.md`），建议路线 B；`OPEN-009` 有了候选答案，待 owner 确认。 |
| 2026-09-03 | 建立 `WEB-001/002`：官方 `pi-web-access` 通过 native adapter 接入，Serper key 保持在 Control Plane，研究结果按 User VM Markdown artifact + pointer context 封盘。 |
| 2026-09-03 | owner 选定路线 B 并重申约束：计算全在 Host、聊天记录永久存 VM、每次打开 Web 可见历史。落地 `SHELL-001b` + ADR-0008：浏览器零缓存，会话列表/历史由 Host 从 Pi 会话存储提供，空闲 Pi 进程自动停止并可恢复。`ARCH-001` 关闭，`OPEN-009` 已回答。 |
| 2026-09-03 | owner 决策：HTTPS 作为**备选路线**先做出来，0.1 仍用 HTTP。Web Server 与传输端口均支持证书文件（内网 CA），全有或全无；`npm start` 拒绝只加密一侧的配置。runbook 新增 "Optional route: HTTPS with an internal CA"。 |
| 2026-09-03 | owner 决策 ADR-0009：文件传输采用 LocalSend v2，浏览器与 User VM 点对点，B 不经手字节；局域网、明文 HTTP、不考虑手机场景。交付 `FILE-001a`（Host TransferServer + 网页附件直传/进度/引用/下载），发版 `v0.1.0-mvp.3`。 |
| 2026-09-03 | 交付 D（`SHELL-001a`）：Extension UI 对话框与即发即忘方法接到浏览器，挂起对话跨刷新重发；空会话不再进入共享列表，空闲回收时删除。发版 `v0.1.0-mvp.2`。 |
| 2026-09-27 | owner 评估 [termdeck](https://github.com/xDope7137/termdeck)（仅 agent 端开源，控制面闭源，能借的是设计而非代码）后选定 5 项、明确不做手机端与审批相关项（默认 `approvalPolicy=never` 全权限执行）。TDD 交付 `UX-002`：Host `attention`/`source`、外部 turn 轮询、`rateLimits`、`public/sidebar.js`（纯逻辑，`test/shell-logic.test.ts`）、停靠 diff 面板、传输 realpath/凭据名黑名单与 `docs/INVARIANTS.md`。 |
| 2026-09-27 | 按 `code-review` skill 对 ID-001 + AGENT-001 做两轴评审并修复：`PI_COFFEE_PUBLIC_URL` 在开启 Gitea 登录时必填且不再信任 `X-Forwarded-*`；新增 `PI_COFFEE_REQUIRE_USER`；登出改为 POST；Codex `thread/list` 翻页、`list()` 失败不再伪装为空、app-server 空闲回收、id 映射移到 `<SESSION_DIR>/<user>`；`codex-adapter.ts` 拆出 `codex/rpc.ts` 与 `codex/translate.ts`。未完成：Gitea Issue 记录（内网不可达）与真实登录下的端到端 turn 验证。 |
| 2026-09-27 | owner 要求同一网页可驱动 VM 管理员登录的 **Codex CLI**（两位用户只碰网页、各自独立会话、明确不要占用锁）。交付 `AGENT-001`/ADR-0011：Codex app-server adapter、fake app-server 夹具与 `test/codex-adapter.test.ts`、`PI_COFFEE_AGENT`/`PI_COFFEE_CODEX_*` 配置与运行手册。 |
| 2026-09-27 | owner 决策 ADR-0010：公司只分配一个企业模型帐号，放弃每人一台 VM；改为 1 Web Server + 1 共享 User VM + 1 Host。交付 `ID-001`：Gitea OAuth2 登录（`/login`、`/auth/*`、签名 HttpOnly cookie、allow-list、`/ws` fail-closed），登录名以 `x-pi-coffee-user` 头随 Host 传输转发，Host 每用户一个 registry + `<WORKDIR>/<user>` / `<SESSION_DIR>/<user>` / 每 scope 的 inbox root；浏览器侧显示当前用户并可退出。 |
| 2026-09-03 | owner 目标：Web 端做成简化版 Codex。一次交付 A/B/C（`SHELL-001c`）：协议新增 `prompt.mode`、`rename/delete_session`、`get_models/set_model/set_thinking`、`get_commands`、`get_stats`、`compact`，Host 广播 `sessions`；shell 拆为 ES modules 并 vendored `marked`/`DOMPurify`。D/E/F/G 缺口登记在 `docs/spec/web-shell-roadmap.md`。 |
| 2026-09-20 | 建立可持续维护的 Pi Agent 主 SPEC 与 WP 专项合同；标记 D-042/043 的旧模式设计已替代，D-037 升级为明确插件边界；保持工具清单等未决项，记录本地实现/验收差距。Gitea 不可达，尚未同步新决定或关闭工单。 |

2026-09-22：HARNESS-001/002 完成 Chat/Work 运行时迁移、旧状态升级及请求边界验证；[证据](./docs/reviews/chat-work-migration-20260922.md)。T4 双用户门槛仍单独验收。

2026-09-22：D-045 / PA-013 Conversation Workspace 已完成 Agent #46 / Server #3 联合实现与部署；[证据](./docs/reviews/conversation-workspaces-20260922.md)。Chat/Work 每任务独立目录，完整路径/分支/同步状态、原图及产物归属、归档保留与显式清理均进入公共 seam 验收。

2026-09-23: D-046 records native Codex/Claude Code integration as an accepted design and ready implementation scope; no runtime changes or deployment are included.

2026-09-23: M0–M5 native-engine integration is merged and deployed. The [M5 evidence](./docs/reviews/native-agents-m5-20260923.md) records real Browser/Gitea/file flows, the collaborator PR corrections, recovery, fixed routes and explicit native capability limits.

## Context Usage attribution correction (2026-09-23)

[Agent #58](http://gitea:3000/awangs/pi-coffee/issues/58) implements the
[seven-category context contract](docs/spec/context-usage.md), consumed by Server #4.
Local numeric estimates stay distinct from provider billing; native-engine contexts
remain isolated. Delivery and clean-clone evidence are recorded in the Issue.

## Pi-only Chat creation (2026-09-23)

[Agent #60](http://gitea:3000/awangs/pi-coffee/issues/60): new Chat defaults to Pi; native engines use Work. Existing native local tasks are retained. Browser navigation is Server #4. Pi account import into Web Server remains a future consideration, not current scope.

## Web-managed Skills (2026-09-23)

Agent #62 / Server #14 implement the accepted [Skill management contract](docs/spec/skill-management.md).
The Web owns management controls; each User VM owns native Skill files and execution.
This delivers the Skill portion of ARCH-002; generic extension installation and a
central marketplace remain outside this change. Deployment evidence is recorded in
the linked Issues rather than inferred from this decision.

## Pi 0.87.1 on unified main (2026-09-27)

[Server #18](http://gitea:3000/awangs/pi-coffee-server/issues/18) upgrades the four Pi packages to 0.87.1 on the GitHub-authoritative unified repository. Optional MCP compatibility and separately installed Pi Lens are covered by the [acceptance report](docs/reviews/pi-0.87.1-main-20260927.md). Context-fold remains pinned at 0.4.0; the independent context-management redesign is excluded. Publication and deployment identities remain explicit in the Issue.
