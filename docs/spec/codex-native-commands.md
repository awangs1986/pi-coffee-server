# Codex slash commands in the Web workbench

Accepted 2026-10-20: Web adaptation, not an embedded terminal. Preserve fixed task directories, independent clones, account-scoped task data and shared native login management.

Source inventory: [Codex rust-v0.163.0 slash_command.rs](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tui/src/slash_command.rs). The 64-name inventory below includes debug/platform-gated commands so typed invocations cannot silently become model prompts. It does **not** claim all terminal functionality is available through App Server.

## Contract

- Native commands have precedence over matching Skill names; Skills remain explicitly invocable via their native dollar-name syntax. Pi command handling is unchanged.
- Recognized commands are routed before normal prompt delivery. Unknown or unavailable slash commands retain the draft and show a reason. Attachments are not silently sent with command operations.
- Engine-neutral command frames accept only a name and bounded argument string. Host selects the authenticated socket's open Session; client-supplied native thread IDs and arbitrary RPC methods are never accepted. Results are request/selection/account fenced and bounded to 64 KiB. No automatic mutation retry after timeout or reconnect.
- Goals use native thread/goal/get, set and clear with explicit user provenance. Pause and resume modify native goal status; objectives are limited to 4000 characters. No client-created background thread or synthetic prompt implements a goal.
- Plan mode uses native turn collaborationMode, persists with model preferences across restart, and can be set on/off or inspected with status. Inline /plan text starts one planning turn. Changes require an idle task. This is separate from the model's reasoning effort.
- Review uses native review/start with inline delivery on the current thread: no argument reviews uncommitted changes, an argument supplies custom review instructions. No detached review thread is created. Work only.
- Init is an explicit repository-guidance generation turn; it reads and preserves existing AGENTS.md rules. Recap is a Web-adapted summary turn in the same conversation, not the terminal's ephemeral recap workflow and not compaction. Neither runs without explicit user submission.
- Complete Markdown export reads all user/assistant history, not the recent display window. Export requires an idle open Codex task, validates account/archival/native binding before and after reading, and is limited to two simultaneous exports and 32 MiB output. Web transport allows 120 seconds. Original history remains unchanged.
- Apps, plugins, MCP and hooks provide bounded viewing; shared installation, authentication and configuration changes remain outside these native command forms. Hook shell commands/config secrets are not returned. Native feature errors are reported honestly.
- Web mappings retain existing confirmations/lifecycle checks. Clear/new create a draft and preserve old history; quit/exit leave the view without killing tasks. Copy copies the currently displayed last reply and is not a complete-history export. Mention opens the task file panel. Resume opens the owned conversation search. Terminal settings, shared-login mutations and operations conflicting with task isolation remain unavailable with specific reasons.

## Inventory

| Command | Route | Behavior / limit |
| --- | --- | --- |
| /recap | turn | 在当前对话生成回顾（网页适配，不压缩历史） |
| /review | turn | 原生审查当前改动；可附加审查要求 |
| /init | turn | 生成或更新项目 AGENTS.md |
| /export | web | 下载完整对话 Markdown（用户与 Agent 正文） |
| /model | web | 选择模型和思考强度 |
| /skills | web | 管理共享或项目 Skills |
| /rename | web | 重命名当前对话 |
| /new | web | 新建对话 |
| /archive | web | 归档当前任务 |
| /resume | web | 查找已有对话 |
| /fork | web | 打开 Fork 选择 |
| /compact | web | 原生上下文压缩 |
| /copy | web | 复制最近的回答 |
| /diff | web | 查看文件差异 |
| /mention | web | 查看当前任务文件 |
| /status | web | 查看上下文与运行状态 |
| /config | web | 打开当前 Agent 设置 |
| /clear | web | 开始新对话（保留旧记录） |
| /quit | web | 离开当前对话（任务继续） |
| /exit | web | 离开当前对话（任务继续） |
| /plan | native | 切换原生 Plan mode；支持 on/off/status |
| /goal | native | 查看或设置目标；支持 edit/pause/resume/clear |
| /pwd | native | 显示当前任务目录 |
| /mcp | native | 列出当前会话 MCP 服务与工具 |
| /hooks | native | 查看当前目录的生命周期 Hooks |
| /apps | native | 查看可用 Apps |
| /plugins | native | 查看插件目录 |
| /usage | native | 查看共享原生账号用量限制 |
| /daybreak | unavailable | 暂不可用：当前 Web 没有 Daybreak 控制接口。 |
| /ide | unavailable | 暂不可用：网页没有连接本机 IDE；请使用附件或文件面板。 |
| /permissions | unavailable | 暂不可用：本部署固定使用无限制权限；权限变更由管理员配置。 |
| /keymap | unavailable | 暂不可用：终端按键设置仅适用于 Codex TUI。 |
| /vim | unavailable | 暂不可用：Vim 输入模式仅适用于 Codex TUI。 |
| /setup-default-sandbox | unavailable | 暂不可用：此 Linux VM 不使用 Windows elevated sandbox。 |
| /experimental | unavailable | 暂不可用：实验功能影响共享原生配置，需由管理员统一配置。 |
| /approve | unavailable | 暂不可用：当前适配器尚未实现原生 Guardian 重试确认。 |
| /memories | unavailable | 暂不可用：原生记忆配置影响共享账号，需由管理员统一配置。 |
| /import | unavailable | 暂不可用：导入可能创建多个原生会话；请使用经过账号隔离的导入流程。 |
| /delete | unavailable | 暂不可用：永久清理必须走已归档任务的管理流程。 |
| /worktree | unavailable | 暂不可用：本系统固定使用每任务独立 clone，不创建 worktree。 |
| /app | unavailable | 暂不可用：当前 Linux Host 没有桌面 App 交接目标。 |
| /voice | unavailable | 暂不可用：原生语音传输尚未接入 Web。 |
| /agents | unavailable | 暂不可用：原生 agent command center 尚未接入 Web。 |
| /side | unavailable | 暂不可用：临时侧会话会创建额外原生会话；请使用显式 Fork。 |
| /btw | unavailable | 暂不可用：临时侧会话会创建额外原生会话；请使用显式 Fork。 |
| /raw | unavailable | 暂不可用：终端原始滚动模式仅适用于 Codex TUI。 |
| /tui | unavailable | 暂不可用：终端显示模式仅适用于 Codex TUI。 |
| /daemon | unavailable | 暂不可用：原生后台服务由 Host 管理。 |
| /warnings | unavailable | 暂不可用：完整原生诊断面板尚未接入；当前错误会在网页显示。 |
| /cd | unavailable | 暂不可用：任务目录固定，不能跨目录切换；请新建或切换任务。 |
| /debug-config | unavailable | 暂不可用：配置调试可能包含共享敏感设置，仅供管理员在 VM 检查。 |
| /title | unavailable | 暂不可用：终端标题配置不适用于网页。 |
| /statusline | unavailable | 暂不可用：终端状态栏配置不适用于网页。 |
| /theme | unavailable | 暂不可用：终端主题不适用于网页。 |
| /pets | unavailable | 暂不可用：终端宠物不适用于网页。 |
| /logout | unavailable | 暂不可用：Codex 登录由两人共享；退出登录须由管理员在 VM 执行。 |
| /feedback | unavailable | 暂不可用：上传诊断日志需要单独审核，网页没有自动上传入口。 |
| /rollout | unavailable | 暂不可用：原生 rollout 是 Host 内部资料；不能将文件路径作为下载授权。 |
| /ps | unavailable | 暂不可用：原生后台终端列表尚未接入。 |
| /stop | unavailable | 暂不可用：不能把停止后台终端误映射为停止当前模型；原生终端管理尚未接入。 |
| /test-approval | unavailable | 暂不可用：原生调试命令不在生产网页开放。 |
| /subagents | unavailable | 暂不可用：原生子代理切换尚未接入；不会自动创建新会话。 |
| /debug-m-drop | unavailable | 暂不可用：原生内部调试命令不开放。 |
| /debug-m-update | unavailable | 暂不可用：原生内部调试命令不开放。 |

Aliases: cwd → pwd; pet → pets; clean → stop.

## Acceptance

Browser-controller and Chromium probes must prove command-vs-prompt separation, unsupported draft retention, download behavior and delayed-response fencing. Native fixture tests prove goal provenance, no goal-triggered turn/start, inline review and persisted native Plan mode. Public authenticated HTTP/WS tests prove same-ID cross-account isolation, complete-history export and anonymous/archived rejection. No real model turns or bulk session creation are required. Publication and production activation are separate acceptance states.
