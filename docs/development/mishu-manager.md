# MISHU manager（P1–P9）

本文件说明 pi-coffee-server 中 MISHU“总管”能力的实现、配置与部署。配套插件：`pi-coffee-mishu@0.3.0-manager.2`。

## 两层原则

| 层 | 谁 | 成本 | 做什么 |
|---|---|---|---|
| Tier 1 | Host，确定性代码 | 0 模型 token | 事件看门狗、规则、待办面板、Web 提醒、关键词快捷回复、确认码执行 |
| Tier 2 | 秘书 Chat 的模型 | 仅在用户发来非快捷指令时 | 读取有界摘要（≤1500 字）和待办（≤1200 字），回答复杂问题、派工 |

Watch 从不启动 runtime、不读取对话正文（peek 除外，且只在显式调用时读取有界摘录）、不调用模型。

## 模块

| 文件 | 内容 |
|---|---|
| `src/host/mishu-rules.ts` | `rules.json` 严格解析（未知键报错）、默认规则、模板渲染（去控制字符、限长）、安静时段 |
| `src/host/mishu-journal.ts` | 追加式 JSONL 事件日志：按条数/字节分段轮转，按总数（20000）/保留期（7 天）清理；游标读取返回 `gap`；崩溃时截断的尾行被忽略 |
| `src/host/mishu-watch.ts` | 看门狗：把原生事件归一为 `run.*`/`approval.*`/`queue.depth`/`task.*`；规则命中后开待办、发提醒（冷却、批量、每小时预算、安静时段）；只有一个 unref 定时器（卡住检测与批量） |
| `src/host/mishu-quick.ts` | 关键词分类（精确匹配）、回复模板、编号映射（10 分钟有效）、一次性确认码（2 分钟、5 次错误清空） |
| `src/host/mishu-grants.ts` | Host 签发的执行授权凭证（P8） |
| `src/host/mishu-receipts.ts` | 回执轮转与归档（P9） |
| `src/host/mishu.ts` | 协调器集成：新 runtime 动作、原子授权设置、授权校验、轮转 |
| `src/host/server.ts` | 用户输入→凭证；快捷窗口；`/mishu-todo` 窗口；`mishu_watch` WS 帧；会话变化→队列深度 |

## 数据文件（均在 `<workspace>/.coffee/mishu/`，权限 0600/0700）

| 路径 | 说明 |
|---|---|
| `state.json` | **格式不变**（v2），旧 Host 仍可读取 |
| `state.json` 的 `manager` / `userInstructions` | 与联系人同一事务保存的查看范围、游标、按实际投递 requestId 记录的有界用户指令证据 |
| `rules.json` | 用户规则（可选，见下） |
| `watch/journal/events-<seq>.jsonl` | 事件日志 |
| `watch/panel.json` | 待办面板（最多 50 项） |
| `grant.key` | 32 字节 HMAC 密钥（首次使用时创建） |
| `receipts/receipts-<chat>.jsonl` | 已归档回执（不含发送正文，只含元数据与结果）；`assignments-<chat>.jsonl` 为已归档派工 |

## rules.json

文件不存在时使用默认规则；文件无效时**回退到默认规则**并在待办里显示“规则文件无效”。修改后在下次 Watch 启动（Host 重启）时生效。

```json
{
  "version": 1,
  "scope": { "watch": "all", "exclude": ["<不想被看的对话 ID>"] },
  "quietHours": { "from": "23:00", "to": "08:00", "allow": ["approval.opened"] },
  "quick": { "enabled": true, "maxLength": 12 },
  "limits": { "webPerHour": 60, "wechatPerHour": 20 },
  "rules": [
    { "id": "stuck", "on": ["run.stuck"], "when": { "noProgressMin": 30 },
      "panel": { "kind": "stuck", "priority": 2 },
      "notify": { "channels": ["web"], "template": "{title} 已 {minutes} 分钟没有进展 {link}", "cooldownMin": 30 } },
    { "id": "stuck-long", "on": ["run.stuck"], "when": { "noProgressMin": 120 },
      "panel": { "kind": "stuck", "priority": 1 },
      "notify": { "channels": ["web"], "template": "{title} 已卡住 {minutes} 分钟，请看看" } },
    { "id": "codex-error", "on": ["run.errored"], "when": { "engine": ["codex"] },
      "panel": { "kind": "error", "priority": 1 },
      "notify": { "channels": ["web"], "template": "Codex：{title} 出错：{error}" } },
    { "id": "done", "enabled": false }
  ]
}
```

- 同 `id` 覆盖默认规则；`{"id":"done","enabled":false}` 关闭默认规则；最多 50 条。
- 默认规则 id：`approval`、`error`、`interrupted`、`stuck`（20 分钟）、`done`（60 秒批量）、`truncated`、`backlog`（排队≥3）、`verify`（派工结束待验收）、`tracking`。
- 事件：`run.started|run.completed|run.errored|run.interrupted|run.stuck|approval.opened|approval.closed|queue.depth|task.truncated|task.settled|tracking.error`。
- `when`：`state`、`engine`、`conv`、`noProgressMin`（5–1440，`run.stuck` 必填）、`queuedAtLeast`（1–100）。
- `panel.kind`：`approval|error|stuck|completed|truncated|backlog|verify|tracking_error`；`priority` 1–5；`autoExpireMin`。
- `notify.channels`：`web`（Web 弹出提示）；`wechat` 目前没有 Host 通道，只计入 `stats.wechatUndelivered`（P10 再接）。
- 模板字段：`{title} {approvalTitle} {error} {minutes} {link} {count} {state}`；渲染结果单行、≤300 字。
- `escalate: {"mode":"report"}` 只在待办项上做标记，**不会自动唤醒模型**。
- `quietHours` 使用 Host 进程的本地时区。

## 新 runtime 动作（插件 → Host，均 version 1）

见插件 `docs/integration.md` 的 Manager 一节。要点：

- `overview`：未开启“查看全部”时只含已配置联系对象；开启后含全部（秘书自身除外），但 `contactable` 仍只对联系对象为 true。
- `events`：未开启“查看全部”时只返回联系对象的事件；`gap:true` 表示游标早于保留的日志。
- `peek`：≤10 条、每条 ≤600 字、合计 ≤6000 字，仅 user/assistant，`untrusted:true`；读取持久显示索引，不启动 runtime。
- `panel`：模型只能 `list`；`ack/snooze` 只能在用户亲自运行的 `/mishu-todo` 命令期间调用。
- `queue`：`list` 需要联系对象或“查看全部”；`cancel/move` 需要联系对象、`allowInstructions` 与授权原话。新增队列动作 `move`（`to: front|back`），不会越过结果不确定的行，Host 通知行不可移动。
- `quick`：只接受与当前 Web 直接 prompt 完全相同的文本，一次有效；模型无法调用。

## 执行授权（P8）

- Host 在 Session 实际投递秘书直接用户输入（非斜杠命令）时签发凭证：`grantId = HMAC(grant.key, [chatId, requestId, sha256(text)])`。steer 追加到当前请求的凭证；follow_up 只有真正投递时才以最终编辑后的文本签发；被取消或拒绝的排队输入不能成为历史授权依据。
- 凭证仅在 `HostSession.currentRequestId === grant.requestId` 时有效；运行结束（settled/cancelled/uncertain）即失效；最多 3 次不同执行（同一动作重试幂等）；6 小时上限；取消选择/关闭/归档时撤销。
- 执行请求（`send` authorized-execution、`tasks/dispatch` v2、`queue` cancel/move）必须带 `authorization.quote`，且规范化后是当前或已保存同事项先前用户指令的子串（最多保存 200 条、每条 4000 字符；当前前台许可仍必要，显式 retryOf 必须用本轮指令）。保存的 `authorizationRef` 为 `用户原话「quote」`。
- 只带 v1 `authorizationRef` 的请求会被拒绝，除非设置 `PI_COFFEE_MISHU_LEGACY_AUTHORIZATION=1`（过渡期给旧插件用）；即使如此也必须存在当前凭证。
- 已存在的派工（同一 fingerprint）幂等重放不需要凭证，因此重启后的重放仍然可用。

## 回执轮转（P9）

`state.json` 中每个秘书的 `messages` 达到 500 条时，把最早的终态回执（settled/cancelled/uncertain，且不被当前任务派工引用、不在投递中）归档到 `receipts/receipts-<chat>.jsonl`，保留 400 条。先归档、后缩减 state。回执正文按最多 20000 条/30 天保留，独立 `receipts/identities.sqlite` 永久保存最小去重身份，保证同一 `messageId` 不会因正文过期重新投递：相同内容返回 `{archived:true}`，不同内容返回 409。派工记录同理（保留每个任务的最新一条）。state.json 校验上限（1000）不变。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PI_COFFEE_MISHU_LEGACY_AUTHORIZATION` | 未设置 | 设为 `1` 时允许旧插件的 v1 `authorizationRef`（仍需当前凭证）。升级插件后不要设置 |

## WS 帧

新增 Server→Client 帧 `{v:1,type:"mishu_watch",panel?,notice?}`，只发给该用户的连接。旧前端会忽略未知类型；新前端把 `notice.text` 显示为提示（toast）。

## 部署顺序

1. 在 Gitea 发布插件 `pi-coffee-mishu-0.3.0-manager.2.tgz`（release tag `v0.3.0-manager.2`）。必须上传与 lock 中 integrity 一致的那个 tgz，否则重新执行 `npm install` 刷新 lock。
2. 服务器升级：`npm ci && npm run build`。
3. 重启 Host。首次启动时 Watch 从当前状态开始（不回放历史），`grant.key` 自动生成。
4. 每个秘书 Chat 重新运行一次 `/mishu-setup`（可选）以选择“查看所有对话概况”。

## manager.2 审核修复

参考 [修复与验收记录](mishu-manager-repairs.md)。查看全部授权与联系人同存 state.json；旧 Host 拒绝不认识的字段，不能通过旧授权备份回退。旧 manager.1 的 manager.json 不作为新版本授权来源。

停止确认绑定实际运行 requestId，取消确认绑定队列 ID/修订及授权代际。重新设置或撤销会使旧确认失效。journal 断尾封存到旧段，后续事件写新段；摘要每次最多扫描 500 条，游标只推进到实际扫描位置。已排除对话不生成期限告警。

本次工作只修复、验证和合并源码；以下部署顺序是运维参考，不是本次授权的服务操作。
