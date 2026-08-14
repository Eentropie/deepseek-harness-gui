# DeepSeek Harness — Local Host capability audit

Audit date: 2026-08-15

## Bottom line

The desktop app covers the main local coding loop and now exposes the Host's provider, credential, model-discovery, and schema-settings APIs, but it is not yet a complete replacement for every feature in the original Web UI.

- The upstream checkout at `/Users/pengc/deepseek-harness` remains unchanged and clean.
- The Electron bridge allowlists 49 of the Host's 52 request methods.
- `host.pickDirectory` is intentionally replaced by the native macOS folder picker.
- `agentPreset.select` is bridged but has no reachable desktop control for changing the preset of a blank existing session.
- Two directory-browser RPC methods remain absent from the desktop surface; native folder selection covers the ordinary local workflow.
- Several rich Web UI modules have no desktop equivalent even where the underlying session data is already available.

This means the current build is a capable standalone client, not a claim of full Host feature parity.

## Archived chats and Delete

Archived chats now appear in a collapsed **Archived** group at the bottom of the sidebar. Expand it to reopen an archived transcript. The native chat menu hides **Archive chat** after a chat is archived.

**Delete chat…** is available from the same native menu and is disabled while a session is running. Its current semantics are deliberately conservative:

- it removes the session from this desktop client's visible history;
- it clears desktop-local pinned, unread, and Codex-thread metadata;
- it does not remove the underlying Harness session log.

The reason is structural: the current Host exposes `workspace.archiveSession`, but no `session.delete` or unarchive/restore request. A true permanent delete or restore button therefore requires a Host protocol extension. The confirmation dialog states this boundary before deletion.

## RPC coverage

### Present in the desktop app

| Domain | Current desktop coverage |
| --- | --- |
| Host/workspaces | Host status, native folder selection, create/register workspace, rename, reorder, remove, open in Finder |
| Sessions | List/search/create, history pagination, rename, latest-turn fork, archive, image attachment, model selection, prompt/cancel, queue edit/remove/steer |
| Interaction | Streaming assistant/reasoning text, approvals, user questions, permission presets |
| Agent runtime | Goals, direct subagent list/history/follow-up/interrupt, jobs snapshot, skill inventory |
| Presets | List/read/copy/open/remove, default preset setting, Creator draft flow |
| Settings | `settings.describe`, `settings.update`, `settings.replace`, `settings.mutate`, document opening, a schema-generated editor, revisions, redaction, and reset controls |
| Providers and credentials | Host provider roster, live model catalog, endpoint discovery, value-free credential status, write-only set, and confirmed removal |
| Desktop additions | Codex CLI threads/models, native menus/windows/deep links, local appearance/layout preferences, plugin HMR controls |

### Host requests not exposed by the desktop bridge

| Missing request | What it would unlock |
| --- | --- |
| `host.listDirectory` | In-app directory browser |
| `host.createDirectory` | New-folder creation inside the picker |

`host.pickDirectory` is also not bridged, but the native macOS picker provides the intended desktop interaction.

## Functional gaps beyond the RPC list

The original Web bundle mounts dedicated client modules for tool calls, Cordis calls, workflow runs, deliverables, input triggers, commands, skills, subagents, jobs, goals, feedback, model selection, permissions, presets, plan state, questions, and trajectory. The custom desktop currently implements only part of that presentation layer.

Highest-impact gaps are:

1. **Rich in-thread execution records.** Tool arguments/results, file/diff cards, Cordis operations, workflow nodes, produced files, and the timing/trajectory ledger are not rendered as first-class timeline items.
2. **Preset switching for a blank current session.** The RPC exists and is guarded correctly, but the current page only changes the default used by future sessions.
3. **Command, skill, and context discovery.** There is no full slash-command or `@file`/`@folder`/`@skill` picker, and the inspector truncates the skill roster.
4. **Session precision controls.** Forking is only offered at the latest completed turn, search does not expose its `hasMore` refinement state, and Plan mode can be exited when active but cannot be entered from the GUI.
5. **Media and deliverables.** There is no attachment gallery/lightbox or durable produced-file strip.
6. **Lifecycle completeness.** Host-backed unarchive and permanent delete do not exist in the current protocol.

## Recommended implementation order

### P0 — Finish capabilities the Host already exposes

These require desktop work, not changes to the upstream Host source.

1. **Execution timeline and deliverables**
   - Render every tool call with status, elapsed time, expandable arguments/result, and a safe raw-JSON fallback.
   - Add file-change/diff cards, workflow-run nodes, downloadable deliverables, errors, and trajectory metrics.

2. **Blank-session preset selector and complete command/context picker**
   - Expose `agentPreset.select` only while the Host reports the session as blank.
   - Add searchable `/command`, `@file`, `@folder`, `@skill`, and `@agent` menus.

3. **Host directory browser**
   - Keep the native macOS picker as the default.
   - Add the Host browser and new-folder controls as a remote/SSH-compatible fallback.

### P1 — High-value features that can be self-built as a desktop sidecar

| Feature | Product pattern | How to implement without patching Host source |
| --- | --- | --- |
| Git review center | Codex review pane; Cursor Agent Review | Run read-only Git status/diff in Electron, show per-file and line-level diffs, then provide explicit stage/revert/commit actions with confirmation. |
| Automatic checkpoints | Cursor checkpoints | Snapshot agent-caused file deltas at turn boundaries into app-owned storage; restore only selected paths and keep this clearly separate from Git history. |
| Integrated terminal | Codex terminal; Cursor terminal tools | Add a per-session PTY drawer scoped to the workspace, persistent process tabs, output search, and an explicit “share current output with agent” action. |
| Worktree-isolated tasks | Codex and Claude Code worktrees | Create guarded `git worktree` sessions, register each path as a workspace, show branch/dirty state, and support a reviewed handoff back to Local. |
| Build / Ask / Plan / Review / custom modes | Codex environments; Claude permission modes; Cursor custom tools | Store mode recipes in the desktop client and atomically bind prompt preamble, preset, permission profile, model/effort, and enabled tool groups per new session. |
| Rules and memory manager | Claude Code extension model; Cursor rules | Manage user/project instructions with scope badges, path globs, precedence preview, linting, and a “derive candidate rule from this chat” flow. |
| MCP/tool control center | Claude Code MCP/plugins; Cursor MCP | Inventory servers and individual tools, show trust/source, allow per-tool enable/disable and approval policy, and provide expandable request/result traces. |

Relevant official patterns: [Codex code review](https://learn.chatgpt.com/docs/code-review), [Codex integrated terminal](https://learn.chatgpt.com/docs/integrated-terminal), [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees), [Claude Code extension model](https://code.claude.com/docs/en/features-overview), [Claude Code worktrees](https://code.claude.com/docs/en/worktrees), [Cursor checkpoints](https://docs.cursor.com/en/agent/chat/checkpoints), and [Cursor CLI context/review](https://docs.cursor.com/en/cli/using).

### P2 — Orchestration and automation

1. **Parallel task board.** Show nested agents, ownership, live status, current tool, elapsed time, token usage, requests for attention, stop/attach/handoff controls, and worktree isolation for writers. Codex and Claude Code both expose parallel-agent patterns: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Claude Code parallel agents](https://code.claude.com/docs/en/agents).
2. **Lifecycle hooks.** Start with non-blocking notifications, logging, formatter/test-on-stop, and secret scanning. True pre-tool blocking must be enforced inside the trusted Host/tool runtime, not only in the renderer. See [Codex hooks](https://learn.chatgpt.com/docs/hooks) and [Claude Code hooks](https://code.claude.com/docs/en/hooks-guide).
3. **Scheduled/background tasks.** Add a local scheduler, isolated worktree per run, run history, unread completion inbox, retry policy, and budgets. See [Codex scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app) and [Cursor background agents](https://docs.cursor.com/background-agent).
4. **Context and cost telemetry.** Per-turn token/context gauges, tool latency, model/provider cost estimates, budget alerts, and optional model auto-routing with an auditable reason.
5. **Reproducible run bundles.** Export transcript, model/preset/settings snapshot, changed-file patch, tool ledger, test results, and checksums as one portable artifact.

## Features that require a Host protocol extension

These should not be simulated as if they were authoritative Host operations:

- permanent session deletion;
- unarchive/restore;
- trusted pre-tool hooks that can block execution before the tool runs;
- richer provider/runtime mutation if the existing settings and LLM APIs cannot express a field;
- durable orchestration state beyond the current goals, jobs, and direct subagent projections.

Until those APIs exist, the desktop should label local-only metadata and sidecar behavior explicitly.
