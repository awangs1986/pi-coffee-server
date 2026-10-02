# 沟通与开发历程（交接）

> **写给接手的同事：** 这份文档按时间顺序记录 owner 和开发者（Arena Agent Mode 里的 AI agent）之间的沟通：每一步 owner 提了什么、怎么对齐的、做了什么、为什么这样做。读完时间线，再看「现状」和「接手清单」，就可以接着干。文中只引用了关键原话，不是完整聊天记录。

## 基本信息

| 项目 | 内容 |
|---|---|
| 仓库 | GitHub `awangs1986/pi-coffee-server`（Gitea `awangs/pi-coffee-server` 是它的镜像） |
| 工作分支 | `arena/01a0e8a8-pi-coffee-server`，从 `main` 的 `9734ce8` 拉出 |
| 时间 | 功能提交都在 2026-09-29；本文整理于 2026-10-02 |
| 状态 | 三个需求都已完成，`npm run check` 通过（39 个测试文件、286 个测试）。**还没合并 main，没开 PR，也没在真实环境验收** |

| 提交 | 内容 |
|---|---|
| `1dee924` | 需求一（输入框改版）+ 需求二（GitHub 仓库），见 ADR-0022 |
| `a01c2c8` | 需求三（Diff 升级），见 ADR-0023 |
| `17fd1ac` | 复核后的修正：Codex 运行时，「最近一轮」会节流刷新；同时补记文档 |
| `e14550b`、`00a6576` 和本次提交 | 交接文档，依次是详细版、精简版和本版 |

## 沟通时间线

### 1. 需求一：把底部输入框改成 Arena 的样子

**owner：**「我的WEB端的对话框 在最低下 我想改成这样 你注意看图 图2-5是 底下create PR旁边点了以后的效果，开干之前你先和我对齐一下」，附 5 张 Arena 截图。截图没有存进仓库。

**对齐。** 开工前用选择题和 owner 确认了 5 件事：

| 问题 | owner 的回答 | 最后怎么做的 |
|---|---|---|
| Diff 用什么形式 | 「右侧停靠面板」 | 停靠在聊天右侧；屏幕窄于 1100px 时覆盖在页面上 |
| 「最近一轮」的数据从哪来 | 「第一项 但是不管claude 先做pi和codex」 | Host 在每轮开始时给工作区拍一份快照；Claude Code 显示「暂不支持」 |
| 工具栏怎么排 | 「按你的建议来」 | ⊞+ 是上传；「Agent ⌄」合并了 Agent、Chat/Work、来源、模型和思考深度；卷轴图标打开任务详情 |
| 创建 PR 的流程 | 「一键完成（推荐）」 | 先自动 Checkpoint，再弹一个标题对话框，创建后按钮变成「PR #N ↗」 |
| 界面语言 | 「中文为主，保留术语（推荐）」 | Diff、Branch、Unified、Split 这些词保留英文 |

对齐时开发者还说明了几项默认做法，owner 没有反对：
- 顶栏的「本轮改动」并入 Diff 的「最近一轮」，原来的按钮和面板删除。
- 「Gitea PR」按钮移到任务条上。
- 任务条上的 `+N −M` 表示任务分支相对基线的改动行数。
- Chat 任务的任务条只显示「Chat · 本地目录」。
- 修掉页面里重复的 `#diff-close`。
- 支持深色模式和窄屏。

**交付：**
- 前端：输入卡片分三层（输入框、工具栏、任务条），Diff 停靠在右侧（可切换 Branch / 最近一轮和 Unified / Split），创建 PR 一键完成。
- Host：每轮开始时拍快照，`changes` 接口新增 `scope:'turn'`。
- 验证：有自动测试，也在浏览器里截图核对过。

### 2. 需求二：新建 Work 任务时可以选 GitHub

**owner：**「新建work任务的时候除了gitea增加github的任务可选」

**对齐结果：**
- GitHub 仓库要先添加，然后才能选。下拉框末尾和「＋ 新建项目」菜单里都有「添加 GitHub 仓库」，可以搜索，也可以直接粘贴 owner/repo。
- GitHub 令牌放在 Host 的环境变量 `PI_COFFEE_GITHUB_TOKEN` 里，只在 Host 上使用；clone 和 push 用 VM 自己的 Git 凭据。
- 登录仍用 Gitea OAuth；原来「GitHub URL → 导入 Gitea」的入口保留。
- 不做的事：fork、在 PI Coffee 里新建 GitHub 仓库、GitHub 和 Gitea 之间的镜像。所有 PR 的作者都是令牌对应的账号。

**交付**（详见 [ADR-0022](../adr/0022-github-work-projects.md)）：
- Project 新增 `forge` 字段；Host 新增 `github_repos` 和 `github_project` 两个接口。
- 任务分支推到 GitHub，PR 也在 GitHub 上创建；如果已经有打开的 PR，就直接复用。

### 3. 需求三：加强 Diff

**owner：**「diff功能我想加强一下」。开发者列出可以做的几项，owner 选了「全部做」：
- 换渲染器，带语法高亮；
- 可以展开未改动的上下文；
- 行评论汇总进输入框，但不自动发送；
- 大 Diff 懒加载并虚拟滚动；
- 去掉 150 KB 截断。

**选型。** 评估过两个库。react-diff-view 只能配合 React 使用，没有虚拟化，2.2 MB 的 Diff 要渲染 26 秒，所以没选。最后用的是 @pierre/diffs 1.5.1。

**交付**（详见 [ADR-0023](../adr/0023-pierre-diff-renderer.md)）：
- 新增 `public/diff-view.js`。
- Host 新增 `change_file` 接口，按文件取 patch 和新旧两侧的文本。
- Web Server 给打包后的 vendor 文件加了缓存和 gzip。

Diff 面板的外框、`changes` 接口和 PR 流程都没有改。

### 4. 提交与推送

开发环境是 Arena 沙箱，几乎每轮都会被重置。第一次做好的本地提交因此丢了，后来按原内容重建。开发者询问提交方式，owner 的选择是：**分两个提交，只推会话分支，不推 main，不开 PR**。于是有了 `1dee924`（需求一和二）和 `a01c2c8`（需求三）。

### 5. 用 `/refocus` 复核

**owner：** 让开发者使用 [catskills](https://github.com/awangs1986/catskills) 仓库里的 `/refocus` 技能，后来又把技能说明完整贴了一遍。

`/refocus` 的做法是：重新读一遍需求、ADR、规格和对话里的决定，拿代码逐项对照，找出遗漏、跑偏和矛盾，只把真正需要 owner 拍板的事列成问题。一共做了两次：第一次提了 3 个问题，第二次收敛成下面 2 个。

| 问题 | 背景 | owner 的决定 |
|---|---|---|
| Q1：「最近一轮」要不要在运行中刷新 | 删掉「本轮改动」之后，Codex 每次改文件发出的 `turn_diff` 事件直接被丢掉，「最近一轮」要等这一轮结束才刷新。原来的「本轮改动」是实时刷新的 | 推荐方案 A：数据仍然只取 Host 快照；Diff 停在「最近一轮」时，每收到一次 `turn_diff` 就节流刷新 |
| Q2：需求外的改动要不要保留 | 有几项不在需求里：Web Server 的 gzip、内存缓存、vendor 长缓存和 ETag，以及 `review.js` 的词级高亮 `wordDiff` | 推荐方案 A：保留，并在 ADR-0023 里注明「开发者提出，owner 确认」 |

owner 回复「都按推荐」。

### 6. 逐项核对：需求一有没有丢

**owner：**「回顾一下 之前我们做的修改 我们一个个确认是不是遗失了」

开发者重新搭好浏览器环境，在假数据预览里截了 13 张图，逐项对照需求一，结论是全部都在。核对时开发者撤回了复核中的一个说法：「本轮改动」被删这件事，对齐时已经说明过，不是悄悄删的。

### 7. 落实复核决定：第三个提交 `17fd1ac`

- **运行中刷新：** Diff 停在「最近一轮」时，收到 Codex 的 `turn_diff` 就刷新。规则：
  - 最多每 1.5 秒刷新一次；
  - 两次读取不会同时进行；
  - 用户正在写评论时暂缓；
  - 一轮结束时的刷新会取代还没执行的那次。
- **文档：** 更新了 `docs/protocol.md` 里 `turn_diff` 的说明、Arena navigation 的 Diff 和 Acceptance 两节，以及 ADR-0023 的状态行。
- **测试：** 先写了会失败的测试，再实现；`npm run check` 结果为 39 个测试文件、286 个测试全部通过。

### 8. 确认状态

- owner 问「这3件事我们都算完成了吗」。回答：功能上都完成了，还差合并 main、真实环境验收、需求二和三的核对，以及文档收尾。
- owner 又问「之前这些改动都提交到分支了吗」，并要求「确保目前的成果都提交到了 arena/01a0e8a8-pi-coffee-server」。开发者把工作区和远端分支逐个文件比对，确认全部已推送。

### 9. 逐项核对：需求二有没有丢

**owner：**「继续」。开发者先重跑了 GitHub 相关的 6 个测试文件，77 个测试全部通过。然后在假数据预览里截了 10 张图，覆盖分组下拉框、添加仓库、添加失败时的提示、给 GitHub 任务创建 PR，以及没配令牌时的界面。结论：全部都在，没有发现新问题。

### 10. 交接文档

owner 要一份交接用的 md。过程如下：
1. 开发者先写了详细版（`e14550b`）。
2. owner 要求「简单回顾」，压缩成一页（`00a6576`）。
3. owner 说明要的是「回顾我们沟通和开发历史」的文件，于是改写成现在这份。

## 现状

- 分支上共有 6 个提交：3 个功能提交，3 个交接文档提交。`main` 仍是 `9734ce8`，没有 PR。
- 39 个测试文件、286 个测试全部通过。
- 核对时的截图都不在仓库里，已随沙箱重置丢失；需要时用文末的预览命令重拍。
- 如果继续在 Arena 沙箱里开发：沙箱经常被重置，每次开工先确认本地和远端分支一致，提交后立刻推送。

## 接手清单

1. **核对需求三（Diff）有没有丢。** 需求一和二都核对过了，只剩这一项。
2. **写 Issue 记录。** AGENTS.md 要求把范围、失败和验收证据记到对应的 Gitea Issue 里，这一步还没做。
3. **补文档。** ADR-0012 里还写着「GitHub 仍可作为后续发布/同步目的地」，需要补一句指向 ADR-0022。
4. **等 owner 决定：**
   - 对账矩阵（`docs/reviews/repository-unification-20260927.md`）第 21、24 行怎么写；
   - 什么时候开 PR 合并 main。按 AGENTS.md 的规定，先推 GitHub main，再把 Gitea main 快进到同一个提交。
5. **部署后在真实环境验收：**
   - 配置 GitHub 令牌和 VM 的 Git 凭据，然后依次添加仓库、新建 GitHub 任务、推分支、创建 PR；
   - 用 Codex 跑一轮，看「最近一轮」会不会在运行中刷新；
   - 打开一个大 Diff，试一下展开上下文和写评论。

## 和 owner 合作的方式

- **owner 明确提过的要求：**
  - 开工前先对齐（「开干之前你先和我对齐一下」）；
  - 只推会话分支，不开 PR（提交时的选择）；
  - 界面中文为主、保留英文术语，平时也用中文沟通。
- **仓库规则（AGENTS.md）：**
  - 先写会失败的测试再实现，提交前跑 `npm run check`；
  - 把范围和验收证据记到 Issue；
  - 发布时先推 GitHub main，再推 Gitea main。
- **一直沿用的做法：**
  - 把方案拆成几道选择题，附上推荐项，由 owner 选；owner 常回复「按你的建议来」或「都按推荐」；
  - 汇报时附上证据：提交号、测试数量、截图；说错的地方要明确更正。

## 资料索引

| 想看什么 | 去哪里 |
|---|---|
| 输入框、Diff 面板、「最近一轮」接口、验收范围 | [Arena navigation](../spec/arena-navigation.md) |
| GitHub 仓库的设计决定 | [ADR-0022](../adr/0022-github-work-projects.md)，以及 [Gitea workspaces](../spec/gitea-workspaces.md) 里的 GitHub 修订 |
| 新 Diff 的决定和取舍 | [ADR-0023](../adr/0023-pierre-diff-renderer.md) |
| `turn_diff` 事件 | [protocol](../protocol.md) |
| GitHub 令牌配置示例 | `deploy/uservm/host.env.example` |
| 主要测试 | `test/composer-diff.test.ts`、`test/github-forge.test.ts`、`test/github-projects-ui.test.ts`、`test/diff-view.test.ts`、`test/diff-file-http.test.ts`、`test/review-diff.test.ts`、`test/turn-changes.test.ts` |

## 本地运行

```bash
npm ci && npm run check   # 构建 + 全部测试
# 假数据预览（核对界面用）
PI_COFFEE_LAYOUT_HOST=0.0.0.0 PI_COFFEE_LAYOUT_PORT=4175 node scripts/serve-layout-fixture.mjs
```
