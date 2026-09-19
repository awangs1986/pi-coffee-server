# PI Coffee — GitHub 代码审查交接

更新日期：2026-09-19（UTC）

## SPEC §1.1 界面骨架实现（2026-09-19，UTC，工作分支 `arena/01a0b9c3-pi-coffee`）

按 [主 SPEC §1.1](docs/spec/multi-user-vm.md) 记录的两处差距改代码，不扩展到 §7.3 文件网关或 §7.4 缓存策略：

- **默认三栏**：项目模式宽屏（>1100px）右栏文件树常驻并随对话切换，收起偏好存 `localStorage['pi-coffee.files.v1']`；≤1100px 浮层、≤820px 单列；无项目根的旧模式不显示右栏与分支控件。
- **底部分支选择**：删除左栏 `#start-branch`，新增输入条 `#branch` 下拉；Host `POST /api/workspace` 新增 `branches` 动作（本地＋远端跟踪＋对话分支，不 fetch），`conversation` 动作接受远端跟踪名并校验；对话元数据新增 `startBranch`／`startCommit`。新对话惰性创建 worktree（首次发消息／上传／改模型来源），已打开对话改选分支 = 确认后新建对话，不迁移 worktree、不触碰合并锁。
- 新增 `npm run preview:workspace`：假 Pi＋临时项目根＋几条分支的全栈预览，只为看界面，不是部署模式。
- 验证：`npm run check` 构建成功、**29 个文件、158 项通过**；jsdom 级前端流程自测（惰性创建、来源预选、树加载、栏位收起、窄屏、分支改选取消／确认、切换对话、创建失败退回消息、旧模式）；真实栈下 WebSocket 帧序 `opened > history > transfer` 与文件树核对。**Playwright 版 `smoke:workspace-browser` 已同步改写但本环境无 Chromium，未跑**；真实 VM、Gitea 身份链路未复核。
- 未推送、未合并 `main`。

## Windows 真机复核与跨平台修复（2026-09-17，Europe/Paris）

在一台 Windows 11 真机的 fresh checkout 上完成了安装、构建、测试、Chrome 工作台和真实原生 Pi 模型链路复核。初始结果为 131 项通过、24 项失败；失败集中在 POSIX 路径/权限假设、Python 启动器、浏览器静态目录 URL 转换，以及明确依赖 Linux `/proc`、`fcntl`、POSIX 信号的子 Agent admission 验收。

- 已修复产品代码中的 Git 项目路径比较和 ZIP Python 启动器，并把测试夹具改成跨平台路径、失败和 symlink 场景。
- Windows 最终 `npm run check`：构建成功，143 项通过，13 项 Linux User VM 专属测试明确跳过；Linux 最终仍为 29 个文件、156 项全部通过。
- Windows Chrome 工作台 smoke 通过；修复了 `URL.pathname` 不能直接作为 Windows 静态资源路径的问题。
- Windows 上关闭 Linux 专属子 Agent admission 后，使用本机原生 Pi 登录完成真实模型 smoke：流式回复、断线重连、Host 历史恢复和同会话第二轮均通过。没有保存认证材料或模型正文。
- 使用临时 Gitea OAuth 应用完成真实 PKCE 登录、cookie 属性、固定路由撤销、重新登录和 logout 验收，并修复 PowerShell UTF-8 BOM 路由文件解析；临时应用、token 配置和浏览器会话已删除。
- Windows `smoke:web` 已实际验证 Web Search、context-fold 和 Harness；`smoke:subagents` 以结构化结果标明 Linux native admission 不适用。Linux 上两项仍完整通过。
- Linux 上 `smoke:subagents`、`smoke:web`、Chrome 工作台 smoke 全部通过；`npm audit` 为 0 漏洞。
- 证据与平台边界见 [Windows 真机验收记录](docs/reviews/windows-real-machine-acceptance-20260917.md)。真实双 Linux User VM、多用户并发及完整故障矩阵仍属于 P5，不能因这次 Windows 复核标为完成。

## 本轮质量审核修复（2026-09-16，Europe/Paris）

已按本文件基线审核 `arena/01a0a607-pi-coffee@1d33508` 并在本地工作分支修复。详见 [审核报告、修复与待验收边界](docs/reviews/completion-quality-20260916.md)。以下原交接的提交前测试与已知问题是历史记录；与本段冲突时，以本段和审核报告为准。

- 修复断线闲置回收中断后台工作、Git 队列失败传播、detached HEAD 未合并成果删除、手工发现空仓库不能新建对话、同名上传覆盖和完成凭证重用、VM 撤销端点卡住导致退出延迟、Pi 异常退出永久 busy，以及 390px 输入栏溢出。
- Vitest 锁定至 **4.1.11**，fresh `npm ci` 成功，`npm audit` **0 漏洞**。3.2.7 已不能消除当前 mocker advisory，未采用 `audit fix --force`。
- 最终 `npm run check`：构建成功，**29 个测试文件、155 项通过**；`smoke:subagents` 与 `smoke:web` 均 `ok: true`。
- 本轮实际重新执行了真实 Chrome 工作台 smoke：SVG/Markdown 可见、来源切换、归档恢复、390px 无横向溢出、无 pageerror。仍使用假 Pi；不等于 P5。
- Pi 故障测试实际 SIGKILL 本地 RPC fixture，验证中断落盘、重连无旧轮次重放、显式重新发送成功；不是完整实机故障矩阵。
- **P5 仍未执行**，跨 cwd/手工后台写入及原交接列出的恢复边界仍待验收。Gitea 本轮不可达，未关闭或更新 Issue。owner 于 2026-09-17 要求将修复和 [fix.md](fix.md) 一起提交并推送至 `arena/01a0a607-pi-coffee`；实际提交与远端状态以 Git 历史为准，不更新 `main`。

## 1. 审查入口与提交范围

- 仓库：`awangs1986/pi-coffee`
- 工作分支：`arena/01a0a607-pi-coffee`
- 比较基线：`fd20b6c8f266bc9a1e27de51687d327a16a09394`（Initial commit）
- 本交接随当前工作快照一起提交。审查提交 SHA 请以 GitHub 分支 HEAD 为准；不在文件中填写自身提交哈希。
- **基线只跟踪 README.md**。因此本次 diff 包含此前工作区已有的整套实现、Pi 增强层、部署模板、测试和文档，不只是最后一轮 P0–P4 的增量；不要将所有新增文件都理解为最后一轮重写。
- 根目录 `pelican-cycling.svg/png` 是已有示例产物，按 owner“全部工作提交”的要求一并保留；不是运行依赖。
- 凭据模式扫描命中的 `test/fixtures/tls/test-key.pem` 是现有 TLS 自动测试所需的自签名 fixture（CN=`pi-coffee-test`），不是生产凭据；绝不能在部署中使用。扫描仅为启发式检查，不代替安全审计。
- `node_modules`、`dist`、环境凭据、会话目录、测试日志、浏览器二进制不纳入提交。vendor JS 在构建时复制，不手工提交。
- 不向 main 推送、不自动合并。此分支用于代码质量审查，而不是宣告发布验收完成。

## 2. 当前状态

**P0–P4 的主要本地功能路径已接通；不能把 AC-01～12 全部标成通过。P5 双 VM 实机验收未执行。**

| 范围 | 实现与入口 |
| --- | --- |
| P0 身份/路由/来源 | `src/web/identity.ts`：Gitea OAuth、PKCE/state、内存会话和固定用户 VM 路由；`src/web/server.ts` HTTP/WS 授权；显式 Native/Relay 来源选择，不自动回退 |
| P1 项目/对话工作区 | `src/host/workspaces.ts`：发现手工 clone、URL clone、空项目、ZIP 导入；独立 worktree/branch/cwd；元数据及旧历史兼容 |
| P2 本地合并 | proposal/diff/确认、一次性 token、HEAD 和脏状态复查、项目锁、保留 Git 原生冲突；不自动 turn-end commit/merge |
| P3 文件/产物 | `src/host/transfer.ts`：VM 直连的 scoped 上传、文件树、预览和下载；实际文件产物索引；SVG/图片/Markdown/文本/PDF |
| P4 生命周期 | 归档恢复、仅归档页确认删除、删除失败重试、运行意图和中断标记、服务器权威状态；后台/排队子任务未静默或状态未知时拒绝操作 |
| UI | `public/`：左导航、中聊天、右文件/产物、小屏布局；采用 Arena 风格工作台布局，没有取得 owner 当前 Arena 截图，不是像素级复刻 |
| Pi 增强基础 | 保留原 Pi core/login；通用开发提示词、Simple/Lean 不启用子 Agent、Full 原生子 Agent、3/root 与 5/VM admission、搜索结果压缩、离线本地上下文恢复 |

权威需求与边界：

1. [产品 P0–P5 排序及 AC](docs/development/product-priorities-20260916.md)
2. [多用户工作台 SPEC](docs/spec/multi-user-vm.md)
3. [本轮实现记录、配置与限制](docs/development/p0-p4-implementation-20260916.md)
4. `AGENTS.md`（仓库工作规范）

旧 handoff 已保存到 `docs/development/handoff-before-review-20260917.md`，仅作历史参考；旧 backlog、CONTEXT 或部署长文中的未更新状态，不应覆盖以上入口。

## 3. 本次提交前验证

2026-09-17 在本次提交前重新执行：

| 命令 | 结果 |
| --- | --- |
| `npm ci` | 成功；依赖审计发现 2 项漏洞，见下节 |
| `npm run check` | build 成功；**29 个测试文件、144 项通过** |
| `npm run smoke:subagents` | 通过，`ok: true` |
| `npm run smoke:web` | 通过，`ok: true` |

上一轮 Chromium smoke 已通过：首次消息前切换来源、项目对话、SVG/Markdown、归档恢复、390px 窄屏、无 pageerror。**本轮没有重新执行浏览器测试**：之前的临时 Chromium/共享库不在当前恢复环境中。仓库保留可复现脚本，不将上一轮结果冒充本次执行。

```bash
npm ci
npm run check
npm run smoke:subagents
npm run smoke:web
npx playwright install chromium
npm run smoke:workspace-browser
# 已有 Chromium 时可设置 PLAYWRIGHT_EXECUTABLE_PATH
```

要求 Node >=22.19；Linux 用户 VM；Git 与 Python3（ZIP 安全导入、fcntl admission）。

注意：路由测试使用假 Gitea；浏览器使用假 Pi；部分 RPC 测试使用真实 Pi/原生子 Agent，但模型为本地 fixture。以上均不是实际供应商、真实 Gitea 或双 VM 发布证据。

## 4. 已知问题与审查优先级

### 优先审查，不得略过

1. **依赖审计未修复**：本轮 `npm audit` 报告 `vitest` critical、`@vitest/mocker` moderate（开发依赖），涉及 Vitest UI server 和 mock 路径访问。建议评估锁定升级至审计建议的 Vitest 3.2.7 后重跑测试。本轮按提交快照请求未额外升级依赖，未运行 `audit fix --force`。不要将 Vitest UI/dev server 暴露到公网。
2. **后台生命周期不是任意写入者的隔离内核**：已接 native status/capacity、带进程 birth identity 的 queued/running launcher、历史 async 引用。真实测试证明 native capacity 在 accepted→runner 启动窗口可能为零，不能单独用于删除许可。跨对话显式指定其他 cwd、手工后台 shell、跨目录写入仍依赖“不并发写同一工作区”的约定；完整跨 cwd 关联未完成。
3. **P5 未做**：真实 Gitea OAuth/撤销、Native 登录刷新、Relay 切换、两台目标 VM、2 用户×3 活跃对话、断线/重启/故障矩阵尚待执行。
4. **状态/崩溃恢复**：每项目根仅支持一个 Host；锁 marker 遗留需要人工检查后清理。失败 clone/import 保留目录；物理 worktree 删除与元数据保存之间的崩溃窗口仍需演练。旧归档没有 quiesced 标记时，需恢复并重新归档后删除。
5. **文件边界与 UX**：ZIP 首次导入需已有对话上传入口，可先建空项目；自动产物索引、候选扫描和界面卡片有上限。需继续验证长上传撤销、PDF、SVG 新标签页安全和目标设备表现。
6. **文档一致性**：当前新增配置示例与实现记录优先；历史 README/runbook/backlog 中的一 Web 对一 VM、mandatory Relay、旧执行排序等描述需在发布前系统核对。

### 建议代码阅读顺序

- 安全：`src/web/identity.ts` → `src/web/server.ts` → `src/host/server.ts` → `src/host/transfer.ts`。
- 状态与并发：`src/host/workspaces.ts` → `src/host/session.ts` → `src/host/pi-adapter.ts`。
- 子任务：`src/subagents/native-adapter.ts`、`workspace-jobs.ts`、`admission.ts`、`launch.py`；重点检查 acceptance 窗口、状态丢失、PID 重用、Simple/Lean→Full→Simple。
- UI：`public/app.js`、`render.js`、`app.css`；重点检查异步刷新、模型切换确认、多窗口和归档后重连。
- 验证：`test/identity.test.ts`、`workspace-routing.test.ts`、`workspaces.test.ts`、`workspace-transfer.test.ts`、`workspace-jobs.test.ts`、`host-server.test.ts`、`subagent-rpc.test.ts`；浏览器脚本 `scripts/smoke-workspace-browser.mjs`。

## 5. 部署注意事项

- 多用户公网绑定需身份配置；不能使用 `PI_COFFEE_ALLOW_UNAUTHENTICATED=1` 作为生产捷径。
- `PI_COFFEE_ROUTES_FILE` 用 Gitea 数字用户 ID → 独立 Host URL/token，权限 0600；不提交真实文件。
- 每个用户 VM 配 `PI_COFFEE_PROJECT_ROOT` 和原生 Pi agent/session 目录；在同一 VM 用户终端完成原生登录。
- Relay 是可选来源，`PI_COFFEE_RELAY_PROVIDERS` 明确列出 provider ID，默认 `cpa`；不自动 fallback。
- 产品模式不开放匿名 LocalSend。文件字节浏览器直达 VM，Web 仅做身份/聊天控制面，不持久化平台聊天或文件正文。
- 使用 `deploy/server/web.env.example`、`deploy/uservm/host.env.example` 和实现记录；只替换本地配置中的占位符，不把密钥写入 Git。

## 6. 下一位接手者

先读本交接并复跑检查，再按上面的优先级审查；不要重建已有基础，也不要因“每个阶段都有代码”就标 DONE。优先处理依赖安全及跨 cwd/故障边界，之后在真实双 VM 上按 SPEC 留证。继续在工作分支提交修正，不直接更新 main。
