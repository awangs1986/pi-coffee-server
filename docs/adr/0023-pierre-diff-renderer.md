# ADR-0023：Diff 面板改用 @pierre/diffs，按文件懒加载并支持行评论

日期：2026-09-29。状态：**accepted**（owner：“diff 功能我想加强一下”；对齐时选择「全部做」：换渲染器、展开上下文、行评论汇总进输入框、大 Diff 懒加载与虚拟滚动）。

补充 [Arena navigation](../spec/arena-navigation.md) 的 Diff 一节。面板外壳不变：标题、折叠全部、Branch / 最近一轮、Unified | Split、×、Escape 与焦点返回、创建 PR。Host 的 `changes` 接口也不变。

## 背景

原来的 `public/review.js` 自己画表格，高亮器很简陋，合并 patch 超过 150 KB 就截断，既不能展开未改动的行，也不能写评论。评估过两个现成库：

- **react-diff-view**：只能配合 React。它没有虚拟化，自带基准里 2.2 MB 的 Diff 要渲染 26 秒；高亮依赖 refractor@3；Unified 有两列行号。可复用的只有解析和展开工具函数，用处不大。
- **@pierre/diffs**：Apache-2.0，提供 vanilla API，用 Shiki 高亮，带虚拟化组件。它的 `diffIndicators: 'bars'` 正是 Arena 的样子：删除行是红色虚线条，新增行是绿色实线条，Split 空侧打斜线，Unified 只有一列行号。

## 决策

- **渲染器**
  - 每个文件由 @pierre/diffs（`1.5.1`，精确锁定）的 `VirtualizedFileDiff` 渲染。
  - 设置：`diffIndicators: 'bars'`、`lineDiffType: 'word-alt'`、`hunkSeparators: 'line-info'`、`overflow: 'scroll'`（不换行）。
  - 用我们自己的文件头（折叠箭头、路径、`+N −M`），关闭库自带的文件头。
  - 主题跟随应用的浅色/深色，背景和字体通过 `unsafeCSS` 取应用的 `--bg`、`--mono`。
  - 文件体由 `public/diff-view.js` 管理，`app.js` 只保留面板外壳。
- **打包**
  - `scripts/build-vendor.mjs` 在 `npm run build` 中用 esbuild 生成 `public/vendor/`。
  - 入口是固定名的 `diffs.js`，其余都是扁平、带内容哈希的 `diffs-<hash>.js` chunk；Shiki 的语言和主题是独立的按需 chunk，Diff 用到哪种语言才下载哪种。
  - 该目录由构建生成、git 忽略，和 `public/vendor-*.js` 一样。第一次打开 Diff 时才 `import()`。
- **界面文字**
  - 库里 4 条可见英文在打包时替换为中文：「N 行未改动」「后面可能还有未改动的行」「全部展开」「文件末尾没有换行符」。
  - 版本锁定；如果某条原文找不到，构建直接失败，升级时不会悄悄变回英文。
- **Web Server**
  - 除扁平的 `/<name>.<ext>` 外，只多放行 `/vendor/<name>.js`（一层、仅 JavaScript）。
  - 哈希 chunk 发 `public, max-age=31536000, immutable`。
  - 入口发 `no-cache` 加 ETag，返回 304。
  - 其余外壳文件仍是 `no-store`。
  - 1 KB 以上的文本资源按 `Accept-Encoding` 做 gzip，每个版本只压缩一次。
- **懒加载与虚拟滚动**
  - 文件头立刻全部列出，文件接近视口（约 900px）才挂载。
  - 行级虚拟化：同一个 `Virtualizer` 挂在 `#diff-content` 上，4800 行的文件在 DOM 中只保留约 100 行。
  - Host 的合并 patch 仍限 150 KB（任务条和轮询要用）。被截断的文件、以及没有文本 patch 的未跟踪或无计数文件，用新的只读动作 `change_file` 按文件取完整 patch：同时最多 4 个请求，单文件上限 4 MB，超过时提示在 VM 上用 `git diff`。
  - 原来面板底部的“仅显示前 150 KB”截断取消。
- **展开未改动的行**
  - 第一次点展开时，`change_file {contents: true}` 取两侧全文。
  - 每侧上限 1 MB。二进制、超限或已删除的一侧返回 `null`，面板提示「无法展开未改动的行：原因」。
- **行评论**
  - 在行号上点选或 Shift 点选范围，点行旁的「+」打开评论框。⌘/Ctrl + Enter 保存，Escape 取消，Escape 不会关闭面板。
  - 保存后评论显示在对应行下方，可以编辑或删除。
  - 底部托盘显示「评论 (N)」「清空」「汇总到输入框」；清空前会确认。
  - 汇总生成一条消息，追加到输入框已有内容之后，不自动发送。消息里每条评论都带路径、行号范围（删除侧标「改动前」）、最多 8 行原文引用和评论内容。
  - 评论按任务保存在当前页面内存里：刷新 Diff、切换布局、关闭再打开面板都会保留，汇总或清空后删除，刷新浏览器会丢失。
- **回退**
  - 浏览器没有 `IntersectionObserver` / `ResizeObserver`，或者 bundle 加载失败时，继续用 `review.js` 渲染，并提示「Diff 渲染组件加载失败，已切换为基础视图」。
  - 回退视图没有虚拟化，但同样按文件补取被截断的 patch。

## `change_file` 合同

`POST /api/workspace`

- **请求：** `{action: 'change_file', id, path, scope?, base?, contents?}`
- **返回：** `{scope, path, base, patch, truncated, oldContents?, newContents?, contentsUnavailable?}`
- **只读：** 不写 Checkout、索引、HEAD 或 refs，也不占用任务的生命周期锁，Agent 运行时也能读取。
- **路径校验：** 和 `changes` 相同。`.git`、`.pi-coffee`、`.env`、凭据文件、`..`、绝对路径和非字符串一律 409。
- **Branch：**
  - `base` 必须是 `changes` 返回的 merge-base（40 或 64 位 SHA），而且仍是 HEAD 的祖先，否则提示刷新 Diff。
  - 已跟踪文件执行 `git diff <base> -- <path>`（包含已提交和未提交的改动），未跟踪文件生成新文件 patch。
  - 旧侧取 `git cat-file <base>:<path>`，新侧读工作区；符号链接取链接目标文本。
- **最近一轮：**
  - 用开始时的快照 tree 作为基准，通过一次性索引只 `add` 这一个路径，再执行 `git diff --cached <tree> -- <path>`，任务自己的索引不受影响。
  - 没有快照、Chat 或不支持的 Agent 时，返回和 `changes` 相同的 409 原因。

## 后果

- 首次打开 Diff 要下载入口（约 500 KB，gzip 约 140 KB）加所用语言的 chunk；之后的哈希 chunk 由浏览器长期缓存。磁盘上 `public/vendor/` 约 10 MB，大部分是不会用到的 Shiki 语言。
- 虚拟化以后，浏览器的页内查找只能找到已渲染的行。
- 升级 @pierre/diffs 要同时核对界面文字替换、`unsafeCSS` 变量和 `VirtualizedFileDiff` 的构造和渲染接口；`test/diff-view.test.ts` 的替身按这个接口编写。
- Claude Code 仍不支持「最近一轮」。

## 验证

- `test/diff-file-http.test.ts`（Host HTTP 接口）：
  - 已提交和未提交的改动、新文件、删除、二进制、超限文件；
  - 私有路径、越界路径和无效 base；
  - 最近一轮只看快照之后的改动，并且不碰任务索引。
- `test/web-server.test.ts`：vendor 路由的缓存头、ETag / 304、gzip，以及拒绝非 JavaScript 或多层路径。
- `test/diff-view.test.ts`（浏览器控制器）：
  - 按视口挂载，并只补取缺失的文件；
  - 原地切换布局和主题，折叠后卸载；
  - 展开上下文和无法展开时的提示；
  - 评论的新增、编辑、删除、确认清空、跨刷新保留和汇总格式；
  - bundle 失败时回退到 `review.js`。
- 原有的 `test/composer-diff.test.ts`、`test/native-agents.test.ts`、`test/review-diff.test.ts` 继续覆盖回退渲染。
- 真实 Chromium 在布局夹具（`scripts/serve-layout-fixture.mjs`，含一个 4800 行的生成文件和被截断的合并 patch）上验证了高亮、展开、评论、Split、深色和窄屏。
