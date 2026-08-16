# DeepSeek Harness — 前端与功能适配审计报告

审计日期：2026-08-16 ｜ 审计对象：v0.3.0（commit `31b2b2b`）
审计范围：`src/`（React 渲染层）、`electron/`（主进程 + preload + RPC 策略）、`server/`（协议适配层）、对照 `work/codex-app-server-types/` 的 codex app-server 协议覆盖率。
补充文档：Host 侧（Harness RPC）功能对等性见既有 [HOST_CAPABILITY_AUDIT.md](./HOST_CAPABILITY_AUDIT.md)（2026-08-15），本报告聚焦前端代码质量与 Codex/Antigravity 适配，二者互补。

## 验证基线

- `tsc --noEmit`：通过，零类型错误。
- `vitest run`：**39 个测试文件 / 120 个用例全部通过**（1.99s）。
- preload 契约：`src/lib/api.ts` 及组件调用的 40+ 个 bridge 方法在 `electron/preload.ts` 全部存在且主进程均有 handler，无缺失、无死代码。
- 主题声明成立：`styles.css` 全部颜色经脚本验证为纯灰阶（R=G=B），符合"只用黑白灰"的设计约束。

## 总体结论

代码工程质量高于一般的 AI 生成项目：spawn 全部使用 argv 数组、标识符有正则校验、敏感文件原子写入且权限 `0o600`、渲染进程 `sandbox + contextIsolation`、CSP 严格、Markdown 无 `rehype-raw`、billing key 真正 write-only（safeStorage 加密、不过 IPC、不入日志）。**未发现 P0（无远程代码执行、凭证泄漏或注入原语）。**

三个结构性弱点：

1. **主进程 RPC payload 策略只覆盖约 13/43 个白名单方法**，其余方法（含敏感的 `host.openPath`）不校验 payload 形状；`settings.update` 的命名空间收窄与自身注释矛盾，实际可写任意命名空间。
2. **前端是 3908 行的巨石 `App.tsx`**（约 75 个 `useState`、20+ `useEffect`），codex/antigravity 会话状态同时存于 React state、localStorage 和 ref 三处，靠手工同步，是竞态与多窗口缺陷的温床。
3. **codex app-server 协议覆盖率仅约 15%**（客户端方法 12/98，通知 9/72），是一个合格的 v2 时代最小聊天客户端，但 diff 视图、上下文压缩、模糊文件搜索、多模态输入、代码评审等工作台级能力全部未适配。

---

## 一、前端审计（src/）

### 架构评价

组件拆分合理（Conversation / Composer / Inspector / AgentRoom 等），纯逻辑下沉到 `lib/` 且核心模块有测试（history 225 行投影、codex-stream、provider-handoff、agent-room 规范化）。主要债务是 `App.tsx` 的编排逻辑过重与重复状态源。

### P1 — 高优先级

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| F1 | `App.tsx:1119,1194,1231,…1961,2043,2628` 等约 30 处 | **i18n 断裂**：`setActionError` 全部硬编码中文模板，未走 `tr()`；英文 locale 用户看到中文报错。反向问题同样存在：Composer/CommandPalette/Conversation/SidechatPanel/OnboardingWizard 几乎纯英文硬编码 | 错误模板统一改 `tr(en, zh)`；建立文案表并用 lint 强制 |
| F2 | `App.tsx:2573-2627` | **发送失败路径可能重复投递**：`harnessApi.prompt()` 成功后仍有 localStorage 写入等语句（可抛 QuotaExceededError），任一抛错都进 catch 恢复草稿，用户以为未发送而重发 → Host 端重复消息 | prompt 成功即标记 `delivered=true`，仅 `!delivered` 时恢复草稿 |
| F3 | `App.tsx:189-247, 480-490, 564-573` | **三重状态源无单一事实点**：codex/antigravity 会话同时存于 state + localStorage + ref，手工成对同步（已有遗漏点）；多窗口下 localStorage 互相覆盖且无 `storage` 事件同步 | 抽 `useProviderSession(sessionId)` hook 收口；多窗口用 `storage` 事件或 BroadcastChannel |

### P2 — 中低优先级（精选）

| # | 位置 | 问题 |
|---|---|---|
| F4 | `index.html:8` vs `App.tsx:1993`, `Composer.tsx:130` | CSP `img-src` 缺 `blob:`，可能阻断附件缩略图预览（打包后实测确认） |
| F5 | `App.tsx:3365-3403` | 全局快捷键 effect 无依赖数组，每次渲染注销重挂监听；`event.key === ','` 对部分输入法/布局脆弱 |
| F6 | `AgentRoom.tsx:347-350, 397-400` | 每轮 `Promise.race` 遗留 10 分钟 `setTimeout` 不释放，长跑审计累积定时器 |
| F7 | `App.tsx:3420-3446, 584` | AgentRoom 指令扫描对每个流式 delta 全量倒扫 O(n)；`handledAgentRoomDirectives` Set 无限增长 |
| F8 | `App.tsx:675-682, 586-591` | 渲染期副作用：渲染体内读写 ref、`useMemo` 内写 localStorage |
| F9 | `App.tsx:431-434` | `effectiveNetworkMode` 在 async 发送链路中间弹同步 `window.confirm`，AgentRoom 自动回注也会触发 |
| F10 | `App.tsx:2144-2151 vs 2249-2254` | Sidechat 乐观消息失败后不从流里移除（codex 路径有 `filter` 回收，行为不一致） |
| F11 | `Inspector.tsx:195-197` | 审批队列只渲染首条；首条若因 `approval/resolved` 帧丢失将永久卡死入口，无跳过/刷新出口 |
| F12 | `App.tsx:1226-1232, 1255-1259` | `readThread` 竞态：then 分支校验了当前选中会话，catch 分支未校验（不一致），快速切换会错位提示 |
| F13 | `App.tsx:1717-1852` | downlink effect 重建时丢弃未 flush 的 live entries，只能靠 repair 轮询弥补 |
| F14 | `TerminalDock.tsx:58-76, 122` | 关闭 dock 不停子进程；`void terminalApi.stop()` 未捕获拒绝 |
| F15 | `ModelsCredentialsSettings.tsx:119` | billing key 同步失败被静默吞掉，用户误以为已同步 |
| F16 | `lib/api.ts:170-177` | `exportSession` 点击后立即 `revokeObjectURL`，部分浏览器中断下载 |
| F17 | 测试缺口 | `lib/api.ts` 的 WebSocket 重连退避（545-627）、AgentRoom 三阶段编排、App.tsx 队列 drain 均无测试；`HarnessSettings.test.ts`（9 行）等仅覆盖小 helper |

---

## 二、主进程与协议适配层审计（electron/ + server/）

### P1 — 高优先级

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| M1 | `rpc-policy.ts:61-217` + `main.ts:52-102` | **payload 策略只覆盖 ~13/43 个白名单方法**；`session.prompt`、`workspace.create`、`host.openPath`（可让 Host 打开任意路径）等约 30 个方法接受任意形状任意大小的 payload | 每个白名单方法配 schema（精确键、类型、大小上限），默认拒绝未知键 |
| M2 | `rpc-policy.ts:56-119` | **`settings.update` 收窄与注释矛盾**：仅当 `ns === 'agent-presets'` 时才限制字段，其他任意 `[a-z0-9-]` 命名空间接受 ≤1MB 任意 patch——被攻破的渲染进程可改写 LLM base URL、代理等任意 Host 设置 | 显式白名单可写命名空间 + 每命名空间 patch schema |
| M3 | `codex-app-server.ts:566-576` | **Codex 进程崩溃后 UI 永久"运行中"**：已返回 `turnId` 的 turn 只通过通知完成，崩溃后无 `turn-completed`，渲染层 spinner 挂死到重载 | `handleExit` 中为活跃 `(threadId, turnId)` 补发合成 `turn-completed{status:'failed'}`；可选自动重启一次 |
| M4 | `codex-app-server.ts:419-433`, `antigravity-cli.ts:293-307` | **stdout 缓冲无上限**：单行超大消息（大 diff）或异常子进程无限增长内存 | 缓冲上限 8–16MB，超限 kill 子进程并 fail 该 turn |
| M5 | `main.ts:980-1005` | **终端命令不做 workspace 归属校验**：`canonicalTerminalDirectory` 接受任意绝对路径，且子进程继承完整 `process.env`（含 `DEEPSEEK_API_KEY`）。渲染进程被攻破 = 即刻获得任意目录的用户 shell | 默认 cwd 限定 Host 工作区集合；子进程环境剔除 billing 密钥 |

### P2 — 中低优先级（精选）

| # | 位置 | 问题 |
|---|---|---|
| M6 | `main.ts:1148-1152` | codex/antigravity 审批事件广播给所有窗口，任何窗口可对任意 pending id 响应——跨窗口错会话审批 |
| M7 | `codex-app-server.ts:498-564`, `antigravity-cli.ts:309-333` | 未知协议消息静默丢弃（无 else 分支、无日志计数），协议演进时 UI 静默退化 |
| M8 | `main.ts:146-177, 416`, `plugin-control.ts:260` | 所有 loopback HTTP 调用无超时，Host 挂起则 IPC 与 UI 永久等待 |
| M9 | `antigravity-cli.ts:115-117, 261-267`, `codex-app-server.ts:316` | 仅 SIGTERM 无 SIGKILL 升级；`AntigravityCli.shutdown()` 立即清空 `activeByTurn` 导致 turn promise 永不了结 |
| M10 | `codex-app-server.ts:330-363` | `initialize` 失败后残留半初始化进程，下次 `ensureStarted()` 误认成功 |
| M11 | `rpc-policy.ts:37-41` | `settings.mutate` 路径段未排除 `__proto__`/`constructor`，原型链污染风险取决于 Host 合并逻辑 |
| M12 | `deepseek-billing.ts:142-164` | 凭证迁移仅 rename 无 EXDEV 回退；`migrationAttempted` 在尝试前置位，瞬时失败不重试；未做 regular-file 检查 |
| M13 | `codex-launch.ts:18-21` | 子进程整体继承父 `process.env`，`DEEPSEEK_API_KEY` 等密钥扩散到 codex/agy/host 全部子进程 |
| M14 | `codex-permissions.ts:13-45`, `antigravity-protocol.ts:54-58` | "Network Off" 并非强制：codex 沙箱恒 `networkAccess: true`（只关 web_search 工具），antigravity 纯靠提示词指令。UI 若表述为保证则有误导性（README 已如实说明为 model-facing，建议 UI 内同样措辞） |
| M15 | `main.ts:1066-1068`, `263-270` | `will-navigate` 用 `startsWith(APP_ORIGIN)` 前缀判断不严谨；`safeAssetPath` 的 `decodeURIComponent` 异常未捕获 |
| M16 | `main.ts:939-962` | Review 写文件 hash 校验 + rename 之间存在小的 TOCTOU 窗口；rename 丢失原 ACL/xattr |
| M17 | `antigravity-cli.ts:313-315, 467-486` | 信任子进程提供的 `conversation_id` 作为 map/持久化键无格式校验；持久化失败与状态文件损坏均静默 |
| M18 | `plugin-control.ts:49-66, 328-330` | 插件保护用黑名单（遗漏即误锁/误开），备份文件无限累积 |
| M19 | `main.ts:116-119` | 字体直接读自 `/Applications/Claude.app` 的 Anthropic 字体文件——未安装则静默回退，且存在第三方字体再分发授权风险 |

### 已验证的良好实践（供记录）

- 全部 spawn 用 argv 数组、`shell:false`（`.cmd` 必需处用固定参数）；`openCodexLogin` 正确单引号转义。
- `reviewEntryPath`（main.ts:546-559）做 realpath 级路径穿越遏制，含符号链接目录项。
- IPC 用 `senderFrame` URL 校验来源；`window.open` 全拒绝；外链只能交系统浏览器。
- 模型/effort/权限值在使用前对照 live catalog 校验；handoff 上下文有大小上限。

---

## 三、功能适配覆盖率：codex app-server 协议

对照 `work/codex-app-server-types/`（含 v2/ 新协议面）：

- 客户端请求：协议 **98** 个，harness 使用 **12** 个 ≈ **12%**
- 服务端通知：协议 **72** 个，harness 处理 **9** 个 ≈ **13%**
- 服务端请求：10 个中触达 7 个（其中 4 个为 stub/自动拒绝），有意义的 3 个
- **综合覆盖率 ≈ 15%**

已实现（表 A 摘要）：`initialize`/`initialized`、`model/list`、`account/read|rateLimits/read|usage/read`、`thread/start|resume|read|inject_items`、`turn/start|steer|interrupt`、两类审批 + 旧版审批自动拒绝、流式 delta（agentMessage/reasoning summary）、item 生命周期、`turn/started|completed`、`error`、rate limit 与 tokenUsage 更新。

**harness 未停留在 v1**：`turn/steer`、`thread/inject_items`、`item/*/requestApproval` 均为 v2 时代方法；无协议类型之外的私有扩展（表 C 为空）。

### 未适配清单按价值排序（表 B 摘要）

| 优先级 | 缺口 | 解锁能力 |
|---|---|---|
| 高 | `turn/diff/updated` + `gitDiffToRemote` | agent 改动的实时 git diff 视图（目前只有"Codex updated workspace files"占位文案） |
| 高 | `thread/compact/start` + `thread/compacted` | 长会话手动/自动上下文压缩 |
| 高 | `fuzzyFileSearch`（+2 通知） | 输入框 @ 提及文件补全 |
| 高 | `turn/start` 的 image/localImage/audio/skill/mention 输入变体 | 多模态 prompt（当前仅纯文本） |
| 高 | `review/start` | 一键 agentic 代码评审 |
| 高 | `thread/list|archive|unarchive|delete|name/set|fork|rollback` | 真正的 Codex 会话管理（当前完全没有 Codex 线程列表） |
| 高 | `item/plan/delta`、`turn/plan/updated`、`item/reasoning/textDelta` | 实时计划与完整推理流（当前只显示摘要文本） |
| 中 | `account/login/start|cancel|logout` + 完成通知 | 应用内 ChatGPT 登录（当前 shell 出 CLI 登录） |
| 中 | `item/permissions/requestApproval`、`item/autoApprovalReview/*`、guardian 系列 | 细粒度权限审批 / guardian 流程（当前 respondError 拒绝） |
| 中 | 9× `thread/realtime/*` | 语音/realtime 模式 |
| 中 | `config/read|value/write|batchWrite` | GUI 编辑 codex config（sandbox、approval_policy、service_tier 等） |
| 中 | `command/exec` + `exec/write|resize|terminate` + `process/*` | 交互式终端/后台进程 |
| 中 | `fs/*` 9 个方法 + `fs/changed` | 服务端文件浏览器 |
| 中 | `skills/list|config/write|extraRoots/set` + `skills/changed` | 技能管理 |
| 低 | `plugin/*` 11 个、`marketplace/*`、`app/*`、`mcpServer*`、`hooks/list`、`feedback/upload` 等 | 插件市场 / MCP 管理 / hooks / 反馈 |

### 设置面缺口

GUI 仅暴露 model、effort、approval/sandbox 预设、`web_search`（经 network mode）和硬编码 `developerInstructions`；`v2/Config.ts` + `v2/ThreadSettings.ts` 中的 `serviceTier`、`personality`、`collaborationMode`、`review_model`、`model_auto_compact_token_limit`、`model_verbosity`、`compact_prompt`、`outputSchema`（结构化输出）、`instructions` 等均未接。

---

## 四、优先行动建议

### P0 — 立即修（正确性 + 安全收紧）

1. **M2 + M1**：把 `settings.update` 真正收窄到显式命名空间白名单；为全部 43 个 RPC 方法补 payload schema。
2. **F2**：修复发送失败路径的重复投递（`delivered` 标记）。
3. **M3 + M4**：codex 崩溃时补发 turn 失败事件 + stdout 缓冲上限。
4. **M5**：terminal-run 限定工作区、子进程 env 剔除 billing 密钥（连带 M13 一起做）。

### P1 — 下个迭代（高价值功能适配）

5. 适配 `turn/diff/updated` + `gitDiffToRemote`：把 Review 面板从"占位文案"升级为实时 diff 视图。
6. 适配 `thread/list|archive|fork` 与 `thread/compact/start`：Codex 会话管理与上下文压缩。
7. **F1**：i18n 统一（App.tsx 错误文案走 `tr()`）。
8. **F3**：provider 会话状态收口为单一 hook + 多窗口同步。
9. **M6**：审批事件按窗口归属路由。

### P2 — 持续改进

10. `fuzzyFileSearch` 接入 Composer 的 @ 补全；多模态 `turn/start` 输入（图片已在 Host 侧支持，Codex 侧可复用管线）。
11. App.tsx 拆分：队列 drain / pending-turn  reconciliation / downlink 订阅抽为独立 hook，补集成测试（F17）。
12. 主进程健壮性打包修复：fetch 超时（M8）、SIGKILL 升级（M9）、半初始化进程清理（M10）、未知消息计数日志（M7）。
13. 字体来源合规化：vendored 到 `build/` 或改系统字体栈（M19/F17 关联）。

---

*审计方法：三路并行只读审计（前端 / 主进程与协议适配 / 协议覆盖对照）+ 本地验证（tsc、vitest）。所有发现均标注文件与行号，可直接定位。*
