> Current-deployment clarification (2026-10-26): The per-user VM and separate central Web placement below is superseded. The authenticated gateway and Host-owned durable-content boundaries remain applicable on the shared VM. See [current topology](../architecture/topology.md). Original decision text is retained as history.

# ADR-0010：统一网页网关，用户 VM 仅提供私网执行与文件服务

- 日期：2026-09-19
- 状态：owner 已接受；文件网关尚待实现／部署验收
- 替代：ADR-0009 中“浏览器必须直连 VM、文件字节不能经过 Web”的强制要求，以及旧 SPEC 排除统一公网入口的部署限制。保留 VM 持久化所有权、LocalSend/TransferServer 复用和无匿名共享访问要求。

## 背景与取舍

当前只有两个可信用户，每人固定一台 VM。直接让每台 VM 提供独立公网网页虽然减少中央路由，但新增用户需要处理多个外部入口／证书，运维不便。owner 希望保留 Arena Agent 式统一网页体验，同时尽量复用 Pi 原生历史、Git/worktree 和现有插件，不重建 Agent 平台。

独立中央 Web 的价值是统一接入与授权，不是执行 Agent 或保存用户内容。现有 Web/Host 分层已可复用，没必要增加“中央 Web → 每 VM Web → Host”的必需中间层。

## 决定

1. 默认部署为浏览器 → 统一 HTTPS Web／网关 → 私网用户 VM Host／文件服务 → Pi。
2. Web 提供静态页面、Gitea 登录、固定用户路由、授权和聊天／文件流式转发；不提供 Agent 执行、Git 引擎、权威聊天数据库或文件归档。
3. VM 保存 Pi 原生历史、认证、项目、worktree、上传、产物及插件状态。Host/Pi 拥有执行生命周期。
4. 浏览器使用同源文件入口；网关复用现有 TransferServer/LocalSend 接口。上传、预览、下载有界流式转发，不在网关或外层反向代理临时落盘正文，不整文件内存缓冲。
5. 每请求检查身份及固定 VM／workspace 归属；目标由服务器受控配置决定，不接受浏览器指定任意代理 URL。VM 继续执行文件授权与实际路径校验。
6. VM Host 和文件端口仅私网开放并限制访问来源。公网只开放统一应用入口；浏览器链路 HTTPS/WSS。明确的内网 HTTP 模式可以保留，但不是公网配置。
7. 新用户通过准备 VM、幂等安装脚本、原生登录和手工增加路由接入。不做自动 VM manager、动态 VM 池、一次性 Enrollment 服务或网页管理后台。
8. Relay 独立可选，集中上游密钥留管理员服务。原生模型不依赖模型 Relay。
9. Web 与 Host 独立生命周期；网关重启不停止已接受任务。不用当前统一 shutdown 的 `all` 进程作为生产连续性保证。
10. 浏览器历史缓存是可丢弃的非权威副本；具体已确认预算／激活／草稿策略见主 SPEC §7.4。不以浏览器缓存为由在网关新增正文存储。

## 后果

- 一个用户入口与外部 TLS 配置；新增 VM 无需逐台开放公网服务。
- 入口承载文件带宽，成为共同访问故障点。入口离线影响查看／控制但不取消 VM 作业；首版不额外开发高可用控制面。
- 需增加文件流代理适配，保留背压、取消、授权失效、Range、下载 MIME／CSP 等语义，不能只代理首页却仍向浏览器返回私网下载 URL。
- 既有直连文件模式可保留为明确标注的旧／诊断模式，不作为统一入口发布的默认前提。
- Gitea OAuth 的浏览器授权地址和回调需部署方保证可达；公开应用不自动公开整个内部 Gitea。
- 不为离线打开网页新增 PWA；网关自身不可达时不承诺新浏览器会话还能启动网页。

## 落地范围与证据边界

复用 WebServer/HostClient/HostServer/TransferServer/Pi adapter；修改受控配置、文件同源 URL 与流式代理、部署脚本／反向代理文档。主 SPEC 与 P0–P5 排期是实现入口。此 ADR 是设计确认，不证明运行代码已改变；真实网络、认证和双 VM 验收由 owner 按后续任务书执行。
