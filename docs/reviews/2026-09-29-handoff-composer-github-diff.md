# 开发交接：Arena 式输入框、GitHub 仓库、Diff 升级（2026-09-29）

> Historical feature handoff. For the later `arena/01a0ed45-pi-coffee-server`
> merge candidate and review corrections, see [the merge review](2026-09-29-arena-ed45-merge.md).

- **仓库：** GitHub `awangs1986/pi-coffee-server`
- **分支：** `arena/01a0e8a8-pi-coffee-server`，基于 `main` 的 `9734ce8`
- **规模：** 3 个功能提交，40 个文件，+4484 −506
- **本文档：** 在功能提交之后单独提交
- **状态：** 三件事的功能都已完成，`npm run check` 全部通过（39 个测试文件、286 个测试）。
- **还没做：** 合并 main、开 PR、在真实 VM 和真实 GitHub 上验收。

## 一览

| # | 需求（owner 原话） | 结果 | 提交 | 决策记录 |
|---|---|---|---|---|
| ① | 「我的WEB端的对话框 在最低下 我想改成这样」（附 5 张 Arena 截图） | 底部输入框改成 Arena 式卡片；Diff 停靠在聊天右侧；一键创建 PR | `1dee924` | [Arena navigation](../spec/arena-navigation.md) |
| ② | 「新建work任务的时候除了gitea增加github的任务可选」 | Work 任务可以直接使用 GitHub 仓库：任务分支推到 GitHub，PR 也在 GitHub 上创建 | `1dee924` | [ADR-0022](../adr/0022-github-work-projects.md) |
| ③ | 「diff功能我想加强一下」 | Diff 改用 @pierre/diffs 渲染：代码高亮、展开上下文、行评论、按文件懒加载 | `a01c2c8`、`17fd1ac` | [ADR-0023](../adr/0023-pierre-diff-renderer.md) |

| 提交 | 内容 | 规模 | 当时的测试 |
|---|---|---|---|
| `1dee924` | ① + ② | 28 个文件，+2315 −476 | 37 个测试文件 / 275 个测试 |
| `a01c2c8` | ③ | 21 个文件，+2120 −56 | 39 / 284 |
| `17fd1ac` | 复核后的修正：「最近一轮」运行中刷新，并补记文档 | 6 个文件，+81 −6 | 39 / 286 |

## 开发历程

1. **改版输入框（①）。** 先和 owner 对齐，再动手。owner 的选择如下：
   - Diff 做成「右侧停靠面板」。
   - 「最近一轮」的数据来自 Host 在每轮开始时拍的快照；「先做 pi 和 codex」，Claude Code 先不支持。
   - 工具栏「按你的建议来」。
   - 创建 PR「一键完成」。
   - 界面「中文为主，保留术语」。

   另有几项是对齐时我提出的默认做法，owner 没有异议：
   - 顶栏的「本轮改动」并入 Diff 的「最近一轮」，原入口删除。
   - 「Gitea PR」按钮移到任务条。
   - 修掉重复的 `#diff-close`。
   - 支持深色模式和窄屏。
2. **接入 GitHub 仓库（②）。** 对齐后的方案：
   - GitHub 是 Project 的第二个代码平台，登录仍用 Gitea OAuth。
   - GitHub 仓库要先添加，然后才能选。
   - GitHub 令牌放在 Host 的环境变量里；clone 和 push 用 VM 自己的 Git 凭据。
3. **升级 Diff（③）。** owner 选了「全部做」：
   - 换渲染器；
   - 支持展开上下文；
   - 行评论可以汇总进输入框，但不自动发送；
   - 大 Diff 懒加载并虚拟滚动；
   - 去掉 150 KB 截断。

   渲染库评估过 react-diff-view，它只支持 React，也没有虚拟化，最终选了 @pierre/diffs 1.5.1。
4. **提交与推送。** 开发环境反复被重置，本地提交丢过一次，已按原内容重建。按 owner 的选择分成两个提交，只推到会话分支，不开 PR：`1dee924` 和 `a01c2c8`。
5. **复核（catskills `/refocus`，做了两次）。** 把代码和需求、ADR、对话里的决定逐项对照，发现两处偏差，owner 回复「都按推荐」：
   - **Codex 事件被丢弃。** 删掉「本轮改动」后，Codex 发来的 `turn_diff` 事件直接被丢掉，「最近一轮」要等这一轮结束才刷新。处理：数据仍然只取 Host 快照，但 Diff 面板停在「最近一轮」时，每收到一次 `turn_diff` 就节流刷新。
   - **有几项不在需求里：** Web Server 的 gzip、内存缓存、vendor 长缓存和 ETag，以及 `review.js` 的词级高亮 `wordDiff`。处理：保留，并在 ADR-0023 的状态行注明来源。
6. **第三个提交 `17fd1ac`。** 实现了上面的运行中刷新：
   - 最多每 1.5 秒刷新一次，两次读取不会同时进行；
   - 用户正在写评论时暂缓刷新；
   - 一轮结束时的刷新会取代还没执行的那次。

   同时更新了 `docs/protocol.md`、Arena navigation 的 Diff 和 Acceptance 两节，以及 ADR-0023。先写了会失败的测试，再实现。
7. **逐项核对有没有丢失。**
   - ① 输入框：✅，有 13 张截图。
   - ② GitHub：✅，相关的 6 个测试文件共 77 个测试通过，另有 10 张截图。
   - ③ Diff：还没核对。
8. **最后确认。** 远端分支 `17fd1ac` 和工作区内容逐文件一致，没有未提交的改动。

## 改了什么

### ① 输入框与 Diff 面板

- **输入卡片**从上到下三层：
  - 输入框；
  - 工具栏：⊞+ 上传、「Agent ⌄」、任务详情、发送；
  - 任务条：仓库 | 分支、`+N −M ›`、创建 PR。
- **「Agent ⌄」菜单**合并了原来的 Agent、Chat/Work、来源、模型和思考深度。**任务详情**里有 VM、路径、复制路径和本地压缩上下文。
- **Diff 面板**：
  - 停靠在聊天右侧，宽度 `clamp(460px, 44vw, 920px)`；屏幕窄于 1100px 时覆盖在页面上。
  - 提供 Branch / 最近一轮切换、Unified | Split 切换，以及「折叠全部」。
  - 按 Escape 关闭，焦点回到打开前的位置。
- **创建 PR**：先自动 Checkpoint，再弹一个标题对话框；创建后按钮变成「PR #N ↗」。
- **Host 端**：
  - Pi 和 Codex 每轮开始时，把工作区存成一个 Git tree（`conversation.turnSnapshot`）。这一步用临时索引，不动任务自己的索引。
  - `changes` 接口新增 `scope:'turn'`。

### ② GitHub 仓库

- `Project.forge` 取 `gitea`（默认）或 `github`；GitHub Project 的 ID 是 `github-<repository id>`。
- **仓库下拉框**按 Gitea / GitHub 分组。「添加 GitHub 仓库」入口在两处：下拉框末尾，以及「＋ 新建项目」菜单里。
- **仓库选择器**可以搜索，也可以粘贴 owner/repo、仓库 URL、clone URL 或 SSH 地址。
- **添加时检查三件事**：令牌有写权限、仓库没有归档、VM 的 Git 能 `ls-remote`。
- **任务分支** `coffee/<owner>/<id>` 推到 GitHub。创建 PR 走 GitHub API；如果已有打开的 PR，就直接复用。
- **Host 没配 GitHub 令牌时**，界面和以前完全一样。

### ③ Diff

- **渲染**：`public/diff-view.js` 使用 @pierre/diffs 和 Shiki。
  - 删除行显示红色虚线条，新增行显示绿色实线条；
  - Unified 视图只有一列行号，长行不换行；
  - Split 视图中没有对应行的一侧打斜线。
- **展开上下文**：「N 行未改动」可以就地展开。第一次展开时取新旧两侧的文本，每侧不超过 1 MB。
- **按文件加载**：
  - 文件滚动到离视口约 900px 时才挂载；
  - 同时最多发 4 个请求；
  - 合并 patch 里缺的文件，用 `change_file` 单独获取（不超过 4 MB），所以界面上不再有 150 KB 截断。
- **行评论**：
  - 选中行后点「+」写评论。
  - 底部显示「评论 (N)」，可以「汇总到输入框」：生成一条消息放进输入框，但不自动发送。
  - 评论只存在浏览器里，刷新页面会丢失。
- **降级**：浏览器缺少 `IntersectionObserver` / `ResizeObserver`，或者 bundle 加载失败时，退回内置的 `review.js` 渲染。
- **构建**：
  - `scripts/build-vendor.mjs` 用 esbuild 把 Pierre 打包成 `public/vendor-*.js` 和 `public/vendor/`。这些文件已加入 gitignore，由 `npm run build` 生成。
  - Web Server 给 vendor 路由加了缓存头、ETag 和 gzip。

## 接口与配置变化

| 类型 | 名称 | 说明 |
|---|---|---|
| Workspace API | `changes` + `scope:'turn'` | 用快照 tree 对比当前工作区，包括未跟踪的文件 |
| Workspace API | `change_file {id, path, scope, base, contents?}` | 返回单个文件的 patch（不超过 4 MB），可选带上两侧文本（每侧不超过 1 MB）；只读 |
| Workspace API | `github_repos`、`github_project {repository}` | 列出和登记 GitHub 仓库；Host 没配令牌时返回 409 |
| `GET /api/workspace` | `capabilities.forges` | 格式为 `{gitea, github}`，两个布尔值 |
| 数据 | `conversation.turnSnapshot`、`Project.forge` | 新增字段；旧数据不需要迁移 |
| Host 环境变量 | `PI_COFFEE_GITHUB_TOKEN`、`PI_COFFEE_GITHUB_API_URL` | 都是可选的，示例见 `deploy/uservm/host.env.example` |
| devDependencies | `@pierre/diffs` 1.5.1、`esbuild` 0.28.2 | 版本已锁定 |

## 已知限制

这些都是对齐时定下的，不算缺陷。

- Claude Code 不支持「最近一轮」。
- 「最近一轮」运行中刷新只对 Codex 有效，因为它依赖 `turn_diff` 事件；Pi 要等一轮结束才刷新。
- GitHub 方面：
  - 令牌必须有写权限；
  - 不做 fork，不能在 PI Coffee 里新建 GitHub 仓库，也不做 GitHub 和 Gitea 之间的镜像；
  - 所有 PR 的作者都是令牌对应的账号。
- Diff 评论只存在浏览器内存里，刷新页面就会丢。

## 验证

- **自动测试**：`npm run check`（构建 + vitest）结果为 39 个测试文件、286 个测试全部通过。主要的新测试文件：
  - `test/composer-diff.test.ts`
  - `test/github-forge.test.ts`
  - `test/github-projects-ui.test.ts`
  - `test/diff-view.test.ts`
  - `test/diff-file-http.test.ts`
  - `test/review-diff.test.ts`
  - `test/turn-changes.test.ts`
- **GitHub 的 Host 流程**：用假的 GitHub API 加一个本地空仓库做测试。测试真实执行了 clone、推送任务分支、创建 PR，并确认 GitHub 任务不会调用 Gitea 的 PR 接口。
- **界面**：用 `scripts/serve-layout-fixture.mjs` 起一个假数据预览，再用 Chromium 截图，核对了 ① 和 ②。截图没有放进仓库。
- **还没验证过**：
  - 真实 GitHub：令牌、仓库权限、VM 上的 Git 凭据；
  - 真实 Codex 运行时的「最近一轮」刷新；
  - 部署到 VM 之后的表现。

## 待办（接手从这里开始）

1. 核对 ③ Diff 有没有丢失（① 和 ② 已经核对过）。
2. 按 AGENTS.md 的要求，把范围和验收证据记到对应的 Gitea Issue 里。
3. ADR-0012 里还写着「GitHub 仍可作为后续发布/同步目的地」，需要补一句指向 ADR-0022。
4. 对账矩阵（`docs/reviews/repository-unification-20260927.md`）第 21、24 行，等 owner 决定怎么写。
5. owner 同意后开 PR 合并进 main。按 AGENTS.md 的顺序，先推 GitHub main，再把 Gitea main 快进到同一个提交。
6. 部署后在真实环境验收：
   - 配置 GitHub 令牌和 VM 的 Git 凭据，然后依次添加仓库、新建 GitHub 任务、推分支、创建 PR；
   - 用 Codex 跑一轮，看「最近一轮」会不会在运行中刷新；
   - 打开一个大 Diff，试一下展开上下文和写评论。

## 本地运行

```bash
npm ci
npm run check     # 构建 + 全部测试，大约 70–80 秒
# 假数据预览（界面验收用）
PI_COFFEE_LAYOUT_HOST=0.0.0.0 PI_COFFEE_LAYOUT_PORT=4175 node scripts/serve-layout-fixture.mjs
```

## 踩过的坑

- 跑 jsdom 测试前要先执行 `npm run build`，它会生成 vendor bundle；`npm run check` 会自动构建。
- jsdom 没有 `IntersectionObserver`，所以测试里的 Diff 走的是 `review.js`。要测 Pierre，需要注入 `globalThis.__piCoffeeDiffs`。
- Pierre 的几个特点：
  - 对 hunk 的行数校验很严格；
  - 展开按钮需要先通过 `loadDiffFiles` 提供两侧文本；
  - 背景色只能用 `unsafeCSS` 覆盖。
- `test/pi-package-integration.test.ts` 在跑全部测试时偶尔会超时，单独重跑可以通过。
