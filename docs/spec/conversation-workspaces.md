> New task storage: [task bundles](task-storage.md) overrides the directory layout below when configured; legacy tasks and native session stores remain unchanged.

# 任务、Conversation 与 VM 本地工作目录

> Current native-engine boundary (reviewed 2026-10-06): shared Workspace and file ownership apply to all five Work engines. Native bindings and lifecycle behavior are implemented behind Host Adapters; verified limits are in [native engines](native-agent-engines.md), [Cursor/Claude](cursor-claude.md) and [Grok](grok-build.md). The directory tree below describes the retained pre-bundle layout; [task storage](task-storage.md) governs configured new-task bundles.

状态：owner 已确认（2026-09-22）；Agent/Server 已实现本合同，验收记录见 [联合证据](../reviews/conversation-workspaces-20260922.md)与 Agent #46 / Server #3。此规格定义行为，具体检查与部署结果以工单证据为准。

本文件补足 [Pi Agent 主规格](./pi-agent.md)、[Gitea 工作区合同](./gitea-workspaces.md)和文件所有权 ADR。目标是让每个 Conversation 在所属 User VM 中都有唯一、稳定的本地目录，同时保持中央 Server 不拥有聊天正文或文件。

## 1. 术语与两个独立维度

- **一个任务 = 一个 Conversation = 一个所属 VM 中的本地 Workspace 根目录**。Task 是面向用户的名称，Conversation 是 Host 中的对应对象；不再增加 Task 聚合多个 Conversation 的层级。同一 VM 可以有多个任务，每个任务使用不同目录和稳定 Conversation ID。
- Pi 进程重启、重连或恢复不会产生新任务。内部 subagent 是任务内执行单元，不在任务列表中另造 Conversation/Workspace；其输出归属父任务。Pi 原生历史仍可保存在 VM 的 Session store，通过 ID 关联任务，不要求为了目录统一而搬移原生历史。
- **产品模式**只有 `chat` / `work`；Pi Harness 模式决定 Pi 的提示词和工具集合，不把它转换为其他原生引擎的模式。
- **Workspace 类型**只有 `chat` / `project`，决定 cwd 的来源和生命周期。它在 Conversation 创建时确定，不随运行模式切换而改变。
- **Chat Workspace** 是无 Repository 的普通目录；**Project Workspace** 是 [GW-06](./gitea-workspaces.md) 定义的独立 Gitea Checkout。

默认创建 Pi Chat 时分配 Chat Workspace；新建 Work 时选择 Gitea/GitHub Project 和远端起始分支，确认后由 Host 自动 clone 并分配 Project Workspace。Web 不允许把 Chat 升级为 Work，也不通过模型或 Agent 选择改变 Workspace 类型。需要开发项目时显式新建/接续 Work；已确认的 Pi/Codex takeover 只改变原生绑定，保留原 cwd。普通 Chat 的零系统提示词边界见 [session-environment](session-environment.md#chat-zero-system-boundary--2026-10-05)。

## 2. 目录合同

User VM 使用一个共同工作根，推荐布局如下：

```text
/home/USER/work/
├── projects/
│   └── checkouts/
│       └── <conversation-id>/       # Project Workspace；Pi cwd
│           └── .pi-coffee/
│               ├── inbox/           # 上传和粘贴的原始文件/图片
│               ├── artifacts/       # 大工具输出、子任务结果和其他证据
│               ├── research/        # Web 搜索与来源证据
│               └── images/          # 生成或转换出的图片
└── chats/
    └── <conversation-id>/           # Chat Workspace；Pi cwd
        ├── inbox/
        ├── artifacts/
        ├── research/
        └── images/
```

| ID | 正式合同 |
|---|---|
| **CW-01** | 每个新 Conversation 必须先创建唯一 Workspace，再允许启动 Pi 或接收上传。Conversation ID 必须是已验证的不透明 ID；现有目录、符号链接或不完整创建均不能被自动接管。目录创建完成并校验后才原子发布元数据。 |
| **CW-02** | `PI_COFFEE_WORK_ROOT` 推荐为 `/home/USER/work`；`PI_COFFEE_PROJECT_ROOT` 默认是其 `projects` 子目录，`PI_COFFEE_CHAT_ROOT` 默认是其 `chats` 子目录。显式路径必须绝对化且归 owner 所有；Project root 与 Chat root 在解析实际路径后不能相同或互相包含，Work root 作为共同父目录允许包含二者；配置冲突时服务启动报错。迁移期可以从既有 Project root 推导同级 `chats`，但最终状态必须写入部署配置。 |
| **CW-03** | Chat Workspace 的 cwd 是 `chats/<conversation-id>`。Project Workspace 的 cwd 继续是 `projects/checkouts/<conversation-id>`，其运行数据放在 `.pi-coffee/`，并写入该 Checkout 的 `.git/info/exclude`；平台 checkpoint 不得提交 `.pi-coffee/**`。若 reserved path 已被 Git 跟踪，自动 checkpoint 必须拒绝并明确报错。 |
| **CW-04** | `inbox/` 保存用户上传和粘贴内容的原始 bytes，包括图片；`images/` 只保存生成或转换出的新图片，不为原图额外制作缩略图副本；`research/` 保存搜索/抓取证据；`artifacts/` 保存大工具输出、subagent 结果及其他系统证据。Agent 按用户任务主动创建的普通文件可以直接放在 cwd 中。 |
| **CW-05** | Pi、read/edit/write/bash、Git、LSP、Web 搜索、subagent 和文件接口必须从 Host 的 Conversation 元数据解析同一个 cwd/data root。已登记 Conversation 不允许回退到全局 `PI_COFFEE_WORKDIR`、`getAgentDir()/pi-coffee/research` 或 `getAgentDir()/pi-coffee/subagent-results`。子任务继承父 Conversation 的 Workspace 归属，但保留自己的运行 ID。 |
| **CW-06** | 工具 schema、绝对路径或历史消息都不能改变文件归属。Host 只接受当前已授权 Conversation ID，并在服务端解析路径；浏览器不能提交任意 cwd、VM 地址或本地根目录。 |

Chat 根目录是集中管理入口，不是所有 Chat 共用的 cwd。两个 Chat Conversation 永远不能共享同一个可写子目录。Chat 创建、文件索引、归档/恢复和永久清理不依赖 Git 仓库、Gitea 连接或 Git 凭据；不能复用只接受 `projectId` 或只能用 `git ls-files` 的流程来冒充 Chat 支持。

## 2.1 Work 创建与任务身份

- **CW-07（选择与 clone）**：用户选择的起始分支是 clone 的代码来源，不是多个任务共用的写入分支。Host 从该远端分支确认精确起点 SHA，在独立 clone 中创建 `coffee/<vm-id>/<conversation-id>` 任务分支。即使两个任务选择同一 Project、同一起始分支，也有不同 cwd、独立 `.git` 和任务分支；不共享 Git alternates 或平台 worktree。
- 创建过程对用户呈现“创建中 → 就绪 / 创建失败”。创建中禁止发 prompt 或上传；任务一旦就绪，无须用户再次手动 clone。Gitea 不可达、认证失败、分支消失或磁盘不足须显示具体原因；已经就绪的本地目录仍可离线工作，远端操作标阻塞。
- 同一次创建使用稳定请求标识，重复点击或网络超时重试返回同一任务/创建结果。失败残留必须可定位和显式恢复/清理，不能接管未知目录、盲目重放 clone 或因刷新生成第二个任务。
- **CW-08（稳定映射）**：Host 在 VM 持久记录 Conversation ID、所属 VM、Workspace 类型、完整 cwd 和创建状态；Project Workspace 另记录 Project/repository ID、起始分支/SHA、分配的任务分支及远端确认信息。任务名只作显示；重命名任务、项目改名、刷新、重连和模式切换均不改 ID/cwd。实际目录缺失时标“工作目录不可用”，禁止静默重建空目录、重新 clone 或回退到全局 cwd；恢复必须由用户明确选择。跨 VM 接续按 GW-10 创建新任务/新目录，不伪装成原任务已迁移。

独立 clone 保证平台不共享本地文件和 Git 状态；同一 VM 的端口、外部数据库与其他服务仍可能共享。并行运行应用时按任务选不同端口、区分测试数据；首版不因此新增 VM、容器或端口编排服务。远端集成仍通过 Gitea PR，独立 clone 不消除合并冲突。

## 2.2 前端必须展示的信息

**CW-09（任务上下文）**：当前任务的上下文区必须让用户明确看到以下信息；完整路径可复制，长路径可折行或展开，不只显示 basename。字段来自固定路由和 Host 实际状态，Server 不另建权威工作区索引。

| 字段 | Project Workspace / Work 新建任务 | Chat Workspace / Chat 新建任务 |
|---|---|---|
| VM | 所属 VM 名称/稳定标识，离线时明确标注 | 同左 |
| 项目 | Gitea `owner/repository`，可打开项目 | 无项目 |
| 本地路径 | 完整绝对 cwd | 完整绝对 cwd |
| 分支 | 实际当前分支；创建详情保留起始分支/SHA，不能把起始分支当当前分支 | 不适用 |
| 同步状态 | 本地改动、未推送/已同步、落后/分叉、失败或未知，并标最后远端核查时间 | 本地文件；不适用 Git 同步 |

新建、切换任务、重连和 Git 操作完成后刷新实际状态。若 owner 在终端切换分支或进入 detached HEAD，UI 如实显示且提示与登记任务分支不符；自动 checkpoint/push 暂停，不偷偷切回或推送错误分支。断网或核查失败时保留最后确认值并标陈旧/未知，不把缓存的“已同步”冒充当前状态。工作目录、分支和同步信息与当前运行模式分开显示，切到 Chat 不隐藏仍存在的项目状态。

## 3. 文件进入、使用和展示

1. 上传、粘贴图片或导入文件前，Server 和 Host 都校验登录用户 → 固定 User VM → Conversation → Workspace 的归属。路径名只作显示信息，不能作为授权依据。
2. 文件字节可以按 [ADR-0010](../adr/0010-unified-web-gateway-private-user-vms.md) 经统一网关有界流式转发，但 Server/反向代理不得落盘、整文件缓存或记录正文。文件名、SHA-256、大小、MIME、进度可在当前请求中短暂传递；中央持久日志不得记录文件名、Workspace 路径或正文。
3. 原始文件只在所属 User VM Workspace 持久化。小图片即使以内联 image block 送给模型，也必须先保存原始 bytes；模型请求只包含用户在本轮明确选择的文件/图片，不能自动扫描并附带整个 inbox 或 Workspace。
4. 搜索 query 和模型请求会离开 User VM 到配置的 Relay/provider，这是功能所需的数据外发边界；本地文件不会因为启用 Web 搜索而自动发送给搜索服务。只有用户任务或 Agent 的显式工具调用可以读取并使用文件内容。
5. Preview、tree、artifact index、download 和 import 都使用同一 Conversation scope。文件引用路径相对 Workspace；Workspace 元数据按 CW-09 提供完整绝对 cwd 用于展示和复制，不能把该路径当成下载凭据。
6. research、subagent 和大工具结果采用临时文件 + 原子 rename；文件默认 `0600`，目录默认 `0700`。写盘失败、磁盘满或配额失败必须明确报错，不能把完整结果退回模型历史或声称已归档。

## 4. 既有数据与执行边界

| 风险 | 必须保证 | 明确边界 |
|---|---|---|
| Conversation 串读 | Host/API 以认证后的 Conversation 元数据解析 cwd；realpath containment；拒绝 `..`、绝对路径注入、符号链接逃逸和跨 Workspace 下载；token 绑定 user/VM/Conversation/用途并可过期撤销 | 同一 User VM 内的 Pi/Bash 以可信 VM owner 运行，没有 OS 级目录隔离。owner 或 Agent 主动使用绝对路径时可访问 owner 能读的其他目录；这是 [GW-01](./gitea-workspaces.md) 的执行模型，不宣称为安全 sandbox |
| Server 留存 | 聊天、附件、搜索正文、图片和 tool output 只在 User VM；网关只做有背压的流式传输；错误与 access log 脱敏 | VM snapshot、备份和虚拟化存储可能继续含已删除数据，由 VM owner 的保留策略管理 |
| Gitea 意外提交 | Project Workspace 的 `.pi-coffee/**` 仅本地、自动 exclude；平台 checkpoint 拒绝已跟踪的 reserved data，不使用无范围 `git add -A` | 可信 owner 可用原生 Git 强制发布任何可读文件；平台不冒充 DLP 系统，用户显式发布后的远端副本由 Gitea 管理 |
| 模型/搜索外发 | 每轮只发送明确引用的附件和完成任务所需内容；不自动枚举其他 Conversation；搜索工具不隐式附带本地文件 | 用户要求分析文件或 Agent 为完成任务显式读取后，相关内容可能进入模型上下文；UI 必须让附件选择可见 |
| 旧全局目录 | 迁移只按已验证 Session/Conversation ID 关联；复制/校验/切换成功后才改变元数据；无法证明归属的文件留在只读 legacy/quarantine 区 | 不能根据文件名、时间或内容猜测归属，也不能把全局 research/subagent 目录批量塞给最近一个 Chat |

该模型防止产品和服务意外跨 Conversation 访问；当前按 [ADR-0020](../adr/0020-unified-github-authority.md) 使用一个物理 owner 和系统登录，通过 Web 身份与目录分区，不宣称 OS 隔离。独立 Host 路由仍可配置；旧双 VM 演练记录保留为历史证据。

## 5. 生命周期

- **创建**：先保留 Conversation ID，再创建目录、分类子目录和 `0700/0600` 权限；Project Workspace 完成 clone、branch 和远端 SHA 校验后才可运行。失败保留可诊断状态，不把半成品作为有效 Conversation。
- **运行与重连**：浏览器断开不改变 cwd；Host/Pi 重启从持久元数据恢复同一路径。LSP 实例以 Workspace 为 key，模式切换不重建或改绑目录。
- **归档**：只改变可见性，不强停已经运行的工作，也不删除 Workspace、Pi transcript、附件、research、artifact、图片、branch 或 PR。恢复后继续使用原 cwd；永久清理前另行 quiesce 并核对实际写入状态。
- **永久清理（CW-10）**：归档、删除列表项、退出登录和服务重启均不能触发文件夹删除；只有明确的“永久清理”操作才可删除任务目录。清理前必须停止该任务的 Pi、子进程/LSP 与上传等写入，并显示完整目标路径及原生历史、附件/产物和远端对象的去留。一次确认可以明确覆盖多类数据，无需为每个子目录重复询问。Project Workspace 复核未提交、未推送及未版本化文件；Chat Workspace 明示本地文件无 Git 备份。没有明确授权删除的文件必须保留，不能因代码已同步而顺带删除附件；默认保留远端 branch/PR。部分失败保留可重试状态，不复用该 Conversation ID。
- **迁移**：既有 Project Checkout 保持路径。旧 `.pi-coffee/inbox/<session-id>`、全局 research 和 subagent artifacts 只有在归属可证实时迁入相应分类目录；校验成功前保留原件。旧无 Workspace Session 保持可读，用户选择 Chat 或 Project 归属后再启用写入。

## 6. 最小实现与验收

首轮只验证流程闭环，不扩展成文件治理平台：

1. 创建两个 Chat Conversation，得到两个不同 cwd 和完整分类子目录；各自在一个目录写入文件，另一 Conversation 的 tree/download/import 接口不可见。
2. 同一 Gitea 项目/起始分支创建两个 Work 任务，验证独立 cwd、`.git` 和任务分支；在其中一个编辑/提交不改变另一个的文件/index/HEAD。Git/LSP 行为不回归，`.pi-coffee/**` 不进入平台 checkpoint。
3. 上传文件、粘贴原图、执行 Web research 和产生一个超长 subagent/tool 结果，分别落到该 Conversation 的 `inbox`、`research`、`artifacts`；生成图片落到 `images`。Server 侧没有正文临时文件或 durable body。
4. 模式切换后 cwd 不变；Chat Workspace 不会静默变成 Repository，Project Workspace 不会移动到 Chat 根。
5. 归档后目录仍在，运行中的写入不被隐式中断；恢复后路径不变。永久清理前必须先 quiesce，并需要精确确认和按范围报告。
6. 路径逃逸、过期/错 Conversation token、符号链接和未登记 Session 均 fail closed；旧目录迁移不会猜测归属。
7. 前端验证 CW-09 五个字段，含完整路径复制、真实分支、断网陈旧状态、Chat 的“不适用”；clone 失败后能定位原因，同一创建请求重试不生成第二个任务。
8. 重命名、刷新、重启后仍为同一任务/Conversation/cwd；目录缺失时明确不可用，不自动创建替代目录。

实现完成前必须更新公开 Host Interface、Server 创建流程、部署 env 示例和对应 Gitea Issue，并从两仓 fresh clone 运行各自检查。设计范围分别由 [Agent #46](http://gitea:3000/awangs/pi-coffee/issues/46) 与 [Server #3](http://gitea:3000/awangs/pi-coffee-server/issues/3) 跟踪。真实双 VM 验收只需覆盖一个 Chat、一个 Work、一次文件流和一次重连，不重复 T4 已完成的 Gitea 故障矩阵。

## 7. 设计复核记录

2026-09-22 owner 澄清本轮检查目标是“遗漏与合理性”。四项基础合同合理：一任务一 Conversation 一目录；Work 选择 Gitea 项目/起始分支后自动 clone；前端展示 VM/项目/完整路径/当前分支/同步状态；归档保留目录、永久清理才删除；同项目不同任务独立 clone。修正上一版 Task 一对多的错误定义，补齐 CW-07～10 的创建重试、稳定映射、实际状态展示和清理范围，并消除 CW-02 将共同父目录也禁止包含子目录的歧义。

目录身份、运行模式、远端同步和原生历史的责任已可明确区分，没有需要先引入额外编排层才能实施的设计阻塞。实现与部署证据分别由 Agent #46 / Server #3 记录；文档本身不代替部署验收。

### 首版兼容策略

旧的按 Session ID 分隔的 inbox 保留原件，提供相同 Conversation scope 下的只读历史引用；新上传全部进入任务目录。全局 research/子任务结果不推断归属、不自动搬移。原生历史可继续读取；旧无 Workspace 的任务须显式分配目录才能继续写入。新 native subagent 运行目录也设置在所属 `artifacts/subagent-runs`，不只归档其返回摘要。创建中断保留元数据及目录；如果持久操作锁仍在，先检查未完成操作，再由 owner 移除对应锁重试。

## Pi-only Chat creation — owner correction, 2026-09-23

Agent #60 / Server #4 supersedes engine-independent Chat creation. New Chat
Tasks default to Pi and reject Codex/Claude at the Host HTTP creation boundary
before persisting a workspace. Work supports the five Host-advertised engines with a Gitea/GitHub
Project and independent Checkout. Engine bindings remain fixed except for explicit [Work Pi/Codex takeover](agent-takeover.md); it preserves the same workspace. Native local
tasks created before this correction remain accessible; their identity, files
and history are not migrated or relabeled by this change.

Pi account import into Web Server is a possible future direction only. No
credentials move in this change; native Codex/Claude authentication and VM data
ownership remain unchanged.
