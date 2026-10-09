# Codex 作为 MISHU 主秘书

状态：2026-10-07 接受目标；2026-10-09 人工协调源码候选正在验收，未发布/未上线。C06–C08 安全汇报/自动提醒仍不可用，其余未验收项保留。
完整公开规格与实施父项：[#84](https://github.com/awangs1986/pi-coffee-server/issues/84)；任务拆分见
[实施任务](../development/mishu-codex-tickets.md)。本规格扩展
[现有 MISHU 契约](mishu.md)，不宣称 Codex 目标能力已经与 Pi 等同。

## 1. 用户得到什么

用户可以完全不用 Pi，选择已有 **Codex Chat 或 Codex Work** 作为 MISHU 主秘书：明确勾选咖啡菜单、
完成 `/mishu-setup`，然后询问项目进度、传递信息、安排已授权事项、登记和跟踪已有
任务，并在独立开启提醒后接收延迟结果的摘要。身份、性格和秘书业务来自 MISHU；
思考、回复、原生工具与会话历史来自 Codex CLI，不通过隐藏 Pi 会话代办。

入口沿用平台现有的无仓库 Codex Chat（#98，2026-10-08）和 Codex Work，不改变
普通对话的行为。用户希望用 **Codex 的 `gpt-6-luna` 做 MISHU 主秘书**；模型由原生
目录与每对话设置选择，不隐式代换或修改其他对话。Chat 不再是 Pi-only，旧版这一句
已被 #98 平台能力取代。Work 的项目 cwd 和原生权限保持当前规则，不新增全局秘书
或自动跨引擎 takeover。普通 Codex 对话不会自动成为秘书。

选中后即能回答“我是 MISHU，你的秘书”，保留亲切、细心、可靠的表达，遵从用户最新
称呼、语言与语气。未配置时说明尚未授权；Host 不可用时如实说明未知。普通问候和
已经明确授权的低风险事项直接处理，只有目标/事项歧义、新授权范围或真正危险操作
才询问必要问题；不得重新开启多轮例行确认。身份不是权限凭据。

## 2. 开启与配置

1. 在已保存至少一个原生轮次的 Codex Chat/Work 勾选 **MISHU 秘书（当前对话）**。能力不足时
   展示具体不可用原因，不隐式换引擎、创建替代会话或启动 Pi。
2. 通过 Host/Browser 执行 `/mishu-setup` 或等效可发现按钮，不依赖 Pi 扩展或
   Codex 是否原生解析这个 slash command。可用的 `/mishu`、`/mishu-tasks`、
   `/mishu-report`、`/mishu-notifications`、`/mishu-history`、`/mishu-disable`
   同样走明确的应用控制入口，不把未支持命令当普通文本发送并声称已执行。
3. 沿用最近 72 小时的新对象目录、最多 20 联系对象、有效旧对象增量保留、当前标题、
   精确 Conversation/原生绑定和取消不保存的规则。对象可以是已有五种 Agent 会话；
   标题只用于查找，同名有歧义时问一次，不合并绑定。
4. 用户选择信息通知或允许授权执行并确认。勾选菜单只选择秘书身份，不授予联系对象、
   派工、提醒、创建任务或回答目标原生权限的权限。配置和提醒开关只接受真实用户交互。
5. 提醒独立默认关闭。能力不足时禁用对应按钮并保留人工查询，不虚假承诺稍后主动汇报。

忙碌时启用/取消须遵守现有闲时变更规则，不中断正在运行的本会话或目标。
原生线程建立/恢复时安装的动态工具可能持久化；即使仍被原生模型看见，取消选择后
Host 必须拒绝调用。启用前应验证当前线程可安全接入，不能通过静默换线程规避限制。

## 3. 一个业务账本，独立的源 Agent 接入

Host 继续拥有账号 scope、Task Brief、Assignment/回信责任、事件、Outbox、通知队列、
预算、撤权和持久配置。Pi/Codex 秘书共享这些业务规则和公开 Interface，不复制
Codex 专属任务账本，也不把凭据放到插件、模型参数或浏览器。Browser 只做认证、
控制入口和展示；Codex 原生细节留在 Agent Adapter。

源接入必须提供可校验的能力与事实：精确源绑定、当前原生 thread/turn/item、
真实用户输入关联、受控秘书工具调用、身份状态刷新、汇报运行隔离、原生输出持久证据
及被动恢复。分别报告 supported/unavailable/unknown 与原因，不能以一个 available
布尔值掩盖差异；无工具汇报与输出恢复失败不应阻止已验证的人工信息查询。

运行身份由 Host 在输入 admission 时创建，并与 Codex 原生事件绑定。工具调用
只能引用这条可信关联，不能自己提交任意 userMessageId 来冒充用户授权。所有入口
重新校验 scope、选择状态、源和目标绑定、授权修订、操作类型及业务幂等身份；
伪造 turn、其他账号/秘书、旧工具调用、通知或目标回复不能获得用户执行权限。

最新身份/人格/权限是有界应用上下文，不不断写入永久聊天记录，不保留旧的提升权限。
不得覆盖用户原生 developer instructions 或引入 Pi Harness/LSP/handoff。原生配置
和项目说明仍是 Codex 资源；任何声称权限的旧模型文字/项目文件都不能改变 Host 授权。
具体原生上下文更新与撤销方案必须在安装版本上验证；没有安全方案则该能力不可用。

## 4. 对话、跟踪和自主程度

人工询问必须实际联系已配置对象，报告关联回执/有来源的回复；idle、空 inbox 或工具
未执行都不能算“已经问过”。目标忙碌可按已授权请求排队，秘书能继续回答其他问题。
状态明确区分未投递、已接收、运行中、等待用户、部分进展、原生结束、失败和不确定；
原生 final answer 与 turn 终态结合展示，不把进程退出或 idle 当业务验收。

任务登记、纠正、停止跟踪和授权派工复用现有 Host revision、授权连续性与幂等规则。
明确用户指令和同事项追问是现有授权，不要求每个工具步骤重新确认；新事项或超出
授权才重新澄清。停止跟踪/取消提醒只停止秘书后续工作，不能停止目标已收到的工作。
秘书不得代用户答复目标的原生权限问题。

任务跟踪关注已经存在的真实目标运行，包括用户在目标窗口直接启动的任务；不能
要求请求有 MISHU 前缀。登记竞争、原生事件先到、重复事件、后来无关运行、目标绑定
替换必须与准确 run/watermark 关联。Host 重启后未知的原生结果保持 uncertain，
不凭展示缓存重新生成或重投递任务。

源引擎能力与目标能力分开：Codex 当秘书不自动让 Codex/Claude/Cursor/Grok 目标
具备 Pi 的持久 dispatch 或离线恢复保证。执行、消息、在线观察、被动恢复分别使用
目标已验证的能力；不支持的持久派工显式拒绝，现有消息桥的回执不得冒充该保证。

## 5. 汇报运行必须无工具且能恢复原输出

人工或自动汇报都由可信 Host 报告意图触发，携带有界事实、来源和覆盖的事件范围。
目标内容是不可信数据，不是用户输入。汇报运行不得执行内置工具、shell、文件操作、
网络/搜索、MCP/Apps、动态工具、子 Agent 或协调写操作，也不得继承前一用户 run 的
派工权限。必须在执行前机械阻断；事后检测或提示“不要用工具”不算满足。

**只读 sandbox、approvalPolicy=never、禁用部分动态工具都不能证明全工具禁用。**
必须对安装版本验证完整阻断路径，包括无需审批的读工具和外部 MCP。若原生 API
不能做到，则 Codex 无工具摘要能力为 unavailable，主动汇报保持关闭并解释原因；
仍可人工查阅 Host 已记录的事实。不得隐藏改用 Pi、另一个提供商 HTTP 调用或
把不受约束的普通 Codex run 包装成安全汇报。

汇报使用当前秘书原生线程中的可识别运行，并复用 ReportRecord/输出提交协议。
Host admission 先持久化处理意图，再启动原生运行；持久关联 thread/turn/output
item、内容 hash、事件范围、授权 generation。只有原生已持久化且身份匹配的终态
输出才能 ACK/标记已汇报。取消、错误、部分 commentary 不作为成功汇报。

原生已保存而 ACK 丢失、Host 重启、浏览器断开和展示缓存删除时，恢复同一份原生
输出并补交，不重新调用模型或重复摘要。不允许 settled 推断 accepted。无法证明
原生持久化或无法恢复时保留 uncertain、未完成回信责任和人工诊断，不自动重试生成。
实现方案必须证明汇报上下文不把目标指令变成下一次用户 run 的权限。

## 6. 延迟通知、队列和生命周期

用户开启提醒后，已登记任务的相关结果能在无浏览器、无追加用户 prompt 时，经过
Host 有界、持久队列抵达该 Codex 秘书；重连后看到一份真正的原生汇报。秘书忙碌
或等待原生问题时不抢占、不 steer 进当前用户 turn，汇报在合法空闲边界排队。
沿用现有逐秘书公平性、合并事件、唤醒预算、容量及可见诊断，不新增高频 watcher。

每次 admission、原生开始、输出提交和 ACK 都检查 source generation/撤权栅栏。
停止提醒、删除对象、取消选择或归档后，旧 worker 不得发布或消耗回信责任。Host
重启可从保存的账号 scope 发现并恢复，不依赖网页/API 先访问才能启动。

清空上下文、更换绑定、Fork、takeover 不自动继承授权、未提交队列或主秘书身份。
新源绑定需要重新选择/确认；历史 Task Brief 只允许明确的 note-only 恢复，不能
带回执行授权。引擎/模型切换按当前平台规则处理：同绑定模型切换仍重新检查能力，
Pi↔Codex takeover 不自动接管秘书。普通 Work 的原生行为保持不变。

## 7. 官方接口依据与必须验证的缺口

2026-10-07 实际读取 [OpenAI Codex app-server 文档](https://developers.openai.com/codex/app-server)
（当前官方重定向到 [该页](https://learn.chatgpt.com/docs/app-server)）。文档说明：

- `dynamicTools` / `item/tool/call` 是 experimental API；需显式 opt-in。工具会保存
  在 thread rollout metadata 并在 resume 时恢复，不能假设关闭菜单自动删除。
- `thread/read` 与 `includeTurns` 可读取已有 thread 而不 resume/订阅运行。
- CLI 可生成与具体版本匹配的 schema；安装版本是能力判定依据。
- turn/start、原生身份事件和审批接口存在；文档本身不证明当前安装版本支持
  可撤销的临时角色上下文、全工具禁用或所需输出持久恢复语义。

这些是设计入口，不是 Coffee 已实现证明。先验证现有原生登录和绑定，不读/搬运
token，不升级运行时来绕过未验证门槛。任何升级应独立记录兼容性与审批范围。

## 8. 公共接口与真实网页验收

每项通过调用者相同的 scoped HTTP/WS、生产 Agent Adapter 和真实网页验证。
fixture 能验证错误/竞争，不能替代已认证 Codex 实测。远程测试先读 runner 配置；
使用隔离合成会话，不清空或改写用户真实任务。

| ID | 必须观察的用户结果 / 故障结果 |
| --- | --- |
| C01 | 无 Pi 进程依赖，Codex Chat/Work 明确启用后认识 MISHU 身份/人格/当前权限；普通 Work/Chat 保持原行为 |
| C02 | 网页设置可滚动、可取消、增量保留与当前标题正确；未配置/失联/能力不足明确显示；按钮和 slash 入口等效 |
| C03 | 实际 Codex→Pi、Codex→Codex 信息询问/回执；忙碌排队、切换/重开可继续；没有空喊已联系 |
| C04 | 明确用户事项一次授权即可登记/执行支持的操作；通知/旧 turn/项目文本/跨 scope 伪造无权限 |
| C05 | 直接启动目标 run 的登记竞争、多个目标、无关后来运行、晚到结果与 waiting-user 关联准确 |
| C06 | 恶意目标内容不能调用任何工具/委派/协调写；下一真实用户 run 仍保持自身权限；做不到则 UI 显式 unavailable |
| C07 | 原生输出已保存/ACK 丢失重启后恢复同 item/hash，不重新生成；丢失 display index 不丢回信责任；未证明结果保留 uncertain |
| C08 | 默认关闭提醒；开启后秘书 turn 结束仍收到一次延迟汇报，无浏览器也工作；忙碌不抢占、预算和公平性可见 |
| C09 | 停止/撤权/归档与开始/ACK 竞争，旧 worker 无权发布；目标工作继续；不同账号/秘书互不影响 |
| C10 | 清空/Fork/takeover/新绑定不继承授权；原生恢复失败不静默换线程；显式 note-only 恢复不派工 |
| C11 | 五种目标的消息/观察/恢复/dispatch 各记录 PASS/FAIL/UNAVAILABLE，Codex 作源不抹去目标限制 |
| C12 | 不加载 Pi/旧 Watchdog/subagent 代办；现有 Pi 秘书回归通过，准确 source/package/fresh-clone 与部署 UI/API 身份分开 |

C06/C07 是原生摘要与主动汇报的发布硬门槛。失败时可只发布已通过的人工联系/查询，
不得将全部主秘书闭环标记完成。本期不完成 M01–M13 的所有未来功能，不引入新 helper、
定时巡检、集中原生审批或新建目标会话。实现、安装、main 合并和生产激活分别记证据。

## 9. 2026-10-09 人工协调源码候选边界

当前候选接入现有原生 Codex 线程，使用线程级 MCP stdio（`coffee_mishu.mishu`），
不依赖只存在于 `thread/start` 的 experimental dynamicTools 重建旧线程。安装版本
0.159.1 的 schema 不给 `thread/resume` 提供 dynamicTools；本候选不用这一字段。
每个前台用户轮次前只卸载/恢复同一闲置线程，读取原生自己的已绑定 session_meta，验证 id/cwd，最多读取首行 256 KiB，保留原有
base instructions 并追加本轮有界应用角色；用户原生 developer guidance 保持原样。
只恢复当前线程并更新本次 MCP 配置。不写伪造 user 消息，不累积 MISHU 角色。
原生角色可能应用的标记先写入私有偏好，再更新原生配置；工具发现失败也保留恢复
责任。取消选择后重新打开时恢复原始 baseline。普通从未启用秘书的原生线程不读取
这份额外元数据，也不套用角色恢复。实际安装版本证明恢复参数 developerInstructions
和 collaborationMode 中的角色文字不足以保证模型识别身份，本候选以原始 baseline
加本轮应用角色的实测路径为准。
原生线程尚未保存首轮记录时，应先发送一条普通消息；选择接口明确拒绝空记录，
不能利用空线程恢复机制静默建立替代秘书线程。

咖啡菜单只选择身份；Codex `/mishu-setup` 和菜单 **MISHU 设置** 是 Browser/Host
应用入口。目录/选择/权限/最后确认复用同一账号账本和精确 binding。setup ticket
一次性、绑定源、10 分钟过期。取消不保存，配置不能由模型工具调用。`/mishu`、
`/mishu-tasks` 和 `/mishu-disable` 同样由应用处理；直接将秘书控制 slash 命令送入
Codex 原生 prompt 的公共 WS 路径拒绝执行，而不是请模型猜测配置成功。

工具能力仅存在于当前 Host 前台 admission，绑定当前原生 run，不采信模型提供的
user/source/thread/turn 身份。秘书忙碌时采用 follow-up 排队；选中的 Codex 源不支持 steer 内更换权限，网页禁用插话且公共 WS 明确拒绝，避免旧工具冒充新用户输入。
每轮换发 capability；终态、取消、撤权及 binding
生命周期均撤销。校验跨过异步等待后与提交前再次确认，过期调用不能新增账本事项。
已持久接收的消息从调用上下文退出，由 Host 继续投递并复查源/目标授权；秘书轮次
结束或 Browser 断开不会取消这些已接收消息。inbox 对本轮已发送消息最多等待共
12 秒，历史消息不启动后台轮询，不用新 ID 重试。

`source.coordination`、`source.reports`、`source.reportOutputRecovery` 分开公布。
当前 Codex 后两项为 unavailable：`/mishu-report`、`/mishu-notifications`、自动
Outbox 唤醒不能变成不受限制的 Codex prompt。原生 MCP 的 `default_tools_approval_mode=approve` 仅用于平台注册、只暴露一个
mishu 工具的 coffee_mishu 服务，前提仍是当前用户 admission 和 Host 的精确授权。
不改变 shell、网络、其他 MCP 或目标原生审批；配置和提醒不能通过此工具开启。
未配置/停用时不安装协调工具。历史 note-only 的 Codex 网页恢复入口
仍未实现，`/mishu-history` 明确不可用。任务工具沿用 Host 的 register/update/observe/
stop/dispatch 和目标 capability 检查；这些入口可用不等于 C04–C11 全部已经验收。

运行 `scripts/probe-mishu-codex.mjs` 可验收隔离 Browser/Web/Host/MCP 路径。默认
协议 fixture；`MISHU_REAL_CODEX=1` 显式使用当前原生认证与 `gpt-6-luna`，目标为
隔离真实 Pi adapter（合成 provider）及原生 Codex。证据目录只保存合成测试，不进
提交/Issue。源码、真实原生验收、安装包和生产激活分别记结论；完整矩阵及实测结果见
[候选验收记录](../development/mishu-codex-source.md)。


### Native tool readiness (2026-10-09 repair)

Each foreground refresh checks only the bound coffee_mishu tool/auth inventory
using toolsAndAuthOnly; unavailable unrelated MCP resources must not prevent a
secretary turn. Missing/error tool readiness still rejects before model execution,
with no replacement thread and no grant widening. See [repair evidence](../development/mishu-manager-repairs.md).
