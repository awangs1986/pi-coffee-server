# Pi Agent 主规格

文档类型：**持续维护的设计规格（Living SPEC）** · 修订：7 · 最近更新：2026-09-22。

本文是 Pi Agent 部分的固定设计入口，记录已确认决定、理由、实现差距、未决项和验收依据。后续在此迭代，不另建一份按日期命名的“最新主规格”。评审记录可以按日期归档，但不能替代本文。

## Native-engine scope clarification (2026-09-23)

The PA/WP decisions in this document apply to **Pi only**, including zero-system-prompt Chat, Work prompting, tool inventory, LSP, plugin loading and context recovery. The accepted [native-engine integration](./native-agent-engines.md) preserves Codex and Claude Code's own design and official authentication. Shared Conversation Workspace/Gitea rules apply independently of engine. Native-engine support is deployed; current capabilities are recorded in the native-engine delivery evidence.

## 1. 范围和阅读规则

- 范围：原版 Pi 的插件扩展、Chat / Work、Work 提示词、工具可用性、上下文节制和恢复。Web 工作台、身份、文件网关和 VM 拓扑继续使用各自 SPEC，不借本次讨论扩大范围。
- **已确认设计不等于已经实现。** 本文第 2 节记录 owner 确认；第 5 节按当前检出代码/本地证据记录实现。Gitea 继续管理工单状态、依赖与验收；未同步的本地决定必须明确标注。
- 对 Pi Agent 的模式/提示词设计，本文及其链接的当前专项 SPEC 是唯一模式合同。旧代码和 dated handoff 只证明当时或当前兼容行为，不能反推新设计。
- 不回读 V3 代码来决定新需求；本轮 owner 描述的长期使用问题是需求输入。代码是否实现、模型是否遵守、真实环境是否验收必须分别说明。

## 2. 已确认决定

以下来自 2026-09-20/21 owner 的设计澄清和维护要求；专项规格另行标注实现者提出的工程参数。

| ID | 决定 | 原因 / 约束 |
|---|---|---|
| **PA-001** | 基于未修改的原版 Pi，Agent 新功能只通过插件扩展；保留 Pi 自由升级能力 | 不维护内核分叉，不把修改上游源码或依赖私有实现作为常规交付方式。锁定依赖用于复现，不等于永久冻结 Pi，也不等于无验证自动升级 |
| **PA-002** | 产品只有 **Chat / Work** 两种模式 | 当前所有文档只使用这两个产品模式；撤下旧模式说明，历史通过 Git 追溯，兼容代码不得直接改名冒充新模式 |
| **PA-003** | Chat **不使用任何系统提示词，连 Pi 原生默认提示词也不要**；仅 4 个基础工具 + Web 搜索 | 目标是轻量模式，不是“仍保留原生 Base，只关闭自定义正文”。基础工具为 read、edit、write、bash；Web 使用 web_search，始终直接搜索 |
| **PA-004** | Work 使用一套完整的软件开发系统提示词，目标是成熟编程 Agent 的执行质量 | 以现有正文为基础持续改进，参考 Pi 原生源码、Claude Code 完整默认版 与 Grok Build 等成熟 harness 的行为骨架，不承诺复制其身份、内核或工具体系；保留既有工具架构，具体集合按后续 PA-011 精简；详见工具 SPEC |
| **PA-005** | 保持 Pi 的精简、优雅、克制，非必要不增加工具 | 先改善已有能力的接口、描述和可靠性；不能为迁就参考提示词或凑工具数量增加工具/管理层 |
| **PA-006** | 解决上下文快速膨胀、不必要内容进入请求、统计与实际占用偏差、自动压缩来不及的问题 | “再加一句节省 token”不构成解决方案。需要区分内容入口、最终请求预算、压缩触发和恢复结果 |
| **PA-007** | 解决 LLM 不知道已有工具如何调用的问题 | 工具要可理解、可发现且契约准确；不能仅以工具已注册或 schema 存在宣称问题已解决 |
| **PA-008** | 讨论结论和后续修改必须留下可供维护的 SPEC | 保留决定及理由、稳定编号、未决项、状态和证据；代码、测试、规格同步维护，不只留聊天结论或一次性报告 |
| **PA-009** | Pi 原生系统提示词本身即资产：**在它之上做适量加法，不推倒重做** | 原生已提供身份、激活工具列表（含逐工具 `promptSnippet`）、Guidelines（含各工具 `promptGuidelines`、简洁与列路径）、`<project_context>` 项目指令、Skills 与文档指针。新增内容前先确认原生是否已覆盖；重复表述按“多”处理并删除。不维护一套平行的提示词框架 |
| **PA-010** | 通用 Work 正文必须**项目中立**：只写可迁移到任意软件项目的规则，项目/产品专属内容一律不进正文 | 针对历史事故：V3 正文里含有“开发 picode 自身”的内容（picode 是 V3 的名称），会导致上下文错位与错误约定。项目专属指令走 AGENTS.md/`<project_context>`；正文身份中立。使用类别级守卫（不是已知名字黑名单）持续验证，见 PA-AC08 |

| **PA-011** | Work 常驻工具精简为 read、edit、write、bash、git、search_tools；恢复可用时加 recall_folded；目录/文本搜索/文件发现/验证交给 Bash，Web 与子 Agent 按需激活 | owner 在真实测试后批准；替代原表照搬要求。运行时已按此表迁移，详见[工具 SPEC](./work-tools.md) |
| **PA-012** | 提供能被 Pi Agent 主动发现、正确调用、解决项目问题的 LSP 中间层，采用 Skill + CLI，不用 MCP；pi-lens 不是目标或必要依赖 | 完整保留语义诊断、定义、引用、类型与符号能力，不降级为只做 lint/文本搜索。工程 Interface、按需进程复用和验收见[LSP SPEC](./lsp-middle-layer.md)，Skill/CLI 已实现，部署与性能证据独立记录 |
| **PA-013** | 一个任务对应一个 Conversation 和一个所属 VM 的本地 Workspace；Chat 集中在 `chats/` 根下按 Conversation 分目录，Work 使用独立 Gitea Checkout | 附件、搜索证据、图片和工具产物必须跟随所属 Conversation，不能回退到跨 Conversation 的全局 Agent 目录。运行模式和 Workspace 类型是两个维度；完整路径、泄露边界与生命周期见[Conversation Workspace SPEC](./conversation-workspaces.md) |

### 模式边界的验收解释

- Chat 的最终模型请求不能含 Pi Base、Work 正文或插件追加的系统指令，也不能把同一套指令改塞成普通消息来规避 PA-003。工具 schema 与系统提示词是不同输入；不能为了“零提示词”删掉工具调用所需的正规定义。不同 provider 的等价 `system` / `instructions` 字段必须实际检查，兼容限制需披露。
- Chat 不因旧代码中“所有模式常驻 recall”而自动增加额外工具。项目指令、运行时状态等是否会通过其他路径注入也要检查，不以 UI 名称或关闭单个 hook 作为通过证据。
- Work 固定正文只放稳定行为规则；活动工具、模型、预算和具体参数由真实运行时/工具契约提供。按 PA-009 保留 Pi Base 并追加 Work 正文；PA-Q02 的二选一已关闭，最终请求装配仍需验收。
- 下列验收与工程分工用于落实已确认目标；尚未选定的数值、API 或迁移策略不能写成 owner 已批准。

### VM 权限与代码协作边界

[ADR-0012](../adr/0012-owner-privileges-and-gitea-checkouts.md) 与 [GW-01～12](./gitea-workspaces.md) 明确 owner + 免密 sudo、独立 Checkout、Conversation 分支 checkpoint 预授权及 Gitea PR。这些是部署/工作区上下文，不进入项目中立的通用 Work 正文；实现已进入 T0–T4 代码，目标 VM 的实际权限仍以运行时探针为准。

## 3. 规格分工：一处定义，其他地方引用

| 文件 | 维护什么 | 不负责什么 |
|---|---|---|
| **本文** | Agent 原则、两模式边界、未决项、跨模块验收与决策沿革 | 不复制完整工具 schema 或运行时参数表 |
| [Work 提示词 SPEC](./harness-prompt.md) | WP 编号规则、正文职责、长度预算、插件接入约束和行为验收 | 不把文案测试等同于模型质量测试 |
| [上下文与恢复](./context-recovery.md) | 入口限量、artifact、估算/压缩/恢复的实现合同和失败边界 | 不决定 Chat/Work 的工具清单；现有阈值不是 PA-006 已彻底解决的证据 |
| [Web 搜索](./web-search-plugin.md) | 搜索工具、证据索引、历史投影和失败路径 | 不自行确定 Chat/Work 分派 |
| [子 Agent](./subagents-plugin.md) | 上游执行器适配、准入、模型与结果协议 | 不替代两模式的新工具/委派政策确认 |
| [Work 工具](./work-tools.md) | 精简目标、现有工具表与迁移差距 | 不以目标清单冒充已发版 |
| [LSP 中间层](./lsp-middle-layer.md) | Skill/CLI、项目识别、语义查询、同步、结果契约与真实验收 | 不要求采用 pi-lens，不修改 Pi 内核 |
| [Harness 兼容实现](./harness-plugin.md) | 原生 Git/Verify 接缝与模式迁移状态 | 不再作为目标模式/提示词设计的权威 |
| [2026-09-20 提示词评审](../reviews/work-prompt-20260920.md) | 固定来源版本、比较理由和当次运行证据 | 不成为第二份可独立演化的主 SPEC |

## 4. 实现职责与非目标

### 插件与上游升级

Agent 增强使用 Pi 的公开扩展接口；Host 保留窄 RPC 适配，Web 不依赖 Pi 私有实现。升级时先跑加载/接口/回归探针，发现不兼容时修本地插件或明确阻塞，不通过补丁篡改上游内核。本文不声称当前已验证任意未来 Pi 版本。

### 工具与提示词

主提示词说明如何选择/使用能力；工具自己的名称、描述、schema 和错误说明负责具体契约。参数例子必须随工具接口一起验证。新增工具之前说明现有工具为什么不能胜任，以及新增 schema/输出的上下文成本；没有必要性证据不增加。当前 Work 正文中的发现机制可复用，但不据此预先决定最终工具清单。

### 上下文与恢复

- **内容入口**：原始日志、搜索结果、子任务正文、重复说明不应无差别进入历史；必要证据有界返回，完整证据留 VM，按需定向读取。
- **请求预算**：检查实际将发送的系统内容、工具定义、消息、工具 details 和媒体；区分 provider 实测与本地估算，不把上一轮 usage 当作下一轮完整 payload。
- **压缩与恢复**：触发参数必须结合实际窗口、输出预留和估算误差验证；取消/失败不能报成功，不能无限重试超限输入或重放不确定副作用。算法、误差目标和 provider 适配待 PA-Q05，先保留专项 SPEC 的现有失败约束。
- **层次区分**：展示历史、原生 transcript、artifact 与实际模型请求不是同一份数据。文件归档或 UI 折叠本身不能证明请求已经变小。

非目标：新增 Agent 内核/沙箱、为参考产品复制工具大全、重写 Pi 原生认证/执行器、强制每次任务生成规划/报告、靠不断扩大系统提示词替代运行时修复。

## 5. 当前检出实现与差距

状态核对：2026-09-22。Chat/Work 迁移与真实 Pi 请求验收见[迁移记录](../reviews/chat-work-migration-20260922.md)；部署状态单独记录。

| 对应决定 | 已观察到的实现 | 仍不能宣称完成 |
|---|---|---|
| PA-001 | Pi packages are pinned to 0.87.1; enhancements use `src/pi-extensions.ts`, public hooks and the Host RPC adapter | Unified-main compatibility evidence: [upgrade report](../reviews/pi-0.87.1-main-20260927.md); deployment is separate |
| PA-002 / PA-003 | 仅接受 Chat/Work，默认 Work；v1 会话保留历史并写入 v2 Work；Chat 五工具与零系统提示词在实际 Pi 请求中验证 | 第三方自定义扩展装配和其他 provider 实网仍须按升级矩阵验证 |
| PA-004 | `software-development.md` 已按三仓库交叉参考扩展；renderer 支持 `work`，经现有 hook 注入；正文项目和调用示例测试通过 | Work 最终装配已测；文本合同不等于成熟编程 Agent 的模型行为对比 |
| PA-005 | 当前活动集合见 `src/harness/mode.ts`；注册、激活、可选能力需要分别计量 | PA-011 精简表已实现，见[工具 SPEC](./work-tools.md)；真实模型质量继续按行为评测验收 |
| PA-006 | 大输出归档、短搜索结果、context-fold、本地失败取消、最终 payload 保守估算已在代码中 | 估算不是精确 tokenizer；真实 provider、图片、长会话和自动压缩参数的误差/触发问题未完成验收 |
| PA-007 | 已有 schema、发现/激活接口；Work 正文的调用例子通过真实 schema 和公共接口测试 | 不代表各模型都会正确选工具和填参数；仍需行为样例评测 |
| PA-011 / PA-012 | [CLI LSP](./lsp-middle-layer.md)、会话内复用、原生 Skill 发布、TS/Python Profile 和 3×3 真实模型探针已完成 | Work 精简表与 Chat 的 Skill 元数据隔离已验；LSP 故障/性能矩阵仍有部分项 |
| PA-008 | 主 SPEC、专项 SPEC、决策/验收表与维护流程已建立 | 本次迁移记录在 HARNESS-001/002；其他发布门槛不随模式迁移自动关闭 |
| PA-009 | Native base instructions and tool `promptSnippet`/`promptGuidelines` remain in use | Pi 0.87.1 real-RPC request tests verify the assembled Work prompt and Chat isolation; see the [upgrade report](../reviews/pi-0.87.1-main-20260927.md) |
| PA-010 | 文本中立守卫与正向对照已加入 `test/harness-prompt.test.ts` | 审计发现身份守卫仍依赖已知名字，PA-010 未完全满足；见[评审](../reviews/chat-work-design-review-20260920.md)与手工测试 T10 |

提示词实现证据见 [评审 §5](../reviews/work-prompt-20260920.md)：31 个测试文件、179 项本地测试以及两个 Pi 扩展加载 smoke 通过。测试使用本地替身的部分须保持标注；不得据此填写下表所有项目为“通过”。

## 6. 验收矩阵

| ID / 对应决定 | 最低验收证据 | 当前状态 |
|---|---|---|
| **PA-AC01 / PA-001** | 升级差异不含 Pi 内核补丁；目标 Pi 版本实际加载插件，RPC/工具/会话回归通过，记录版本与已知不兼容 | 当前版本有加载证据；跨版本待验 |
| **PA-AC02 / PA-002** | 新建、切换、恢复会话只呈现 Chat/Work 两个产品模式；旧状态按确认的迁移策略处理，不静默错配工具 | 本地通过：命令、新建、恢复、树分支、v1→v2 迁移及未知版本保护 |
| **PA-AC03 / PA-003** | 抓取真实 Pi 生成、发送前的 provider 请求：Chat 无任何系统指令；工具恰为确认的基础集合 + 搜索；新建/恢复/切模型/插件加载均覆盖 | 真实 Pi + 本地 HTTP provider 通过；新建/切换/恢复/切模型/默认插件与 LSP Skill 已覆盖；Responses、Anthropic、Google 也已经过真实 Pi 序列化与本地 HTTP 捕获验证（固定 400 终止，不评价模型响应） |
| **PA-AC04 / PA-004** | WP 规则、字节预算、正文打包、去重、工具调用例子通过；真实模型对同一组任务执行，记录范围遵守和交付质量 | 本地正文/真实 Pi 最终装配通过；模型行为评测单独记录 |
| **PA-AC05 / PA-005、PA-007** | 确认工具清单逐项核对 schema/副作用；正常调用、错误参数、不可用/未配置、激活前后状态都有证据；真实模型能完成代表任务 | 新清单与发现、激活、缺失、切换撤销通过；本轮固定响应测试不等同模型自主行为评测 |
| **PA-AC06 / PA-006** | 长会话、大工具 content/details、搜索、子任务和媒体均检查最终 payload；对比统计与 provider 结果，覆盖切模型、未知窗口、单条超大输入及压缩取消/失败；不丢证据、不自动重放 | 部分本地防护测试已有；误差目标/实测与自动压缩矩阵待补 |
| **PA-AC07 / PA-008** | 每个行为变更可追到 PA/WP 编号、理由、状态与测试；未决项未冒充确认，旧入口不再宣称相反结论 | 本轮已建立并检查链接/编号/旧入口；文档验证见[当日维护证据](../reviews/work-prompt-20260920.md)，后续每次变更执行 |
| **PA-AC08 / PA-010** | 类别级项目中立守卫：正文不得出现产品身份、本仓库路径、本仓库命令或工单/ADR 元数据；守卫本身需有正向对照证明能抓住 V3 式自开发内容 | 部分实现：已有样例通过，但未知产品名可绕过身份守卫；缺口见本轮评审，类别级验收未通过 |
| **PA-AC09 / PA-009** | 正文不重复 Pi 原生已注入的 Guidelines 与逐工具用途；新增规则前先核对原生内容 | 已核对原生 `buildSystemPrompt` 输出并据此删除重复项；原生内容随 Pi 版本变化，升级时需重新核对 |

| **PA-AC10 / PA-011、PA-012** | Work 精简工具表与原生 LSP Skill 可发现；真实语义查询能定位问题，修改后诊断刷新，项目测试通过；覆盖多项目、编码、冷/热启动与取消 | **部分通过**：Skill、CLI、真实 TS/Python 与模型门槛已过；精简工具表与 Chat 隔离通过；取消与完整性能/多项目矩阵待完成 |

## 7. 未决项：后续逐个讨论，不擅自补全

| ID | 需要确认或核查的内容 | 未确认前的处理 |
|---|---|---|
| **PA-Q01（已落实）** | Chat 使用 read、edit、write、bash、web_search；Work 按 PA-011 | Web 搜索在 Chat 直接可调用；工具缺失时拒绝进入该模式，不伪报成功 |
| **PA-Q02（已关闭）** | 按 PA-009：保留 Pi Base，追加 Work 通用正文 | 不再把整体替换列为候选；公开接缝装配、去重、项目指令与动态事实在 PA-AC04 验收 |
| **PA-Q03（已落实）** | 默认 Work；/chat、/work、/harness chat\|work；v2 状态保存在当前 Pi 分支 | v1 开发会话统一迁移到 Work并通知；撤销旧能力租约；未知状态保留历史并要求明确选择；不接受退役命令别名 |
| **PA-Q04（已落实）** | Chat 不开放发现/委派/recall；Work 按需激活 Web/子任务，恢复工具仅 Work 常驻 | Work Web 延续已有默认研究委派，delegate=false 直接搜索；切模式/模型撤销激活；同模式恢复重新校验能力 |
| **PA-Q05** | 上下文统计采用哪些 provider 数据/估算；误差容限、触发阈值、媒体计量及两模式恢复路径 | 现有保护算法只作为已实现基线；不虚报准确、不承诺自动恢复必成功 |
| **PA-Q06** | 哪些行为规则应下沉为工具的 `promptGuidelines`（随工具激活才出现），哪些留在追加正文 | 原生支持该通道且我们已在使用（`search_tools`、`web_search`、`subagent`）。下沉能减少常驻正文，但会分散规则；需逐条评估，不一次性搬迁 |

**LSP 工程验证项**：TypeScript/Python 服务器版本、push 诊断完成保证、按需实例的内存与超时参数属于 LSP SPEC 的实现验证，不再把是否使用 MCP 或是否只提供 lint 列为未决产品方向。

## 8. 持续维护规则

1. 讨论形成决定时更新对应 PA/WP 条目、理由和下方沿革。未确认的提议进入 PA-Q，不由实现者写成 owner 决定。
2. 实现行为变更同时更新对应专项 SPEC、状态矩阵、测试/证据链接；修 bug 若不改变设计，也要更新相关实现/验收状态，不能只留代码。
3. 参数、调用例子、长度等工程基线必须标明来自实现，不与产品决定混淆。改变它们时记录理由、影响和重验项目。
4. 旧决定被替代时保留追溯记录并标出替代来源；固定入口只链接当前规格，不能不断叠加互相冲突的“最终决定”。
5. dated review/handoff 保存当时证据；长期行为验收条件留在 SPEC。真实模型/部署没跑就标待验，不能用文档完成或 stub 通过替代。
6. 对外 Issue 按仓库工作流同步。服务不可用时记录待同步，不声称已读、已更新或已关闭；不保存私密对话、凭据或模型请求正文。

## 9. 决策沿革

| 日期 | 类型 | 变更与理由 | 替代 / 关联 |
|---|---|---|---|
| 2026-09-20 | owner 确认 | PA-001～PA-007：插件扩展与升级自由、Chat/Work、Chat 连原生系统提示词也不要、Work 完整提示词、工具克制、上下文与工具调用可靠性 | 替代旧三模式产品设计；不代表运行时迁移完成；PA-Q01～05 保持未决 |
| 2026-09-20 | 工程实现 | 改进 Work 正文，使用真实调用示例和 6,000 UTF-8 字节上限；未新增工具/改 Pi 内核 | WP 规格与当日评审；预算是可调整工程基线，不是 owner 指定的 token 上限 |
| 2026-09-20 | owner 确认 / 文档落实 | PA-008：讨论与修改必须形成可维护 SPEC；建立固定主入口、WP 条目、验收和变更流程，澄清旧文档适用范围 | 本文、Work SPEC、AGENTS、开发工作流；不新增运行时功能 |
| 2026-09-20 | owner 确认 | PA-009：Pi 原生提示词已是资产，只在其上做适量加法；PA-010：通用正文项目中立，并记录 V3 正文包含“开发 picode 自身”这一历史缺陷 | 交叉对照 Codex 与 Pi 原生长文本后执行加减法；证据与采用/拒绝清单见[对照记录](../reviews/work-prompt-20260920.md)；PA-Q06 记录规则下沉为 `promptGuidelines` 的待评估空间 |
| 2026-09-20 | owner 要求 / 工程实现 | 在 PA-009/PA-010 约束下按 Pi 最新源码、Claude Code 完整默认版 与 Grok Build 交叉扩展 Work 正文：只采纳通用软件开发判断规则，不复制产品身份、专属命令、不存在工具或运行时框架；正文 6,185 → 8,794 字节 | 证据与采用/拒绝清单见[三仓库交叉评审](../reviews/work-prompt-20260920-pi-claude-grok.md)；Chat/Work 迁移、除后续按 PA-009 关闭的 PA-Q02 外，其余未决项、上下文验收与 WP-AC 行为评测仍为待办 |
| 2026-09-20 | owner 要求 / 文档落实 | 当前文档只使用 Chat/Work，历史模式文本撤回 Git；PA-Q02 按 PA-009 关闭；先静态审核、再由 owner 实测正文，工具按后续 owner 确认继承现有设计 | [审核与验证记录](../reviews/chat-work-design-review-20260920.md)、[人工测试](../testing/work-prompt-manual.md)、[工具设计](./work-tools.md)；本轮不迁移运行时 |
| 2026-09-20 | owner 补充确认 | Work 继承已有工具设计；先检查已实现的工具再讨论。撤回重新选择默认工具集合的提案 | [现有工具清单与接口审核](./work-tools.md)；常驻工具与按需能力继承，schema 精简仅为建议 |
| 2026-09-21 | owner 批准 / 提示词修正 | 应用四处规则边界修正与两项措辞收敛，保留原工具设计及 Pi Base 追加方式；字节上限不变 | [修订 6 证据](../reviews/work-prompt-revision-20260921.md)；真实模型行为待 owner 执行 |

| 2026-09-21 | owner 确认 / 设计落实 | PA-011 精简 Work 常驻集合；PA-012 建立 Skill + CLI 的完整 LSP 中间层目标，pi-lens 降为候选实现。原表照搬与“仅诊断 CLI”建议均被取代 | [工具 SPEC](./work-tools.md)、[LSP SPEC](./lsp-middle-layer.md)；设计已完成，运行时与真实验收待实施；Gitea 连接失败待同步 |

2026-09-22：owner 要求完成两模式迁移；工程落实 PA-Q01/03/04，新旧会话策略、工具表、请求边界与测试同步。

2026-09-22：owner 补充确认 PA-013；Chat 和 Work 均有逐 Conversation 本地目录，Chat 统一置于 `chats/` 父目录，附件、搜索、图片与产物不再使用跨 Conversation 全局落点。该项已由 Agent #46 / Server #3 实现并部署；见[联合验收](../reviews/conversation-workspaces-20260922.md)。

2026-09-22：owner 澄清检查目标是遗漏与合理性，固定“一任务 = 一 Conversation = 一 VM 本地目录”，补充 Work 自动 clone、前端五项上下文、独立 clone、创建重试与归档/清理合同，见 CW-07～10；修正旧 Task 一对多定义，Agent #46 / Server #3 已完成实现与流程验收。

The owner-corrected [Context Usage contract](context-usage.md) specializes PA-006
with seven source-attributed categories and explicit local-estimate semantics.

## Web Skill management

The accepted [Skill management contract](skill-management.md) adds a Web management surface while retaining native VM storage/loading. Pi Chat remains zero-system-prompt; its Skills are explicitly invocable. Pi LSP stays a Pi-only bundled Skill unless independently adapted and installed for another engine.
