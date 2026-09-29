# 开发交接：输入框改版、GitHub 仓库、Diff 升级（2026-09-29）

- **分支：** `arena/01a0e8a8-pi-coffee-server`，基于 `main` 的 `9734ce8`
- **状态：** 三件事都已完成，`npm run check` 通过（39 个测试文件、286 个测试）。
- **还没做：** 合并 main、在真实环境验收。

## 做了什么

| # | 需求 | 结果 | 提交 |
|---|---|---|---|
| ① | 把底部输入框改成 Arena 的样子（附截图） | 输入卡片（工具栏 + 任务条）；Diff 停靠在聊天右侧，可切换 Branch / 最近一轮和 Unified / Split；一键创建 PR | `1dee924` |
| ② | 新建 Work 任务时可以选 GitHub | 仓库下拉框分成 Gitea / GitHub 两组；GitHub 仓库先添加再选；任务分支推到 GitHub，PR 在 GitHub 上创建 | `1dee924` |
| ③ | 加强 Diff | 改用 @pierre/diffs：代码高亮、展开上下文、行评论汇总进输入框、按文件懒加载，不再截断到 150 KB | `a01c2c8` |
| — | 复核后的修正 | Codex 运行中，「最近一轮」会节流刷新；补记文档 | `17fd1ac` |

设计细节：
- 输入框和 Diff 的行为见 [Arena navigation](../spec/arena-navigation.md)。
- GitHub 仓库见 [ADR-0022](../adr/0022-github-work-projects.md)。
- 新 Diff 见 [ADR-0023](../adr/0023-pierre-diff-renderer.md)。

## 过程

1. **输入框改版（①）。** 先和 owner 对齐再动手，定下的方案：
   - Diff 做成右侧停靠面板。
   - 「最近一轮」用 Host 在每轮开始时拍的快照，先支持 Pi 和 Codex。
   - 创建 PR 一键完成。
   - 界面以中文为主，保留英文术语。
   - 顶栏的「本轮改动」并入 Diff 的「最近一轮」。
2. **GitHub 仓库（②）。** GitHub 作为第二个代码平台，登录仍用 Gitea。GitHub 令牌放在 Host 的环境变量 `PI_COFFEE_GITHUB_TOKEN` 里；clone 和 push 用 VM 自己的 Git 凭据。
3. **Diff 升级（③）。** owner 选了「全部做」。评估过几个渲染库，最后选用 @pierre/diffs 1.5.1。
4. **提交。** 开发环境反复被重置，提交是按原内容重建后推到会话分支的。owner 的选择：分两个提交，只推这个分支，不开 PR。
5. **复核。** 用 catskills `/refocus` 做了两次复核，发现两个问题：
   - Codex 运行中，「最近一轮」不会刷新；
   - 有几处改动不在需求里：gzip 和缓存、词级高亮。

   owner 回复「都按推荐」：补上节流刷新（`17fd1ac`）；需求外的改动保留，并在 ADR-0023 里注明。
6. **逐项核对有没有丢失。** ① ✅、② ✅；③ 还没核对。
7. **收尾。** 确认所有改动都已推送，整理了这份交接文档。

## 已知限制

这些都是对齐时定下的。

- Claude Code 不支持「最近一轮」。运行中刷新只对 Codex 有效；Pi 要等一轮结束才刷新。
- GitHub：
  - 令牌需要写权限；
  - 不做 fork，也不在 PI Coffee 里新建仓库；
  - 所有 PR 的作者都是令牌对应的账号。
- Diff 评论存在浏览器里，刷新页面会丢失。

## 待办

1. 核对 ③ Diff 有没有丢失。
2. 按 AGENTS.md 的要求，把范围和验收证据记到 Gitea Issue。
3. ADR-0012 补一句指向 ADR-0022。对账矩阵第 21、24 行等 owner 决定。
4. 开 PR 合并 main：先推 GitHub main，再把 Gitea main 快进到同一个提交。
5. 部署后在真实环境验收：
   - 配置 GitHub 令牌和 VM 的 Git 凭据，然后新建 GitHub 任务、推分支、创建 PR；
   - 用 Codex 跑一轮，看「最近一轮」会不会在运行中刷新。

## 本地运行

```bash
npm ci && npm run check   # 构建 + 全部测试
# 假数据预览（界面验收用）
PI_COFFEE_LAYOUT_HOST=0.0.0.0 PI_COFFEE_LAYOUT_PORT=4175 node scripts/serve-layout-fixture.mjs
```
