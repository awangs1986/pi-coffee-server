# ADR-0022: GitHub 仓库作为 Work 任务的第二代码源

日期：2026-09-29。状态：**accepted**（owner 在任务对齐中确认：“新建 work 任务的时候除了 gitea 增加 github 的任务可选”）。

修订 [工作区 SPEC](../spec/gitea-workspaces.md) 的 GW-04、GW-05 和 GW-09：外部 GitHub 仓库不必先导入 Gitea，可以直接登记为 Work Project。[ADR-0012](./0012-owner-privileges-and-gitea-checkouts.md) 的其余决定不变：独立 clone、独占任务分支、Checkpoint、远端 SHA 核查、跨主机接续和归档规则全部照旧，只是远端可以是 GitHub。[ADR-0004](./0004-gitea-is-identity-and-ticket-authority.md) 也不变：登录仍是 Gitea OAuth，Gitea 仍是身份和 Issue 权威。

## 决策

- **Project 带 forge。** `Project.forge` 取值 `gitea` 或 `github`。没有这个字段的已有 Project 视为 Gitea，不需要迁移。GitHub Project 的 ID 是 `github-<repository id>`，和 Gitea 的数字 repository ID 分开；名称在两种 forge 之间仍然唯一。
- **先添加再选。** 新建 Work 任务时，仓库下拉框按 Gitea / GitHub 分组。GitHub 组末尾有「＋ 添加 GitHub 仓库…」，任务条的「＋ 新建项目」也提供同一入口。选择器列出 Host 令牌能访问的仓库（最近推送的前 500 个），也接受粘贴的 `owner/repo`、仓库页面 URL、clone URL 或 SSH 地址。添加一次后，仓库常驻在下拉框里。
- **登记条件。** 添加时 Host 会检查三件事，任何一项失败都不写入 Project：
  - 令牌对仓库有 push（或 maintain / admin）权限；
  - 仓库没有归档；
  - VM 的 Git 能 `ls-remote` 默认分支。

  同一个 GitHub 仓库重复添加是幂等的；仓库改名后再添加，会刷新名称、URL 和默认分支。
- **凭据。** 可选的 Host 环境变量控制 GitHub：
  - `PI_COFFEE_GITHUB_TOKEN` 用于 GitHub REST，只做三件事：列出仓库、核对单个仓库、创建或复用 PR。
  - `PI_COFFEE_GITHUB_API_URL` 用于 GitHub Enterprise，例如 `https://ghe.example/api/v3`。

  令牌只在 Host 使用，不会发给浏览器；Host 启动 Agent 时会把它从子进程环境中剥离。clone、fetch 和 push 继续使用 VM owner 自己的 Git 凭据（例如 `gh auth setup-git` 或 SSH key），和 Gitea 一样。远端 URL 不嵌入凭据。
- **任务分支。** 仍然是 `coffee/<owner>/<conversation-id>`，推送到 GitHub 仓库。Diff、Checkpoint、同步状态和「最近一轮」都不变。
- **PR。** 「创建 PR」在 GitHub 上创建 PR，base 是 Project 默认分支。Host 先通过稳定 repository ID 解析当前的 `owner/repo`，再按 `head=<owner>:<task branch>` 和 base 查找已经打开的 PR；找到就复用，所以重试是幂等的。PR 作者是令牌账号，所有用户共用（和 Gitea 令牌一致）。合并在 GitHub 上完成。
- **没配置时。** 没有配置 GitHub 令牌的 Host 行为和以前完全一样：下拉框不分组，「＋ 新建项目」直接新建 Gitea 项目。

## 不做

- fork 流程：令牌没有写权限的仓库不能添加。
- 在 PI Coffee 里创建 GitHub 仓库。
- GitHub 与 Gitea 之间的镜像或自动同步。
- 按用户区分的 GitHub 身份。

既有的「GitHub URL → 导入 Gitea」入口保留。

## 取舍

- **共享令牌，不做每用户 GitHub OAuth。** 这样实现和运维最简单，和现有 Gitea 令牌的模型一致。代价是 PR 作者都是令牌账号，令牌能看到的仓库对这个 Host 的所有用户可见。每个用户的 Project 列表仍然各自独立；需要区分作者时，再单独做 GitHub OAuth。
- **写权限只核对，不代管 Git 凭据。** 令牌负责 API，VM Git 凭据负责传输，两者分开配置。添加仓库时用 `ls-remote` 当场验证传输，失败会给出配置提示，而不是等到创建任务时才失败。

## Superseded authorization policy (2026-10-03)

[User-scoped GitHub authorizations](../spec/github-accounts.md), Server #36,
replaces the shared-token and VM-global Git credential paragraphs above. Gitea
login may bind multiple GitHub accounts; projects/tasks select one explicitly.
The preceding shared-token tradeoff remains historical, not the current production
contract. Fork remains outside this change.
