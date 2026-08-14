# DeepSeek Workbench

DeepSeek Workbench is a standalone macOS desktop GUI for a local DeepSeek Harness Host. It keeps the upstream Harness repository and its original `http://127.0.0.1:3080` web interface unchanged.

## What is included

- Local desktop window with no browser dependency
- Work-folder and session switcher
- Native macOS folder picker
- Command palette and keyboard shortcuts
- Model, reasoning-effort, and permission controls
- DeepSeek plus account-scoped ChatGPT/Codex models through the local Codex CLI login
- Native Harness Agent presets with Standard, Code, Minimal, and Creator modes
- Session context and activity inspector
- Live plugin inventory with one-click enable/disable for safe entries
- Full Settings center for startup, layout, appearance, model, permissions, plugins, Host status, shortcuts, and app information
- System, light, and dark appearance modes with comfortable or compact density

The visual system uses only black, white, and neutral grays. On this Mac, the desktop runtime reads the already-installed UI Sans and Serif variable fonts through fixed, read-only font routes. The font files are not copied into this project or the application package. SF Pro and New York-style system fonts are the automatic fallbacks when those local sources are unavailable.

## Run it

Start the existing Harness Host in one Terminal window (replace the path with your local checkout):

```sh
cd /path/to/deepseek-harness
corepack pnpm dsh web
```

Then open the desktop application:

```sh
open "release/mac-arm64/DeepSeek Workbench.app"
```

The desktop app talks only to the local Host at `127.0.0.1:3080`. It does not replace or patch that Host.

For ChatGPT/Codex models, the desktop app also starts the locally installed `codex app-server`. Codex keeps ownership of authentication; the workbench never reads or copies its login token.

## DeepSeek and Codex models

The same model selector contains two live groups:

- **DeepSeek:** models returned by Harness. Their reasoning selector currently switches among `Off`, `High`, and `Max`.
- **ChatGPT · Codex CLI:** models returned by the signed-in Codex account. Every model supplies its own list, such as `Low`, `Medium`, `High`, `X-High`, `Max`, and, where available, `Ultra`.

Changing the model or reasoning effort takes effect on the next turn and does not restart the Host or desktop app. DeepSeek and Codex keep separate native conversation histories under the selected desktop session; switching provider restores the corresponding real thread. Codex turns are limited to the selected Harness work folder with a workspace-write sandbox.

## Work folders

Choose **Open folder…** in the sidebar or press `Command-O`. The native folder picker registers the selected path as a Harness workspace and opens its most recent session. If the folder has no session yet, the app creates one blank session. Click any folder heading in the sidebar, or use `Command-K`, to switch later.

## Plugin manager

Choose **Plugins**, select **Manage plugins** from `Command-K`, or press `Command-Shift-P`.

Switchable entries are ordinary tools, skills, workflows, and model extensions. A change is written atomically to the local `web` profile patch and applied by Harness HMR. The original config is backed up first and restored automatically if the requested runtime state does not appear.

Locked entries are intentional:

- Host control-plane and transport plugins are required to keep RPC, sessions, HMR, and realtime events alive.
- Original `ui-*` and `client-*` entries stay locked so the existing localhost interface is preserved.
- Runtime-generated entries do not have a stable config ID, so persisting a toggle for them would be ambiguous.

No plugin is changed merely by opening the manager.

## Agent presets

Open **Settings → Agent presets** to use the Host's native per-session composition system. This is not a local display preference: the roster comes from `agentPreset.list`, and selecting a card writes the `agent-presets.default` setting used when Harness creates later sessions.

- **Standard mode:** complete coding-agent toolset, skills, planning, goals, subagents, and workflows.
- **Code mode:** Standard capabilities presented through the Code Mode SDK for multi-step TypeScript tool programs.
- **Minimal mode:** persistent shell plus the focused replacement editor.
- **Creator mode:** Standard capabilities plus runtime inspection and preset-authoring guidance.

The page distinguishes the default (`In use`) from the preset mounted by the current session. Existing conversations are not recomposed when the default changes.

Shipped presets can be viewed read-only or copied. A copy is created by the Host under its user-writable preset root; no arbitrary composition text or filesystem path crosses the desktop bridge. Custom presets can be opened in their own directory and deleted after confirmation. **Draft a custom preset with Creator mode** creates a blank `cordis` session and prepares an authoring prompt.

**Open configuration file** delegates to the Host's native settings-document opener. The desktop renderer cannot choose the file path.

## Settings

Choose **Settings**, click the gear button, select it from `Command-K`, or press `Command-,`. Preferences apply immediately and persist locally.

- **General:** resume the last session, choose the default sidebar and inspector state, and open or switch the current work folder.
- **Appearance:** follow the macOS theme or force light/dark mode, select comfortable/compact density, enable Serif assistant responses, and reduce motion.
- **Model & permissions:** choose the active session model, reasoning effort, and permission preset.
- **Agent presets:** choose the default session composition and manage safe copy-only custom presets.
- **Plugins:** inspect live enabled/controllable counts and open the full plugin manager.
- **Local Host:** see connection, version, and working-directory information and reconnect to the fixed local Host.
- **Shortcuts / About:** review keyboard controls, architecture, signing, and security boundaries.

The Appearance page reports whether both local font families are active and includes a live Serif sample, so the typography source is directly visible rather than inferred from styling.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Command-K` | Open command palette |
| `Command-O` | Add or switch work folder |
| `Command-N` | New session |
| `Command-B` | Collapse or expand sidebar |
| `Command-Shift-I` | Hide or show inspector |
| `Command-,` | Open Settings |
| `Command-Shift-P` | Open plugin manager |
| `Escape` | Close the active overlay |

## Build and verify

```sh
cd /path/to/deepseek-harness-macos-gui
corepack pnpm install
corepack pnpm check
corepack pnpm test
corepack pnpm pack:mac
```

The output is `release/mac-arm64/DeepSeek Workbench.app`.

This local build is not signed with an Apple Developer certificate. If macOS quarantines a copied build, Control-click the app and choose **Open** once. Do not disable Gatekeeper globally.

## Configuration touched by plugin toggles

Plugin toggles write only the managed block in:

```text
~/.dsh/profiles/web/cordis.patch.yml
```

They do not edit the upstream Harness checkout.
