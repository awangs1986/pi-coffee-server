# P0–P4 工作台增量实现记录（2026-09-16）

## 范围与状态

owner 补充：布局/交互参考当前 Arena.ai 工作台，沿用现有前端实现为左侧项目/对话导航、中央聊天、右侧文件与产物预览。未取得 owner 当前 Arena 页面截图，不宣称像素级复刻，也不复制其品牌元素。

本轮已经编写并接通 P0–P4 的主要本地流程，但**不是 P0–P4 全部验收完成**。后台子任务已补只读状态接缝和拒绝操作测试；真实认证刷新/撤销和完整故障矩阵仍需验收；P5 双 VM 实机验收未执行。以下区分实装与待完成，不能据此关闭全部票据。

## 已接入现有代码的路径

| 阶段 | 本轮代码 | 复用与新增边界 |
|---|---|---|
| P0 | `src/web/identity.ts`：Gitea code+PKCE/state、HttpOnly cookie、固定路由、退出、会话到期、定期授权重查；Web HTTP/WS 授权与 VM readiness；原生模型环境不移除、显式“原生 Pi / 管理员 Relay”来源选择 | 仍用 WebServer/HostClient/HostServer、Pi RpcClient 与原生登录；OAuth token 仅在 Web 进程内存，不进浏览器/VM/磁盘；公网绑定无身份默认拒绝 |
| P1 | `src/host/workspaces.ts`：固定根元数据、发现/clone/空项目/ZIP 导入、每对话 worktree/branch、cwdForSession 接到原生 adapter | 原生 Git + 原有创建/恢复接口；旧会话保留原 cwd，不自动搬迁；项目模式必须显式配置 |
| P2 | 五分钟、一次性 merge proposal，source/target HEAD 绑定、来源 diff、确认后复查、项目锁、Git 冲突保留 | 不实现 Git 引擎或冲突编辑器；不自动 turn-end commit/merge；空项目/导入初始化提交属于用户创建项目操作 |
| P3 | VM scoped tree/preview/download/artifact index；匿名 shared 默认关闭；实际路径/敏感目录检查、45 秒文件租约；图片/SVG/MD/文本/PDF；产物索引来自实际文件，不只猜助手文本 | 复用 TransferServer、Markdown 净化器、消息 renderer；字节由浏览器直达 VM，不经 Web 持久化中转；前端三栏与小屏折叠 |
| P4 | 归档/恢复、仅归档页确认删除；脏/未合并 worktree 拒绝删除；部分删除保留可重试标记；旧会话归档不删共享 cwd；运行意图落盘与重启中断提示；项目状态多窗口刷新；后台/排队子任务未静默时拒绝生命周期操作 | 复用 HostSession、原生历史、事件广播。修复 accepted prompt 在浏览器断开前被可变 socket 引用丢失的窗口，以及快速模型结束导致最后一次 RAF 渲染丢失的问题 |

## 运行与配置

### Web/控制面

设置以下变量，并在 Gitea 登记精确回调 `PI_COFFEE_PUBLIC_URL/auth/callback`：

```
PI_COFFEE_WEB_BIND=0.0.0.0
PI_COFFEE_GITEA_URL=http://GITEA_HOST:3000
PI_COFFEE_GITEA_CLIENT_ID=REPLACE
PI_COFFEE_GITEA_CLIENT_SECRET=REPLACE
PI_COFFEE_PUBLIC_URL=http://WEB_HOST:3000
PI_COFFEE_ROUTES_FILE=/etc/pi-coffee/routes.json
```

`routes.json` 为管理员配置，0600；键是稳定的 **Gitea 数字用户 ID**，不是显示名。示例（不得提交真实 token）：

```json
{
  "1": {"hostUrl":"ws://VM_A:8788/host","hostToken":"REPLACE_WITH_VM_A_TOKEN"},
  "2": {"hostUrl":"ws://VM_B:8788/host","hostToken":"REPLACE_WITH_VM_B_TOKEN"}
}
```

每用户的 URL/token 必须独立。路由文件每次授权读取；连接每 5 秒复查，Gitea 用户状态/token 最多缓存 30 秒。Gitea 不可达时下一次重查拒绝，不用旧状态无限放行。退出清除此用户的 Web 登录，尝试撤销其 VM 文件授权；撤销请求失败时文件租约兜底。Web 重启清空登录，用户需重新登录，但 VM 任务不应停止。

### 每台用户 VM

```
PI_COFFEE_HOST_TOKEN=REPLACE_WITH_THIS_VM_TOKEN
PI_COFFEE_WORKDIR=/home/USER/work
PI_COFFEE_PROJECT_ROOT=/home/USER/work/projects
PI_COFFEE_AGENT_DIR=/home/USER/.pi/agent
PI_COFFEE_SESSION_DIR=/home/USER/.pi-coffee/sessions
PI_COFFEE_TRANSFER_ADVERTISE=VM_LAN_ADDRESS
```

- 每个项目根仅运行一个 Host 服务实例；不支持两个 Host 各自缓存同一个元数据文件。使用现有 systemd/容器服务管理，不自行启动第二套进程。
- 同服务用户、同 agentDir 在 VM 终端使用 Pi 原生认证；不要求模型 Relay 在线。Relay provider 若需要，继续由原有 models.json/客户端 token 显式配置。
- 在项目下点击“新对话”只是进入草稿态：底部输入条的分支下拉预选默认分支，**首次发消息、上传文件或改模型来源时才创建 worktree**（2026-09-19 改为惰性创建，起始分支取自下拉；创建失败时消息退回输入框，不留半成品）。Relay 来源由 VM 环境 `PI_COFFEE_RELAY_PROVIDERS` 明确列出 provider ID（逗号分隔，默认 `cpa`，与旧例子一致）；不按名称猜测，不自动回退。未配置可用 Relay provider 时该来源不可选。
- 分支下拉数据来自 `POST /api/workspace {action:"branches", projectId}`：返回 VM 克隆内的本地分支、远端跟踪分支（如 `origin/release`，不主动 fetch）和其他对话的 `coffee/<id>` 分支，并标出默认分支；`{action:"conversation", branch}` 接受其中任一名字，未知或非法分支返回 409 并给出可读原因。对话元数据新增 `startBranch`／`startCommit`（40 位提交号），旧元数据缺省字段时按原样加载。已打开对话里改选分支 = 确认后新建对话，不迁移现有 worktree。
- `PI_COFFEE_PROJECT_ROOT` 启用工作台模式；未启用时保留旧单 Host 兼容流程，但身份化 Web 不允许连接未启用 workspace 的 VM。
- 不开启匿名 LocalSend。`PI_COFFEE_LEGACY_LOCALSEND=1` 只可在无 workspace 的明确旧环境使用；不是双用户产品配置。
- `PI_COFFEE_ALLOW_UNAUTHENTICATED=1` 仅用于明确的单用户演示/诊断，不是多用户发布配置。
- 文件 token 45 秒租约，打开的页面续租；退出/路由撤销/Host 重启后旧授权失效，Web 异常退出则等租约到期。已经完成的下载无法撤回；长上传完成前重新检查租约。
- ZIP 导入要求 Python3，最多 10000 项/256 MiB 展开；拒绝链接、越界、加密条目和 `.git`。通过现有对话上传 ZIP，再在“新建项目”输入 `zip:文件名`。首次使用可先建空项目作为上传入口；专门的一步式导入向导仍待改善。
- Git 操作不执行仓库 hooks，不用 URL 密码；Git SSH/凭据由用户在 VM 配好。新项目初始化及缺省平台 merge author 为 PI Coffee；有 VM Git 作者配置时 merge 复用该配置。
- 崩溃留下 `.coffee/locks/<hash>` 时相应操作拒绝；管理员先检查 Git 状态/残留操作，再清除对应 marker，不自动重放。原生子 Agent 的 admission 锁文件是另一套目录，**运行时不能删除**。

## 本地证据

- `test/identity.test.ts`：state/PKCE、cookie、拒绝外部 Origin、路由撤销、callback 重放。
- `test/workspace-routing.test.ts`：两个本地真实 Host + 一个 Web，假 Gitea；身份路由、项目隔离、Host token、跨用户请求/CSRF 拒绝、退出。
- `test/workspaces.test.ts`：真实 Git 的独立 worktree、heads 变化拒绝、一次性确认、冲突保留、项目锁、归档/删除重试、ZIP 越界拒绝、中断标记、实际产物索引。
- `test/workspace-transfer.test.ts`：scoped 授权、默认拒绝匿名、symlink/跨 workspace、SVG MIME/CSP、撤销。
- `scripts/smoke-workspace-browser.mjs`：真实 Chromium + 本地 Host/Web/Transfer，**假 Pi**；选择项目→发消息→创建 workspace→文件树/SVG/Markdown→归档/恢复→小屏无横向溢出；检查 pageerror。
- 浏览器 smoke 不需要真实账号。安装开发依赖后 `npx playwright install chromium`，执行 `npm run smoke:workspace-browser`；环境已有 Chromium 时设置 `PLAYWRIGHT_EXECUTABLE_PATH`。沙箱此次常规浏览器下载不可达，使用独立测试目录的 Chromium 包及共享库完成检查；没有将浏览器二进制纳入仓库。容器缺中文字体会影响截图字形，不代表已验证目标终端字体表现。
- 最新全量 `npm run check`：29 个测试文件、144 项通过；另有真实 Pi 后台窗口专项测试、Host 拒绝未知/活动子任务、PID 重用检测。两个原 smoke 和浏览器的最终复跑结果见本轮最终交接，不以本地测试代替 P5。

## 尚不能划掉的事项

1. **P4 状态接缝已补，仍需扩展实机矩阵**：原生只读 status/capacity + 子进程 birth identity（含排队 launcher）+ 原生历史的 async 引用共同判断。测试实际发现 native capacity 在“已接受、runner 尚未落状态文件”窗口可以为零，故不能仅依赖它。缺失/不认识的原生产物视为未静默；不自动取消或猜测已完成。仅验证无子任务后，停掉空闲父 Pi、关旧连接并操作。归档保存 quiesced 标记，供无 Pi 状态下删除；旧归档需恢复、确认作业结束并重新归档。单测及真实 Pi/假模型的后台 acceptance 窗口测试已通过。**这不是 VM 命令沙箱**：用户手动后台 shell、跨对话指定其他 cwd/跨目录写入仍依赖既定“不并发写同一工作区”约定，尚未完整覆盖跨 cwd 的生命周期关联；此边界不得包装成任意 VM 写入者的全局互斥。
2. **P0 原生供应商与 Gitea 实机**：Gitea 实际 OAuth 版本/权限、原生登录/刷新、多来源切换和已运行 Pi 的更新规则，需要真实实例验证；没有声称全部 provider 已支持实测。
3. **P4 故障矩阵**：现有断线回归和运行意图落盘不是全部 Host/Pi/VM 故障注入，尤其突然 Pi 崩溃、Web 重启、后台通知与多窗口冲突需要扩展实测。
4. **P3 边界**：自动产物扫描有 5000 个候选/200 个索引、界面 20 个卡片上限，跳过敏感/依赖目录；其余文件可从树查看。PDF 实际浏览器行为、长上传撤销、跨域 TLS/证书及移动端目标设备仍需验收。产物引用不等于所有历史文件永久存在。
5. **P1/P2 恢复**：项目锁崩溃后采用人工检查再解锁，失败 clone/import 保留目录；需部署演练。多 Host 共用一根元数据不是支持拓扑。项目分支/工作区初始化不是自动迁移旧目录。
6. **P5 未做**：两台用户目标 VM、真实账号、2×3 负载和 AC-01～12 未完成；不可用本地 fake 替代。

本实现记录撰写时尚未提交；后续提交/交接状态以根目录 `handoff.md` 和 Git 分支历史为准。未自动合并。下一步扩展跨 cwd 与完整故障矩阵，再执行真实部署矩阵；不得因表格里每个阶段都有代码，就把 P0–P4 全部标 DONE。
