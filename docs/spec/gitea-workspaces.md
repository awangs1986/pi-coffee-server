# Gitea 工作区与 VM 执行边界

> Native-engine extension (2026-09-23): the shared Workspace, file ownership and Gitea contracts remain in force. Codex/Claude Code Session bindings and writer-state adapters are planned in the [native-engine SPEC](./native-agent-engines.md); Pi-specific startup, mode, history and cleanup descriptions below are the current implementation, not automatic rules for the new engines.

状态：设计已确认（2026-09-21）；Agent/Server 代码已实现，部署与双 VM 验收见 [T0–T4](../development/t0-t4-gitea-workspaces.md)。决策：[ADR-0012](../adr/0012-owner-privileges-and-gitea-checkouts.md)。本文件是 Agent/Server 共用的工作区行为权威；Server 规格只引用，不维护另一套同步规则。

## 权限与责任

| ID | 正式合同 |
|---|---|
| GW-01 | Host/Pi 以 VM owner 运行，保留其 HOME、PATH、Git/SSH/Pi 配置；owner 具备 `NOPASSWD: ALL` 的 sudo。工具层无 allowlist、目录 sandbox、权限档位、命令审批；部署不得用 `NoNewPrivileges` 或其他设置阻断所需提权。T0 须从真实服务子进程验证，不能用当前终端权限推断。 |
| GW-02 | 完整执行能力不取消产品行为范围。当前任务的本地编辑、检查、必要 sudo，以及登记的 Gitea Conversation 分支正常 commit/push 已预授权；无需逐次确认。默认/共享分支合并、强推、远端删除、对外发布按用户明确授权范围执行，既有授权不重复询问。读取建议/分析请求不触发自动 checkpoint。 |
| GW-03 | Server 身份、固定 VM 路由、Host token、文件 API scope/路径检查继续存在；它们保护网络访问正确性，不限制 VM 内 Bash。VM root 不意味着可访问其他 VM、虚拟化宿主机或中央 Relay 密钥。 |

通用 Work 正文保持项目中立。由原生扩展/项目上下文向 Work 提供实际执行身份、sudo 探测、仓库与 branch 范围、同步策略；不把 Gitea 产品规则硬编码进通用正文。声明目标权限不能代替真实权限探测，也不能破坏 Chat 零系统提示词的设计。

## 代码与数据归属

| 组件 | 拥有 | 不拥有 |
|---|---|---|
| Gitea | Repository、远端分支与 commit、PR、merge 结果；已有身份与 Issue 权威 | 未提交/未推送内容、Pi 会话、VM 生命周期 |
| Agent Runtime / User VM | Project 登记、Conversation/Checkout 映射、Git 操作、Gitea 代码 API 的薄适配、本地 diff、checkpoint 状态、Pi/LSP/上传/产物 | 浏览器 OAuth、跨用户路由、自建 PR 合并引擎 |
| Server | 登录、固定路由、透明代理；UI 展示 Host 提供的仓库、同步和 PR 状态/链接 | Git 执行、clone、项目锁、Pi transcript 或第二套权威工作区索引 |
| VM owner | VM/root、Git 身份与凭据、备份/快照、故障恢复 | 平台自动 VM 管理服务 |

网页 OAuth 凭据与 VM Git/Gitea API 凭据用途分离。Git 使用 VM 的 SSH/credential helper，API 使用 VM owner 配置的凭据；浏览器只接收状态和链接。远端 URL 不嵌密码/token，凭据不进入 Git、Issue、命令输出和日志。

## 项目、分支和创建

> GitHub 修订（2026-09-29，[ADR-0022](../adr/0022-github-work-projects.md)）：Project 也可以直接指向 Host 配置的 GitHub（或 GitHub Enterprise）仓库，`forge: "github"`，ID 为 `github-<repository id>`。对这类 Project，GW-04 的“Gitea 实例”读作 Host 的 `PI_COFFEE_GITHUB_TOKEN` / `PI_COFFEE_GITHUB_API_URL`；GW-05 的“外部 GitHub 先导入 Gitea”只约束 URL 导入入口，不再是使用 GitHub 仓库的前提；GW-09 的 PR 在 Project 所属的 forge 上创建和复用，合并也在那里完成。GW-06 到 GW-12 对两种 forge 相同。

- **GW-04**：Project 指向已登记的 Gitea 实例及稳定 repository ID，保存可刷新 URL/默认分支；本地 Project 根目录不再是合并权威。实例必须来自管理员配置，不能让浏览器传任意带凭据后端地址。
- **GW-05**：保留 URL 导入、发现本地仓库、创建空项目、压缩包导入四个入口。外部 GitHub/本地/ZIP 内容先导入 Gitea 后登记；外部地址可保留为 upstream，后续同步 GitHub 是独立操作，不自动双向镜像。非空目标冲突报错，不覆盖已有远端。新空仓库先建立作者身份真实的初始 commit；不会伪造作者。ZIP 解压限制和忽略敏感文件规则继续生效。
- **GW-06**：每个代码 Conversation 从 Gitea 指定的远端分支（默认 repository 默认分支）解析到精确 commit，创建完整、独立的普通 clone；首版不共享 `.git`/alternates、不使用 shallow clone。分支名为 `coffee/<stable-owner-or-vm-id>/<conversation-uuid>`；分配后不让第二个活跃 Conversation 复用。碰撞报错/分配新 ID，不接管未知分支。
- 一个任务对应一个 Conversation 和一个 VM 本地目录；前端完整上下文展示与创建失败/重试行为见 [CW-07～10](./conversation-workspaces.md)。
- Host 记录 repository ID、owning VM、Conversation ID、cwd、branch、起点 SHA、最后确认远端 SHA/时间、PR 引用；元数据留 VM。clone 完成并校验后才发布可运行工作区，失败目录可诊断，重试不能误删已有文件或重复创建 Conversation。
- Pi/Bash/Edit/Git/LSP 都使用该 Checkout。同 Conversation 的运行、checkpoint、迁移/删除互斥；不同 Conversation 可并行，不保留项目级 Git/merge 锁。可信用户在终端绕过 Host 的操作不受平台锁强制约束，操作前后需重新核查实际 Git 状态。
- Chat/非代码会话不需要 Repository，但每个 Conversation 仍有独立的 Chat Workspace。目录、模式切换、附件/搜索/图片/产物归属与删除边界由[Conversation 工作目录 SPEC](./conversation-workspaces.md)定义；旧无工作区会话保持可读，明确选择 Workspace 后再启用写入。

## 同步、PR 和跨主机接续

- **GW-07**：完成一个有意义的实施阶段、准备交付/跨主机接续时，对明确属于当前任务的代码创建 checkpoint commit，并正常 fast-forward push 到已登记的 Conversation 分支。commit 不代表测试通过，交付必须另报验证结果。禁止每个工具调用后提交、盲目 `git add -A`、自动收录未知文件或私密运行数据；无变更不制造空提交。归档时仅在任务已停止且改动范围明确时尝试 checkpoint，失败仍可保留本地归档，并标未同步。
- **GW-08**：同时展示本地 dirty、ahead/behind/diverged、最后远端确认 SHA/时间和同步错误。只有从远端复核 branch SHA 与目标 checkpoint 一致才标已同步。网络不可用显示未知/陈旧，不报 ahead=0；push 超时先读远端确认是否成功；非 fast-forward 明确冲突，不自动 force/reset/rebase，不盲目重放未知副作用。
- **GW-09**：PR 指向 Gitea 中实际默认/用户选定目标分支，创建前复核已同步的 head；查询现有 source/target PR 使重试幂等。首版 UI 提供创建/打开真实 PR 和状态，合并在 Gitea 完成，不新造 merge 引擎/三方编辑器。Gitea API 为准，不复制分支保护政策；无权限、冲突和 PR 被关闭必须分别呈现。Bash 原生 Git 能力仍可按用户指令使用。
- **GW-10**：跨主机是“从已推送代码接续”：新 VM 校验源远端 SHA，建立新 Conversation、独立 clone 和新分支，并记录来源 repo/branch/SHA。旧 Conversation 和分支继续留原 VM；不跨机重分配原分支、不需分布式锁。新会话由用户提供目标或非敏感交接摘要；不会声称自动恢复 Pi 上下文/上传/凭据。断网时已有 checkout 可以本地工作，新 clone、远端同步/PR 和接续必须显示阻塞。
- 本地 diff 比较最近一次 fetch 的目标远端分支 merge-base，包含已提交与未提交改动；显示比较 SHA 与时间，远端不可达时明确其陈旧性。不能再比较一个本地 Project checkout 的 HEAD。

## 归档、删除与恢复

- **GW-11**：归档只改变可见性，不隐式停止运行、不删除本地文件/远端 branch/PR。运行中不创建竞态 checkpoint。未同步归档可以恢复继续；只有完成远端 SHA 核查的代码能宣称可跨主机恢复。
- 永久清理单独列明 Checkout、原生历史、上传/产物、远端 branch/PR 的影响。清理 Checkout 前停止该 Conversation 的写入、确认无需要保留的未提交/未推送代码及未版本化文件，并复核远端 checkpoint 可取回；远端不可达不自动放行清理。归档、代码已 push、PR 已 merge 均不能证明本地未版本化数据有备份。
- 默认保留远端 branch/PR；删除原生历史、上传/产物和远端分支各自需要明确范围授权。部分清理失败可恢复/重试，不虚报全部删除；不删除共享项目或其他 Conversation 文件。
- VM 快照恢复后先重新 fetch/核查实际远端，陈旧的本地“已同步”记录不能作删除依据。Host/Pi 重启标中断，不自动重放正在执行的命令。

## 旧状态迁移与协议边界

- **GW-12**：识别现有元数据 v1、`.worktrees`、仅本地分支、dirty/untracked/ignored 文件、已归档与无 cwd 会话；保留原数据和可回滚映射。先停目标会话写入，导出本地版本化历史和必要本地文件，再构建独立 clone；Git 推送只含代码，私密文件留 VM。校验文件/commit/引用后才切换 cwd 并重启该会话的 LSP 实例；旧目录仅在单独清理验收后删除。
- T1/T2 提供可加法发布的 Host 能力说明与新字段，新 Server 根据能力选择界面；旧 Host 不能被误调用新动作。旧工作区允许过渡期读/恢复/受控旧行为，但不对新 clone 执行旧本地 merge。
- T4 在所有已部署 Server 完成升级、旧会话迁移和回滚探针通过后移除平台 `git worktree` 创建/管理、本地 `merge_preview/merge`、proposal token 与项目 merge 锁。如移除动作违反现有 v1 合同，发布明确不兼容的新版本并让旧客户端可读报错；不能保持同版本静默改义。

## 实现状态与完成条件

当前 `src/host/workspaces.ts` 已使用每 Conversation 独立 clone、远端独占分支、checkpoint/SHA 确认、Gitea PR、跨主机接续和保留旧目录的迁移器。Host API 与 Server UI 已移除平台本地 merge 动作；原生 Git 工具仍可由用户主动使用 `git worktree`。systemd 继续以 owner 运行，安装脚本可配置并校验 `NOPASSWD: ALL`，但是否已部署必须以目标 VM 的 `/healthz` capability 和 `npm run probe:owner-access` 为准。

设计和代码在本范围内形成闭环：本地执行 → checkpoint → 远端确认 → PR/merge → 新主机按 SHA 接续；同时明示未版本化数据/原生会话不能由 Gitea 恢复。T0–T3 的代码完成不自动关闭部署验收；T4 仍要求两仓 fresh-clone 检查和双用户/双 VM 故障实测。
