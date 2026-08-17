# DeepSeek Harness Windows 版

这是现有 DeepSeek Harness GUI 的 Windows 10/11 x64 桌面版本。它不会修改或替换 Local Host，也不会把 Host 嵌入桌面应用；桌面端继续连接固定地址 `http://127.0.0.1:3080`。

完整的 DeepSeek API、Codex CLI、外部 Agent、权限和故障排查说明见[中文使用说明](./docs/USAGE.zh-CN.md)。

## 使用安装版

下载并运行：

```text
DeepSeek-Harness-0.3.1-Windows-x64.exe
```

NSIS 安装器可选择安装目录，并创建桌面和开始菜单快捷方式。首次启动向导会依次检查 Node.js、Local Host、可用的模型 Provider/API 凭据以及 Codex CLI/登录。工作文件夹不属于 Setup，进入主界面后再按需选择。

如使用调试用 unpacked 目录，必须运行：

```text
win-unpacked\DeepSeek Harness.exe
```

不要只复制其中的 `.exe`；旁边的 DLL、resources 和 locales 都是 Electron 运行所需文件。

GitHub Actions 会在 Windows x64 runner 上生成 NSIS 安装器，避免依赖 macOS 上的交叉编译器；安装版同时注册 `dsh-workbench://` 会话链接。

## 1. 自动或手动安装并启动 Local Host

优先在首次启动向导点击 **Start Local Host**。它会复用已有 checkout、全局 `dsh` 或 npm 包，并在 `127.0.0.1:3080` 就绪后继续。原 localhost 端不会被修改。

如需手动配置，Windows 需要 Node.js 22 或更高版本、Git，以及 pnpm 11.7.0。打开 PowerShell：


```powershell
git clone https://github.com/deepseek-ai/deepseek-harness.git
Set-Location .\deepseek-harness

corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
pnpm run build
pnpm dsh web
```

保持这个 PowerShell 窗口运行。Host 正常启动后，桌面应用的 **Settings → Local Host** 应显示已连接；原有浏览器界面仍可通过 `http://127.0.0.1:3080` 使用。

如果系统策略不允许 `corepack enable` 写入 Node 安装目录，可在管理员 PowerShell 中仅执行一次该命令，再回到普通 PowerShell 完成其余步骤。

## 2. 使用 DeepSeek 模型

DeepSeek 的模型、API Key、Provider 和 Endpoint 均由现有 Host 管理。可以在桌面端 **Settings → Models & credentials** 中写入或更换凭据；凭据值不会回读到渲染页面。

Host 与桌面端的配置是分开的：关闭 GUI 不会停止 Host，卸载 GUI也不会删除 `~/.dsh` 中的 Harness 配置和会话。

## 3. 使用 ChatGPT / Codex 模型

先在 Windows 安装 Codex CLI，并完成其自己的登录。可在 PowerShell 中验证：

```powershell
codex --version
codex login
```

桌面应用会按以下顺序发现 Codex：

1. 环境变量 `DEEPSEEK_WORKBENCH_CODEX_BIN` 指向的绝对路径；
2. `%APPDATA%\npm\codex.cmd`；
3. `%LOCALAPPDATA%\Programs\Codex\codex.exe`；
4. WinGet Links；
5. `PATH` 中的 `codex.exe`、`codex.com`、`codex.cmd` 或 `codex.bat`。

如果自动发现失败，可在启动 GUI 前设置：

```powershell
$env:DEEPSEEK_WORKBENCH_CODEX_BIN = "$env:APPDATA\npm\codex.cmd"
& ".\DeepSeek Harness.exe"
```

Codex 登录状态和 Token 仍由 Codex CLI 自己持有，GUI不会读取或复制 Token。选择 Codex 模型后，权限档位会切换为 Codex 的 approval/sandbox 组合；切回 DeepSeek 后恢复 Harness 的原生权限选项。

## Windows 平台行为

- 快捷键使用 `Ctrl`：`Ctrl+K` 命令面板、`Ctrl+O` 工作文件夹、`Ctrl+N` 新会话、`Ctrl+,` 设置。
- “Reveal in Finder” 在 Windows 中显示为 “Reveal in Explorer”。
- 系统主题、原生标题栏、文件夹选择器和 Explorer 操作使用 Windows 实现。
- GUI 保存的敏感值通过 Electron `safeStorage` 交给 Windows DPAPI；普通偏好和草稿保存在 Electron 用户数据目录。
- 第二次启动应用或打开 `dsh-workbench://` 链接时，会复用并唤醒已有窗口。
- 工作文件夹、会话草稿、模型热切换、Thought process、插件开关和 archived chats 与 macOS 版保持同一套逻辑。

## 安全提示与已验证边界

当前本地包未做 Authenticode 签名，Windows SmartScreen 可能显示“无法识别的发布者”。请先核对文件来源和 SHA-256，再决定是否运行；正式分发时应使用可信代码签名证书。

本次在 macOS 上完成了 Windows x64 交叉构建、TypeScript 检查、单元测试、PE32+ 架构检查和包内容检查。它证明产物结构正确，但不等于已在真实 Windows 10/11 机器上完成 UI、Host、Codex 登录和安装/卸载的端到端运行验证。

## 从源码重新构建 Windows 包

在 GUI 项目目录运行：

```powershell
corepack pnpm install
corepack pnpm check
corepack pnpm test
corepack pnpm pack:win
corepack pnpm dist:win
```

生成位置：

```text
release\win-unpacked\DeepSeek Harness.exe
release\DeepSeek-Harness-0.3.1-Windows-x64.exe
```
