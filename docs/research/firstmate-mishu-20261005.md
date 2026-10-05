# Firstmate 与 MISHU 的协调设计对照

日期：2026-10-05。研究问题：旧版 MISHU 借鉴过 Firstmate；当前 Coffee 插件是否保留了让秘书可靠、人性化地协调其他 Agent 的机制？

结论：Firstmate 的重点是把用户意图变成**有记录、有人跟进、有结果回报的协调责任**。角色措辞只占一小部分。当前 Coffee MISHU 保留了身份、亲切表达、明确选择对象、消息投递和回执，但没有迁移完整的记忆、任务责任账本、后台监督和通知恢复。因此，“像秘书说话”和“可靠地完成秘书协调闭环”必须分别验收。

## 范围与证据边界

- Firstmate 原始来源：[kunchenguid/firstmate](https://github.com/kunchenguid/firstmate)，只读研究快照 `e5b9dddc982e546b81b4bfce754df1465270a59e`，提交时间 `2026-10-05T11:26:05-07:00`。下面均使用该提交的永久链接；未运行上游脚本或安装其插件。
- MISHU 基线：独立插件 `0.1.4`，源码 `857056529517a2ba12cec9748c33b583485773ba`；当前 Coffee 合同见 [MISHU SPEC](../spec/mishu.md)。研究时另检查了本次尚未发布的协调修复候选；候选行为不能作为已经部署的事实。
- 用户明确提供了“老版本学习过 Firstmate”的背景。当前检视的 MISHU 源码与文档未发现 `firstmate` 文本引用；旧 `docs/mishu-next-design.md` 第 8、13、19 行明确引用的是 Rakazo。**本报告证明设计相似性与当前差距，不证明某个机制直接复制自 Firstmate，也不反推历史学习时的 Firstmate 版本。**
- Firstmate 的 README、AGENTS、技能说明用于确认其合同，脚本源码用于确认实现机制。没有执行 Firstmate 的测试或真实舰队操作，不能据此声称其所有运行路径已被独立验证。

## 机制对照

| 机制 | Firstmate 原始证据 | 旧 MISHU 设计与当前 Coffee 的对应 | 判断 |
| --- | --- | --- | --- |
| 统一秘书身份与用户语言 | [AGENTS §1，L7–43](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/AGENTS.md#L7-L43) 定义 Firstmate/captain 角色、轻量航海措辞、工人经秘书汇报；[§9，L308–335](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/AGENTS.md#L308-L335) 要求解释结果与后果，不能原样倾倒内部状态。 | 旧 `docs/legacy-herdr-AGENTS.md:11–19` 的女秘书、中文、“老板”、先理解再安排，已在 Coffee `src/coffee.ts` 的 `personality` 与 `identity` 中恢复为有界临时上下文。 | 角色与固定表达风格已迁移；自然协调行为不能单靠称呼或口吻证明。 |
| 透明的长期记忆 | [AGENTS L60–79](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/AGENTS.md#L60-L79) 将偏好与学习保存在私有 Markdown 并由启动摘要读取；[内部 stow L11–38](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/.agents/skills/stow/SKILL.md#L11-L38) 描述筛选、分层、衰减和归档；[预算源码 L5–12](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-startup-memory-budget-lib.sh#L5-L12) 定义可配置 startup-memory budget，默认 7500。 | 旧 SPEC §6、P2 要求 Role / Memory / Daily Context / Live Directory、按来源预算与不可信标记。旧 `runtime-context.ts`、`role-memory-context.ts`、`daily-context.ts` 尚存，但 Coffee 入口只导入 Pi、Typebox 与 Harness，未组合这些模块。当前根据原生对话中最新偏好调整口吻；没有独立 MEMO 或任务记忆工具。 | 长期记忆与预算化恢复未迁移。原生聊天历史不等于可检查、可编辑、可恢复的秘书记忆。 |
| 投递、处理、回复分开证明 | [fm-task-inbox-lib L2–23](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-task-inbox-lib.sh#L2-L23) 明确信息写入 durable inbox，终端只接收 doorbell；[L25–68](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-task-inbox-lib.sh#L25-L68) 分离记录、处理 ACK、去重、有限重响与升级。 | Coffee Host `src/host/mishu.ts` 先持久化 receipt，再投递原生请求；稳定 message ID 对相同内容去重；结果通过 inbox 读取。没有沿用终端 doorbell，因为已有原生 Adapter 与 Host follow-up queue。 | 正确借鉴可靠性不变量；无需复制终端输入基础设施。receipt 的 accepted、settled 和业务完成应继续明确区分。 |
| 已承诺回复的责任账本 | [fm-pending-reply-lib L2–22](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-pending-reply-lib.sh#L2-L22) 在投递前创建 parent-owned expectation，仅关联回复可关闭；漏报后一次恢复，再升级，禁止无限注入；[L24–78](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-pending-reply-lib.sh#L24-L78) 给出相关 ID 与版本化阶段。 | 旧 SPEC P0 要求 Assignment、Notification Outbox、reload 对账和去重终态通知。当前 Host 保存消息回执，但启动时把未结消息标为 uncertain，不自动恢复或回放；主秘书不会因目标迟到回复而自动唤醒。 | 部分迁移，尚无“秘书承诺必有结案或升级”的完整持久闭环。这是与旧产品感觉不同的重要原因。 |
| 结束一轮前的结构性检查 | [turnend-guard 合同 L30–53](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/docs/turnend-guard.md#L30-L53) 在需要监督却没有健康 watcher 时阻止结束或触发一次有界继续；[源码 L7–18、L50–58](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-turnend-guard.sh#L7-L58) 说明不同 Harness 的边界与防循环预算。 | 本次 Coffee 候选使用 Pi `agent_before_settle` 检查短句“先查/联系”却零 MISHU 工具调用的空承诺，只允许一次继续。该检查基于本轮实际调用数量，不恢复后台监督。 | 同类结构性保护，谓词不同。候选不能被描述为已经迁移 Firstmate 的 watcher guard；文本匹配也不能保证覆盖所有语言或所有漏发情形。 |
| 主动、低噪声监督 | [AGENTS L254–296](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/AGENTS.md#L254-L296) 要求唯一 live supervision cycle、durable wake drain、处理后 ACK、当前状态对账、无变化静默；[VISION L41–46](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/VISION.md#L41-L46) 要求责任与待决定事项跨重启存活。 | 旧 MISHU P0/P4 要求可靠跟进、阻塞/终态通知、status/doctor。Coffee 当前合同明确不加入周期 watcher、自动回复循环或后台轮询，仅在用户要求或完成当前请求时查 inbox。 | 这是明确的首版范围差异，也是旧协调能力未迁移；不能标成全部完成，也不能为接近 Firstmate 而静默新增后台行为。 |
| 授权边界与执行者选择 | [VISION L21–30](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/VISION.md#L21-L30) 规定明确授权、证据不是授权、自治可选且有范围；[fm-send L4–13](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-send.sh#L4-L13) 精确解析目标且拒绝猜测；[AGENTS L202–217](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/AGENTS.md#L202-L217) 分开消息与生命周期控制。 | Coffee setup 明确选择现有目标及模式；Host 以账号 scope、Conversation/native/workspace binding 校验；信息通知不授权代码改动；原生审批留在目标会话。旧 P0-S 还要求双向 Target Attestation、Project Scope 与独立 Authorization Evidence，不能用当前自由文本 authorizationRef 证明已经等价完成。 | 基本边界已保留；强授权证据和原 SPEC 安全验收仍应单列。应继续由 Host 强制 exact identity，不把目标标题当权限。 |
| 临时研究与长期执行者语义 | [VISION L48–54](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/VISION.md#L48-L54)、[AGENTS L180–198](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/AGENTS.md#L180-L198) 分开 ship/scout 与交付合同。 | 旧 P1 定义长期 Agent、临时 Subagent、数量预算、去重与 retry lineage。当前 Coffee 只联系用户选中的既有会话，不创建临时助手；遗留委派代码未进入当前入口。 | 委派治理未迁移。Firstmate 当前并发政策也不等于旧 MISHU 的 3/6 预算，不能照抄数值或政策。 |

## 对本次修复及 SPEC 审计的建议

1. **先验收当前请求的闭环。** 用合成项目中的原生 Pi → 原生目标 Agent，证明自然语言要求确实发送到所选对象、取回对应回复、准确汇报。仅证明 menu、setup、directory 或手写工具调用能运行不够。迟到回复和目标忙碌也应独立记录，不能把 accepted 当成回答。
2. **将固定性格与发展中的记忆分开。** 旧 `CONTEXT.md:23–25` 把 Secretary Personality 定义为经对话发展出的互动方式。当前固定提示只恢复默认表达，后续若需长期记住习惯、项目和约定，应先明确保存、来源、编辑/删除和权限失效规则；不要自动加载历史 MEMO 里的旧授权。
3. **列出尚未迁移的秘书责任。** Managed Task / Task Brief、通知 Outbox、相关回复责任、预算化记忆、activity/doctor 和 Communication Agent 是独立缺口，不应随着消息 bug 的修复一并宣称完成。
4. **不照搬基础设施。** Firstmate 是用户拥有的指令/脚本/状态模板，见 [VISION L56–74](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/VISION.md#L56-L74)；PI Coffee 已有 Browser、Host、原生 Adapter 与账号隔离。可吸收持久责任、明确状态和有界恢复等不变量，终端 pane、shell doorbell、第二套 session lifecycle 不应直接替代现有 Host。
5. **保持审计而非授权扩张。** 后台监督、自动补报、自动恢复、创建助手都超出当前 Coffee 合同。报告应保留这些未完成需求，说明范围差异；此次调查不自动授权启用它们。

## 可复核的本地检查

除脚本头部合同外，实际检查了 [inbox 写入/去重函数 L222–276](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-task-inbox-lib.sh#L222-L276)、[pending reply 原子创建 L311–372](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-pending-reply-lib.sh#L311-L372)、[关联回复解析/结案 L647–715](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-pending-reply-lib.sh#L647-L715)，以及 [turn-end supervision 判定 L192–225](https://github.com/kunchenguid/firstmate/blob/e5b9dddc982e546b81b4bfce754df1465270a59e/bin/fm-turnend-guard.sh#L192-L225)。这些源码对应上述机制，但源码检查不代替崩溃恢复及各原生 Harness 的现场验收。

只读检查包括 Firstmate `git rev-parse HEAD` / `git show -s`、以上文件的行号阅读，以及 MISHU `package.json`、`src/coffee.ts`、遗留 context/runtime 文件、`CONTEXT.md`、下一版 SPEC 与当前 Coffee SPEC 的对照。没有执行上游 Firstmate 脚本，没有改动其仓库，没有在此研究中读取用户会话或运行远程测试。
