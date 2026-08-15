# DeepSeek Harness GUI 使用说明

本桌面应用是 DeepSeek Harness Host 的客户端，不是 Host 本身。

```text
DeepSeek Harness.app / DeepSeek Harness.exe
        │
        ├── Local Host：http://127.0.0.1:3080
        │       ├── DeepSeek 与其他模型提供方
        │       ├── 会话、插件、设置、工作文件夹
        │       └── Host 配置与凭据
        │
        └── Codex bridge：通过 stdio 启动本机 `codex app-server`
                └── Codex 账号、模型、审批与沙箱
```

上游 Harness 仓库和原有浏览器界面仍然在 `http://127.0.0.1:3080`。关闭 GUI 不会删除 `~/.dsh` 数据；用户在外部启动的 Host 会继续运行，由首次向导启动并托管的 Host 会在桌面应用完全退出时停止。

## 1. 安装与启动

### 下载应用

从[最新 Release](https://github.com/Eentropie/deepseek-harness-macos-gui/releases/latest)下载：

- **macOS Apple Silicon：** 下载 `DeepSeek-Harness-0.2.1-arm64.dmg` 或 `.zip`，打开 `DeepSeek Harness.app`。未签名包首次可能需要右键/Control-click → **Open**。
- **Windows x64：** 下载并运行 `DeepSeek-Harness-0.2.1-Windows-x64.exe`。NSIS 安装器支持选择目录、桌面快捷方式和开始菜单项；未签名包可能触发 Windows SmartScreen。

首次打开会出现配置向导：检查 Node.js、发现已有 Harness checkout 或 npm 安装、启动 Local Host、为 DeepSeek 或其他 Host Provider 单向写入 API 凭据、检测 Codex CLI/登录，并执行最终环境检查。Setup 不再选择工作文件夹；进入主界面后再按需添加。

### 自动或手动启动 Local Host

优先使用 **First-run setup → Start Local Host**。已有源码及依赖会通过 Corepack 直接启动；其次复用已安装的 `dsh`；只有都不存在时才使用 npm 包路径。原有 localhost 网页和 Host 源码不会被修改。

如需手动启动，在另一个 Terminal 中保持 Host 运行：

```sh
cd /path/to/deepseek-harness
corepack pnpm dsh web
```

Windows PowerShell：

```powershell
Set-Location C:\path\to\deepseek-harness
corepack pnpm dsh web
```

可在浏览器打开 `http://127.0.0.1:3080` 验证原有 Web UI。然后启动桌面应用，在 **Settings → Local Host** 中确认已连接。

### 创建第一个会话

1. macOS 按 `Command-O`，Windows 按 `Ctrl+O`，或在侧栏选择 **Open folder…**。
2. 选择项目目录。GUI 会将它登记为工作文件夹，并恢复最近会话。
3. 点击 **New session**。
4. 在输入框下方选择模型、推理强度和权限档位，输入消息后发送。

工作文件夹是 Harness 工具和 Codex `workspace-write` 的边界，不等于 Host 仓库目录。你可以让 GUI 操作任意项目，而不需要移动或修改 Host 源码。

## 2. 接入 DeepSeek API

GUI 中有两套 DeepSeek 凭据流程：第一套用于对话，第二套可选、只用于读取余额。

### A. 在 GUI 中配置对话模型

1. 打开 **Settings → Models & credentials**。
2. 选择 DeepSeek 提供方，通常显示为 **DeepSeek** / `deepseek-official`。
3. 在 **API key** 中粘贴密钥。只粘贴密钥本身，不要粘贴 `DEEPSEEK_API_KEY=...`、引号或 Markdown 代码块。
4. **Base URL override** 留空时使用 Host 默认值 `https://api.deepseek.com`；Host 会在请求时追加 `/chat/completions`。
5. 如果使用兼容网关，填网关基础地址，例如 `https://gateway.example/v1`，不要填完整的 `/chat/completions`。
6. 点击 **Save changes**。**Discover models** 只查询候选模型，不会保存配置。

密钥通过桌面桥单向写入 Host credentials service；渲染页面只会收到 `configured`、`source`、`writable` 等状态，不会回读明文。不要把密钥写进公开仓库、`settings.yaml`、`cordis.patch.yml` 或截图。

### B. 通过启动环境配置 Host

适用于只用 Terminal 配置 Host 的情况：

```sh
export DEEPSEEK_API_KEY='sk-your-key'
export DEEPSEEK_BASE_URL='https://api.deepseek.com'
cd /path/to/deepseek-harness
corepack pnpm dsh web
```

PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = 'sk-your-key'
$env:DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
Set-Location C:\path\to\deepseek-harness
corepack pnpm dsh web
```

必须让 Host 在同一终端中启动，才能继承环境变量。想让 Host 凭据服务长期管理密钥时，优先使用 GUI 的 **Models & credentials**。

### C. 直接测试 DeepSeek API

DeepSeek 使用 OpenAI 兼容的 Chat Completions 接口：

```sh
export DEEPSEEK_API_KEY='sk-your-key'

curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "用一句话打招呼。"}],
    "thinking": {"type": "enabled"},
    "reasoning_effort": "high",
    "stream": false
  }'
```

当前 Host 默认目录包含 `deepseek-v4-flash` 和 `deepseek-v4-pro`。DeepSeek 推理档位为 `off`、`high`、`max`；关闭 thinking 后只能使用 `off`。详见官方 [Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion) 和 [模型/价格文档](https://api-docs.deepseek.com/quick_start/pricing)。

### D. 查看余额与用量

**Settings → Usage & billing → DeepSeek balance** 是可选功能。这里的密钥存入桌面应用的系统安全存储，只用于请求 `GET https://api.deepseek.com/user/balance`，与 Host 对话凭据分开。余额检查不是对话配置，余额面板没有密钥时不影响聊天。

```sh
curl -sS https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}"
```

详细的按 API Key 用量需要在 DeepSeek 平台导出 CSV；GUI 不会代理或保存该报表。参考官方[余额接口](https://api-docs.deepseek.com/zh-cn/api/get-user-balance)。

## 3. 接入 Codex CLI 外部 Agent

Codex 是本 GUI 的一等外部 Agent 集成。你不需要手动启动 `codex app-server`；GUI 找到 CLI 后会按需启动：

```text
codex app-server --listen stdio://
```

随后 GUI 通过 stdio 使用 Codex App Server 的 JSON-RPC/JSONL 协议，读取 `model/list`，创建 Codex 原生 thread，转发审批请求，并显示 agent、reasoning、tool 流事件。参考官方 [Codex App Server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)。

### 安装与登录

macOS/Linux：

```sh
npm install -g @openai/codex
# 或：brew install --cask codex
```

Windows PowerShell：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
# 也可以使用 npm：
npm install -g @openai/codex
```

验证并登录：

```sh
codex --version
codex --login
```

在浏览器流程中选择 **Sign in with ChatGPT**，或使用当前 Codex 版本提供的 API Key 登录方式。Codex Token 始终由 Codex CLI 管理，GUI 不读取、不复制、不替换。参考 OpenAI 官方 [Codex CLI 登录说明](https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt) 和 [快速开始](https://help.openai.com/en/articles/11096431)。

### GUI 如何发现 Codex

顺序是：

1. 环境变量 `DEEPSEEK_WORKBENCH_CODEX_BIN` 指向的绝对路径；
2. macOS 的 `/opt/homebrew/bin/codex`、`/usr/local/bin/codex` 或 `PATH`；
3. Windows 的 `%APPDATA%\npm\codex.cmd`、`%LOCALAPPDATA%\Programs\Codex\codex.exe`、WinGet Links，以及 `PATH` 中的 `codex.exe`、`codex.com`、`codex.cmd`、`codex.bat`。

macOS：

```sh
command -v codex
export DEEPSEEK_WORKBENCH_CODEX_BIN="$(command -v codex)"
open "/path/to/DeepSeek Harness.app"
```

Windows：

```powershell
Get-Command codex
$env:DEEPSEEK_WORKBENCH_CODEX_BIN = "$env:APPDATA\npm\codex.cmd"
& ".\DeepSeek Harness.exe"
```

修改环境变量后必须重启 GUI。

### 模型、推理与权限

登录成功后，在模型选择器打开 **ChatGPT · Codex CLI** 分组。模型目录来自 Codex 账号的 `model/list`，推理档位也由每个模型自行提供，可能包括 `Low`、`Medium`、`High`、`X-High`、`Max` 或 `Ultra`，GUI 不会虚构模型不支持的档位。

切换 DeepSeek/Codex 在下一轮生效。同一桌面会话会保留两个提供方各自的原生历史，并在切换时传递有限上下文；Codex 原生 thread 仍由 Codex 管理。

| Codex 权限 | 行为 | 文件边界 |
| --- | --- | --- |
| `ask-for-approval` | Codex 请求操作时询问你。 | 以当前工作文件夹为根的 `workspace-write`。 |
| `approve-for-me` | 由配置的自动审查器处理需要审批的操作。 | 以当前工作文件夹为根的 `workspace-write`。 |
| `full-access` | 此桥接层不再弹审批。 | Codex `danger-full-access`；只对可信目录使用。 |

## 4. 其他模型提供方与外部 Agent

### OpenAI 兼容网关

GUI 可以直接配置 Host 已经暴露的提供方：

1. **Settings → Models & credentials**；
2. **Add a provider**；
3. 选择 Host 当前提供的 OpenAI-compatible、Anthropic-compatible 或其他路由；
4. 填 API key 和可选 Base URL，点击 **Save changes**；
5. 如果端点支持模型列表，点击 **Discover models**。

GUI 的提供方下拉框只显示当前 Host 已安装/声明的适配器。公司网关、自建服务器或目录中没有的路由，可在 Host 的 `$DSH_HOME/settings.yaml`（默认 `~/.dsh/settings.yaml`）或 Host 原生 Models 页面声明。`apiKeyEnv` 是凭据引用名，不是明文密钥：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      displayName: My Gateway
      apiKeyEnv: MY_GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: coding-model
          name: Coding model
          reasoningEfforts:
            off:
            high: high
            max: max
```

然后在启动 Host 前设置：

```sh
export MY_GATEWAY_API_KEY='your-key'
corepack pnpm dsh web
```

具体协议、模型 ID、推理字段和 `/v1` 后缀取决于你的网关。如果没有 `GET /models`，手动填写模型目录。参考 upstream Harness 的[提供方说明](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/providers.zh.md)和[配置目录](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/config-catalog.zh.md)。

### Claude Code、OpenCode 等 Agent CLI

当前版本**不会自动启动任意 Agent 二进制文件**。GUI 能识别 Codex，是因为 Codex 提供了 App Server 协议；仅安装 `claude`、`opencode` 或其他 CLI 不会自动出现在模型选择器中。

目前有三种接入方式：

1. 在独立 Terminal 或官方 GUI 中运行其他 Agent，同时让 DeepSeek Harness 连接同一个仓库；
2. 如果它提供兼容 HTTP API，并且 Host 有对应适配器，将它作为模型提供方路由接入；
3. 为它实现桌面适配器，将其流式输出、工具调用、审批、thread 和 interrupt 协议映射到 GUI 桥接协议。

不要把非 Codex 可执行文件填到 `DEEPSEEK_WORKBENCH_CODEX_BIN`；这个变量只用于 Codex CLI。未知 Agent 可能获得工作文件夹、文件和权限，而 GUI 无法验证它是否遵守 Codex 沙箱契约，因此不会盲目启动。

## 5. 工作文件夹、会话、插件与 Settings

- **工作文件夹：** `Command-O` / `Ctrl+O`，或侧栏 **Open folder…**。切换工作文件夹不会移动 Host。
- **会话：** 侧栏/命令面板支持新建、重命名、置顶、归档、fork、导出和删除。Host 当前没有永久删除 API，GUI 删除不会抹掉 Host 日志。
- **插件：** 打开 **Plugins** 或按 `Command-Shift-P` / `Ctrl-Shift-P`。普通工具、skills、workflows 和模型扩展可以切换；控制平面、原始 `ui-*`/`client-*` 及运行时生成项保持锁定。
- **Agent presets：** **Settings → Agent presets** 修改后续新会话的默认组合，不会重组已有会话。
- **Appearance：** **Settings → Appearance** 支持跟随系统、浅色、深色、密度、Serif 回复和减少动画。

## 6. 常见问题

| 现象 | 检查 |
| --- | --- |
| Local Host 未连接 | 保持 `corepack pnpm dsh web` 运行；浏览器打开 `http://127.0.0.1:3080`；然后在 **Settings → Local Host** 点击 Reconnect。 |
| DeepSeek 报 `MISSING_CREDENTIAL` | 在 **Models & credentials** 配置聊天密钥，或在启动 Host 前导出 `DEEPSEEK_API_KEY`。余额面板的密钥不能替代聊天配置。 |
| DeepSeek 报 401 | 只粘贴密钥值，检查密钥是否有效；默认 Base URL 应为 `https://api.deepseek.com`。 |
| 模型发现 401/404 | 检查 key 和端点；模型发现是可选的，没有 `GET /models` 时手动录入模型。 |
| Codex 没出现在列表 | 先执行 `codex --version`、`codex --login`，再设置 `DEEPSEEK_WORKBENCH_CODEX_BIN` 绝对路径并重启 GUI。 |
| Codex 没有模型 | CLI 未登录、账号没有可用目录，或 CLI 太旧；先在同一个终端执行 `codex` 验证。 |
| Codex 审批行为不符合预期 | 检查权限档位和当前工作文件夹；`full-access` 明显宽于 workspace-write。 |
| Windows 启动即退出 | 必须完整解压 `win-unpacked`，让 `.exe` 与 `resources`、DLL 位于原目录。 |

## 安全边界

- Local Host 继续只监听回环地址，GUI 不替换它。
- API key 通过桌面桥单向传递；桌面余额 key 使用系统安全存储，Host key 由 Host credentials service 管理。
- Codex Token 始终由 Codex CLI 管理，GUI 只启动本机 app-server。
- Release 未签名。对敏感目录使用 Agent 前，先核对 Release SHA-256 并确认权限档位。
