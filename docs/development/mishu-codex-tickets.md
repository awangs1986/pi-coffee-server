# Codex 主秘书：to-tickets 拆分草稿

状态：2026-10-07 用户确认采用七票拆分；已发布父项 [#84](https://github.com/awangs1986/pi-coffee-server/issues/84) 及 #85–#91，并建立原生子任务/阻塞关系。仅任务发布，未实现/未部署。
契约：[Codex 主秘书目标规格与 C01–C12](../spec/mishu-codex-secretary.md)。
Tracker：GitHub `awangs1986/pi-coffee-server`，任务已使用 `enhancement` / `ready-for-agent`。
不修改或关闭 #64，不把已存在 PR #78/插件 PR #4 自动合并，不启动实现或部署。

## 实施顺序

| 草稿 | 完整可演示切片 | 真正阻塞 |
| --- | --- | --- |
| [#85](https://github.com/awangs1986/pi-coffee-server/issues/85) | 验证 Codex 秘书源能力并展示可用性 | 无 |
| [#86](https://github.com/awangs1986/pi-coffee-server/issues/86) | 在 Codex Work 启用 MISHU 并完成真实信息联系 | 1 |
| [#87](https://github.com/awangs1986/pi-coffee-server/issues/87) | 从 Codex 秘书登记并跟踪真实目标运行 | 2 |
| [#88](https://github.com/awangs1986/pi-coffee-server/issues/88) | 让 Codex 安全汇报并恢复同一原生输出 | 3 |
| [#89](https://github.com/awangs1986/pi-coffee-server/issues/89) | 把延迟结果可靠地送回空闲 Codex 秘书 | 4 |
| [#90](https://github.com/awangs1986/pi-coffee-server/issues/90) | 让 Codex 秘书按明确授权派工且如实展示目标限制 | 3 |
| [#91](https://github.com/awangs1986/pi-coffee-server/issues/91) | 完成 Codex 秘书生命周期及安装版本闭环验收 | 5, 6 |

第3票另外需要集成并验证 #64 的持久跟踪候选（Server PR #78；Pi 回归的插件 PR #4）。
第1票的协调能力与汇报安全/恢复能力分别判定：它即使完成“安全汇报不可用”的诊断，
也不能解除第4票的硬能力门槛。第2、3、6票人工协调不依赖主动汇报，仍可独立交付。
若安装版本无法支持无工具汇报，后续第4、5、7票报告相关范围保持受阻，并保留目标验收。
不以删除 unmet criteria 来宣称完成。

## 各票行为与验收

### 01. 验证 Codex 秘书源能力并展示可用性

在生产 Codex 接入上验证源能力，用户能从网页看见每项支持或不可用原因；不支持的操作被公共接口拒绝，不启动替代 Pi 或新线程。

验收映射：C01、C06（能力门槛）、C12。

- [ ] 用安装版本生成的原生 schema 验证动态工具、当前 thread/turn 关联和角色上下文安全更新；说明 experimental API opt-in 与既有线程恢复限制。
- [ ] 分别公布人工协调、原生无工具摘要和同原生输出恢复能力，不以一个总开关掩盖缺口；unsupported/unknown 通过网页及 HTTP/WS 显示。
- [ ] 证明汇报全工具阻断的可行路径，覆盖内置读工具/shell/MCP/Apps/网络/委派；只读 sandbox 或 never 审批不能充当证据。做不到则明确 unavailable，后续汇报票保持受能力阻塞。
- [ ] 提供可演示的真实原生握手/无副作用隔离试验和错误版本 fixture；不读取 token，不为验证升级运行时，不扰动普通 Codex Work/Pi Chat。

### 02. 在 Codex Work 启用 MISHU 并完成真实信息联系

用户在已有 Codex Work 勾选 MISHU、完成配置后，她认识自己的身份并实际向已有 Pi/Codex 对话询问、展示有来源的回执。

验收映射：C01–C03、C09。

- [ ] 通过咖啡菜单选择身份，未授权/失联/能力不足状态准确；暖心可靠的性格遵从用户称呼与语气，普通问候不反复说明协议。
- [ ] Host/Browser 的设置按钮与 /mishu-setup 等效；支持移动布局滚动、取消、最近72小时目录、20对象上限和有效旧对象增量保留。模型不能配置授权。
- [ ] 在原生工具/绑定已验证的当前线程执行人工信息联系，保留用户原生说明并有界刷新上下文；取消选择后包括持久原生动态工具在内的调用均被 Host 拒绝。
- [ ] 真实网页分别完成 Codex→Pi 和 Codex→Codex 信息询问，不能用 idle/空收件箱/口头宣布冒充联系；切换重开与目标忙碌排队可用。
- [ ] 每个公共入口校验账号、源/目标绑定及授权修订；无 Pi 运行依赖，未勾选的 Codex Work 与 Pi Chat 行为不变。

### 03. 从 Codex 秘书登记并跟踪真实目标运行

用户用一次明确指令登记、纠正或停止任务跟踪；目标在自己的窗口直接启动工作也能关联，主秘书仍能继续聊天。

验收映射：C04–C05、C09、C11。

- [ ] 以 Host admission 与原生 thread/turn 关联证明真实用户输入；任意工具 userMessageId、旧 turn、通知、目标回复和项目文本都不能伪造授权。
- [ ] 复用持久 Task Brief/回信责任与 revision 幂等规则；纠正和停止跟踪不终止目标工作，简单同事项追问不要求反复确认。
- [ ] 登记前事件、登记竞争、多个目标与后续无关 run 按 exact run/watermark 匹配；waiting-user、原生失败/终态与业务完成分别展示。
- [ ] 网页任务入口展示有来源状态和不确定结果，Browser 断开/Host 重启保留责任，不从 display cache 推断完成或重派工。
- [ ] 公共 HTTP/WS 验证跨账号/跨秘书伪造及晚到事件；真实 Codex 秘书观察 Pi 与 Codex 目标，分别记录目标被动恢复边界。

### 04. 让 Codex 安全汇报并恢复同一原生输出

用户请求汇报后，在同一 Codex 秘书看到基于已记录事实的无工具摘要；原生保存后 ACK 丢失仍恢复原输出，不再调用模型。

验收映射：C06–C07、C09。

- [ ] 开工除第3票外还须第1票证明安装版本的全工具禁用与持久输出恢复；任一未满足时保持能力 unavailable，不伪装完成该票。
- [ ] Host 先持久化报告意图和来源窗口；可信 report-only 原生 run 不继承用户执行权限，不接受目标文本/模型自报的授权。
- [ ] 执行前阻断所有内置工具、MCP/Apps、网络、动态工具、委派和协调写操作；恶意报告在实际原生路径无法执行，下一用户 run 权限不被污染。
- [ ] 仅匹配 thread/turn/output item/hash/generation 的已持久终态输出可以提交与 ACK；commentary、取消、错误均不确认已汇报。
- [ ] 故障注入覆盖输出保存后 ACK 丢失、Host 重启、展示缓存删除、Browser 重连：恢复同原生输出而非重新生成；未知保持 uncertain、未完成责任可诊断。

### 05. 把延迟结果可靠地送回空闲 Codex 秘书

用户独立开启提醒后，即使离开网页或当前秘书 turn 已结束，也会收到一次延迟结果摘要；忙碌时公平排队。

验收映射：C08–C09、C11。

- [ ] 提醒默认关闭，只有用户入口可开启/停止；能力不足显示 unavailable，人工查询仍可用。
- [ ] 复用 Host 持久 Outbox、事件合并、逐秘书公平性、预算和容量诊断；不新增高频轮询，不抢占或 steer 到活跃用户 turn/原生问答。
- [ ] 真实网页看到 Codex→Pi 和 Codex→Codex 已观察目标延迟结果自动摘要，不需要追加用户 prompt；关闭网页后重开也能看到。
- [ ] Host 无 Browser/API priming 重启可发现保存 scope；提醒关闭、撤权、归档与 admission/开始/ACK 竞争时旧 worker 无权发布或消耗责任。
- [ ] 多账号/多秘书繁忙负载和额度溢出行为可见；无重复汇报、无限唤醒或目标工作中断。

### 06. 让 Codex 秘书按明确授权派工且如实展示目标限制

用户直接说“把这个问题交给项目A修复”即可向支持的已配置目标派工；同事项跟进沿用授权，不为普通步骤反复确认。

验收映射：C04、C09、C11。

- [ ] 派工同时校验设置中的执行权限、真实当前用户指令、精确目标/事项和绑定；仅歧义、新范围或危险判断提出必要澄清。
- [ ] 复用业务操作幂等、持久 dispatch/回信责任和原生关联；改消息ID、断连或未知恢复不重投递，同一用户以后再次明确要求则可成为新事项。
- [ ] 按照目标已经验证的持久 dispatch 能力开放，当前 Pi 保证不得移植成 Codex/Claude/Cursor/Grok 的虚假保证；不支持时明确拒绝/说明现有信息桥边界。
- [ ] 原生权限仍由目标用户决定，秘书不得代答；目标回执、失败、等待用户、不确定恢复都在任务入口如实显示。
- [ ] 通过真实 Codex→Pi 授权派工与 public HTTP/WS 的越权、撤权、未知结果测试；为五种目标分别记录信息/观察/恢复/dispatch能力。

### 07. 完成 Codex 秘书生命周期及安装版本闭环验收

用户可以安全停止、更换或恢复秘书；最终在真实网页验证整条协调闭环，并分别记录源码、安装包和生产状态。

验收映射：C01–C12。

- [ ] 清空、Fork、takeover、新绑定不继承源授权或未提交汇报；原生恢复失败不换替代线程，明确 note-only 历史恢复不派工。
- [ ] 同绑定模型切换重新检查能力；源/目标归档、取消选择、Host 重启和旧 worker 的 generation 栅栏在 HTTP/WS 与真实网页验证。
- [ ] 真实已安装 Codex 无 Pi 依赖走完 C01–C12，包含 Codex→Pi 与 Codex→Codex；不能用 fixture 或单次模型回答替代网页、工具隔离和原输出恢复验收。
- [ ] 现有 Pi 秘书和普通五种 Work/Chat 回归通过；涉及独立插件的新包不可变，不覆盖既有 tracking.2。
- [ ] 保存对应 source/artifact/runtime 身份、完整检查和 fresh-clone 证据；生产部署仅在另行授权后进行，未部署明确标未激活。
