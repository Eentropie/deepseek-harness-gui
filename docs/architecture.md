# Architecture and safety boundary

```text
Local React renderer
        |
        | narrow contextBridge API
        v
Sandboxed Electron preload
        |
        | allowlisted IPC only
        v
Electron main process -------------------- Native folder picker
        |
        +---- allowlisted Harness RPC ---- 127.0.0.1:3080
        +---- read-only event downlinks --- 127.0.0.1:3080
        +---- JSONL stdio sidecar --------- local `codex app-server`
        +---- read-only local font routes - fixed app-resource paths
        +---- plugin profile controller --- ~/.dsh/profiles/web/cordis.patch.yml
```

## Desktop boundary

The renderer is packaged with the application and served through the private secure `dsh-workbench://app` protocol. It does not load the upstream localhost website into a wrapper.

The BrowserWindow uses:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`

The preload exposes only typed operations for allowlisted Harness RPC calls, plugin inventory and toggles, the native directory picker, connection state, downlink events, and the bounded Codex catalog/thread/turn operations. The renderer has no general filesystem, process, shell, or arbitrary IPC access.

Agent-preset support adds only the Host's existing `agentPreset.*` methods plus `settings.describe`, `settings.openDocument`, and a narrowed `settings.update`. The main-process payload policy restricts that write to `agent-presets.default`, validates every preset id as a single safe directory-name token, and allows copy-only authoring metadata. No renderer payload can provide a preset composition or filesystem path.

Navigation away from the private application origin is blocked. New HTTP or HTTPS links are denied in-window and may only be handed to the system browser.

The private protocol also exposes four fixed, read-only routes for the locally installed Sans and Serif font faces. Route names and source paths are hard-coded; the renderer cannot request arbitrary files. The proprietary font bytes are neither copied into this repository nor bundled into the packaged application, and system-font fallbacks remain available.

## Host boundary

The app is a companion client. It does not modify the upstream Harness checkout, replace the Host process, or change the original localhost UI. Its RPC allowlist is limited to host description, workspace/session projection, session history/models, session creation and prompting, cancellation, and model selection.

## Codex CLI boundary

The desktop main process launches the installed `codex app-server` with fixed arguments and communicates through JSONL over stdio. Codex owns ChatGPT/API authentication and its persisted threads; this app never reads, copies, logs, or translates Codex credentials.

The model picker merges the Host's `session.models` result with Codex's account-scoped `model/list` response. Reasoning choices therefore come from the selected model itself: DeepSeek currently exposes `off`, `high`, and `max`, while each GPT/Codex model exposes its own supported list.

Codex prompts run as Codex agent turns in a workspace-write sandbox rooted at the exact folder owned by the selected Harness session. The main process re-reads Harness session/workspace projections before every new turn and refuses a renderer-supplied path outside that set. Interactive approval requests fail closed; the bridge cannot silently grant broader access.

DeepSeek and Codex retain separate provider-native histories under one desktop session shell. Switching providers changes the visible transcript and restores that provider's thread. This avoids pretending that ChatGPT subscription authentication is an OpenAI API key or injecting one agent's internal state into the other agent's history. See [ADR 0001](./adr/0001-codex-cli-sidecar.md).

## Plugin changes

The Host's plugin inventory endpoint is read-only. The desktop controller therefore uses the supported profile composition path:

1. Read the live inventory and current `web` profile patch.
2. Refuse protected or unstable entries.
3. Create a unique backup of the patch file.
4. Atomically write the managed include/exclude block.
5. Wait for Harness HMR and poll the live inventory.
6. Restore the original bytes if the requested state is not observed.

Control-plane, HMR, transport, original UI/client, and runtime-generated entries are locked. This prevents a GUI switch from disconnecting the GUI itself or silently breaking the preserved localhost interface.

## Agent-preset changes

The desktop client treats the Host as the only source of truth:

1. `agentPreset.list` supplies the roster, trust, health, and current default.
2. Selecting a card updates only the `agent-presets.default` settings field for future sessions.
3. Shipped compositions are read-only; custom creation is a Host-side whole-directory copy.
4. The Host resolves preset ids to directories for opening and deletion; the renderer never sends a path.
5. A Creator draft starts a new session with `agentPreset: "cordis"`; existing sessions retain the composition recorded in their own headers.
