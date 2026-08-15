# DeepSeek Harness GUI usage guide

This desktop app is a client for the DeepSeek Harness Host. It is not the Host itself.

```text
DeepSeek Harness.app / DeepSeek Harness.exe
        │
        ├── Local Host: http://127.0.0.1:3080
        │       ├── DeepSeek and other provider routes
        │       ├── sessions, plugins, settings, and work folders
        │       └── live Host configuration and credentials
        │
        └── Codex bridge: local `codex app-server` over stdio
                └── Codex account, model catalog, approvals, and sandbox
```

The upstream checkout and its browser UI remain available at `http://127.0.0.1:3080`. Closing the app never deletes Host data. A Host that you started externally keeps running; a Host started and owned by the setup wizard is stopped when the desktop app fully quits.

## 1. Install and launch

### Downloaded application

Use the [latest release](https://github.com/Eentropie/deepseek-harness-macos-gui/releases/latest):

- **macOS Apple Silicon:** download the `DeepSeek-Harness-0.2.0-arm64.dmg` or `.zip` build and open `DeepSeek Harness.app`. An unsigned package may require Control-click → **Open** once.
- **Windows x64:** download and run `DeepSeek-Harness-0.2.0-Windows-x64.exe`. The NSIS installer can choose the install directory and create desktop/Start-menu shortcuts. An unsigned package may show a Windows SmartScreen warning.

On first launch, the setup wizard checks Node.js, finds an existing Harness checkout or npm installation, can start the Local Host, configures write-only credentials for DeepSeek or any other Host provider, checks Codex CLI/login readiness, and runs a final environment check. Work-folder selection is intentionally left to the main window after setup.

### Automatic or manual Local Host startup

Prefer **First-run setup → Start Local Host**. Existing checkouts with dependencies are started through Corepack, an installed `dsh` is reused, and only otherwise does the wizard offer the npm package path. The original browser UI and source remain unchanged.

For manual startup, keep the Host running in a separate terminal. Replace the path with your own checkout:


```sh
cd /path/to/deepseek-harness
corepack pnpm dsh web
```

On Windows PowerShell:

```powershell
Set-Location C:\path\to\deepseek-harness
corepack pnpm dsh web
```

Open `http://127.0.0.1:3080` in a browser if you want to verify the original web UI. Then launch the desktop app. **Settings → Local Host** should show the same loopback endpoint as connected.

### First session

1. Press `Command-O` on macOS or `Ctrl+O` on Windows, or choose **Open folder…** in the sidebar.
2. Select a project directory. The app registers it as a work folder and restores its latest session.
3. Choose **New session**.
4. Select a model and permission mode in the composer, type a prompt, and send it.

The work folder is the boundary used by Harness tools and Codex workspace-write turns. It is not the same thing as the Host checkout; you can work on any repository without moving or modifying the Host source.

## 2. DeepSeek API setup

There are two separate DeepSeek credential flows in the GUI. Use the first one to chat; the second one is optional and only reads the account balance.

### A. Configure the chat provider

1. Open **Settings → Models & credentials**.
2. Select the active DeepSeek provider, normally shown as **DeepSeek** / `deepseek-official`.
3. Paste the API key into **API key**. Paste only the key value — not `DEEPSEEK_API_KEY=...`, quotes, or a Markdown code fence.
4. Leave **Base URL override** empty for the public DeepSeek API. The Host default is `https://api.deepseek.com`; it appends `/chat/completions` for chat requests.
5. If you use a compatible gateway, enter its base URL instead. Keep the URL at the provider base, for example `https://gateway.example/v1`, not the complete `/chat/completions` path.
6. Click **Save changes**. **Discover models** can query the endpoint and show candidates without saving a provider change.

The desktop bridge sends the key to the Host credentials service as a write-only value. The renderer receives only `configured`, `source`, and `writable` status. Do not commit a key to `settings.yaml`, `cordis.patch.yml`, source code, or screenshots.

### B. Configure from the Host launch environment

For a terminal-only Host setup, export the credential before launching `dsh web`:

```sh
export DEEPSEEK_API_KEY='sk-your-key'
export DEEPSEEK_BASE_URL='https://api.deepseek.com'
cd /path/to/deepseek-harness
corepack pnpm dsh web
```

PowerShell:

```powershell
$env:DEEPSEEK_API_KEY = 'sk-your-key'
$env:DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
Set-Location C:\path\to\deepseek-harness
corepack pnpm dsh web
```

Keep the terminal open so the Host inherits the variables. The GUI provider form is the better choice when you want the Host credential store to own the key. Never put the literal value in a public repository or a release asset.

### C. Call the DeepSeek API directly

The Host uses the OpenAI-compatible Chat Completions interface. A minimal direct test is:

```sh
export DEEPSEEK_API_KEY='sk-your-key'

curl -sS https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "thinking": {"type": "enabled"},
    "reasoning_effort": "high",
    "stream": false
  }'
```

The current Host catalog exposes `deepseek-v4-flash` and `deepseek-v4-pro` by default. DeepSeek reasoning levels are `off`, `high`, and `max`; disabling thinking forces `off`. The API accepts `thinking.type` values `enabled` and `disabled`.

Official references: [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion), [API quick start](https://api-docs.deepseek.com/quick_start), and [models/pricing](https://api-docs.deepseek.com/quick_start/pricing).

### D. Check balance and usage

**Settings → Usage & billing → DeepSeek balance** is optional. Its key is kept in the desktop app's operating-system secure storage and is used only for `GET https://api.deepseek.com/user/balance`. It is separate from the Host chat credential so that a chat setup can work without enabling the billing panel.

```sh
curl -sS https://api.deepseek.com/user/balance \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}"
```

The balance endpoint reports whether the account is available and returns currency balances. Detailed per-key usage is exported from the DeepSeek platform as CSV; the desktop panel does not proxy or store that report. See the [official balance API](https://api-docs.deepseek.com/api/get-user-balance/).

## 3. Codex CLI external-agent integration

Codex is the first-class external agent in this GUI. The app does not ask you to start `codex app-server` manually. Once it finds the CLI, it starts:

```text
codex app-server --listen stdio://
```

It then speaks the Codex App Server JSON-RPC/JSONL protocol over stdio, reads `model/list`, starts native Codex threads, forwards approval requests, and streams agent/reasoning/tool events into the desktop session. See the [official Codex App Server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).

### Install Codex CLI

Use one of the current official install methods:

macOS/Linux:

```sh
npm install -g @openai/codex
# or: brew install --cask codex
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
# npm is also supported:
npm install -g @openai/codex
```

Verify and sign in before launching the GUI:

```sh
codex --version
codex --login
```

Select **Sign in with ChatGPT** in the browser flow, or use the API-key flow exposed by your installed Codex version. The GUI does not read, copy, or replace the Codex token. For the official setup explanation, see [Codex CLI and Sign in with ChatGPT](https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt) and [Codex CLI getting started](https://help.openai.com/en/articles/11096431).

### How the GUI finds Codex

The discovery order is:

1. `DEEPSEEK_WORKBENCH_CODEX_BIN`, when it is an absolute path.
2. Platform-specific conventional locations.
3. `PATH` entries.

macOS examples:

```sh
command -v codex
export DEEPSEEK_WORKBENCH_CODEX_BIN="$(command -v codex)"
open "/path/to/DeepSeek Harness.app"
```

Windows PowerShell examples:

```powershell
Get-Command codex
$env:DEEPSEEK_WORKBENCH_CODEX_BIN = "$env:APPDATA\npm\codex.cmd"
& ".\DeepSeek Harness.exe"
```

Windows discovery also checks `%APPDATA%\npm\codex.cmd`, `%LOCALAPPDATA%\Programs\Codex\codex.exe`, WinGet Links, and `codex.exe`/`codex.com`/`codex.cmd`/`codex.bat` on `PATH`. Restart the desktop app after changing the environment variable.

### Select models and reasoning effort

After login, open the model selector and choose the **ChatGPT · Codex CLI** group. The list is account-scoped and comes from Codex `model/list`; the effort menu is model-specific. Depending on the account and model it may contain `Low`, `Medium`, `High`, `X-High`, `Max`, or `Ultra`. The GUI does not invent unsupported levels.

Switching between DeepSeek and Codex takes effect on the next turn. The desktop session keeps the provider histories separate and sends a bounded context handoff when changing providers; the native Codex thread remains owned by Codex.

### Codex permissions

The composer exposes three Codex permission modes:

| Mode | Approval policy | Filesystem boundary |
| --- | --- | --- |
| `ask-for-approval` | Ask you when Codex requests approval. | Workspace-write rooted at the selected work folder. |
| `approve-for-me` | Use the configured automatic approval reviewer for on-request actions. | Workspace-write rooted at the selected work folder. |
| `full-access` | No approval prompt from this bridge. | Codex danger-full-access; use only for a trusted directory. |

Network access is enabled for workspace-write Codex turns because the app-server policy needs to support normal coding workflows. The selected work folder is still passed as the Codex `cwd`; do not choose a directory containing secrets if you do not intend to grant the agent access to it.

## 4. Other providers and external agents

### OpenAI-compatible provider routes

The desktop GUI can configure provider routes already exposed by the Host:

1. Open **Settings → Models & credentials**.
2. Choose **Add a provider**.
3. Select an installed route such as OpenAI-compatible, Anthropic-compatible, or another route offered by the current Host.
4. Enter the API key and optional base URL, then click **Save changes**.
5. Use **Discover models** when the endpoint implements a model-list operation. Discovery is read-only; saving the route is a separate action.

For a company gateway or self-hosted endpoint that is not in the installed catalog, configure a hand-declared `llm-pi-ai` route in the Host's `$DSH_HOME/settings.yaml` (normally `~/.dsh/settings.yaml`) or through the Host's native Models page. Keep the key in the credentials service or launch environment; `apiKeyEnv` is a reference name, not a literal key:

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

Then launch the Host with the corresponding variable:

```sh
export MY_GATEWAY_API_KEY='your-key'
corepack pnpm dsh web
```

The exact protocol, model IDs, reasoning field, and `/v1` suffix belong to the gateway. If the endpoint does not implement `GET /models`, enter the model catalog manually. The upstream [provider guide](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/providers.md) and [configuration catalog](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/config-catalog.md) describe the full Host schema.

### Claude Code, OpenCode, and other agent CLIs

This release does **not** auto-launch arbitrary agent binaries. The executable bridge recognizes Codex because it implements Codex App Server. Installing `claude`, `opencode`, or another CLI alone will not add it to the model selector.

You have three supported options:

1. Run the other agent in its own terminal or official GUI while DeepSeek Harness remains connected to the same repository.
2. Use its underlying model API as a Host provider route if it exposes a compatible HTTP API and the Host has an adapter for it.
3. Build a future desktop adapter that maps the agent's streaming, tool, approval, thread, and interrupt protocol to the same bridge contract. Do not point `DEEPSEEK_WORKBENCH_CODEX_BIN` at a non-Codex executable; that variable is specifically for the Codex CLI.

This boundary is intentional: an unknown agent process could receive the work folder, files, credentials, and approval decisions without the GUI being able to enforce the Codex sandbox contract.

## 5. Work folders, sessions, plugins, and settings

- **Work folders:** `Command-O` / `Ctrl+O`, or **Open folder…**. Switching folders does not move the Host checkout.
- **Sessions:** use the sidebar or command palette for new, rename, pin, archive, fork, export, and delete actions. Host logs are not permanently deleted by the desktop delete action because the current Host has no permanent session-delete API.
- **Plugins:** open **Plugins** or press `Command-Shift-P` / `Ctrl-Shift-P`. Safe entries can be toggled; Host control-plane, original `ui-*`/`client-*`, and unstable runtime-generated entries remain locked. Toggles write only the managed profile patch and do not edit upstream source.
- **Agent presets:** **Settings → Agent presets** changes the default composition for later sessions. It does not recompute an existing conversation.
- **Appearance:** **Settings → Appearance** supports system, light, and dark modes, density, Serif responses, and reduced motion.

## 6. Troubleshooting

| Symptom | Check |
| --- | --- |
| Local Host is disconnected | Keep `corepack pnpm dsh web` running; open `http://127.0.0.1:3080`; then use **Settings → Local Host → Reconnect**. |
| DeepSeek returns `MISSING_CREDENTIAL` | Configure the chat key under **Models & credentials** or launch the Host with `DEEPSEEK_API_KEY`. The billing key panel alone does not configure chat. |
| DeepSeek returns 401 | Paste only the key value, check the account key, and leave Base URL at `https://api.deepseek.com` unless using a compatible gateway. |
| Model discovery returns 401/404 | Check the key and endpoint; discovery is optional. Add the model manually in the Host provider route when the gateway has no `GET /models`. |
| Codex is not listed | Run `codex --version`, then `codex --login`; set `DEEPSEEK_WORKBENCH_CODEX_BIN` to an absolute executable path and restart the GUI. |
| Codex has no selectable models | The CLI is not signed in, the account has no available catalog, or the CLI version is too old for the app-server methods used by this build. Test `codex` in the same shell first. |
| Codex approval behaves unexpectedly | Check the permission mode and the selected work folder. `full-access` is intentionally broader than workspace-write. |
| Windows app exits immediately | Extract the entire `win-unpacked` directory and run the `.exe` beside its `resources` and DLL files. |

## Security boundaries

- The Local Host stays on loopback and is not replaced by the GUI.
- API keys are write-only across the desktop bridge. Stored desktop billing keys use operating-system secure storage; Host credentials remain owned by the Host credential service.
- Codex authentication remains in Codex CLI. The GUI starts a local app-server process but does not copy its token.
- Release packages are unsigned. Verify the release checksum and review permission mode before granting an agent access to a sensitive work folder.
