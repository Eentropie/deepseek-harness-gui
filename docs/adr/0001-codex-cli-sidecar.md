# ADR 0001: Integrate Codex as a desktop sidecar

Status: accepted

## Context

The desktop GUI must offer both DeepSeek Harness models and the models available through the user's local Codex CLI login, without editing the Harness repository or original localhost Host. ChatGPT subscription authentication is owned by Codex and is not an OpenAI API key that another LLM adapter may extract or reuse.

Harness expects a provider-neutral raw LLM stream whose tool calls are executed by the Harness loop. Codex App Server exposes a complete coding-agent runtime with its own thread, tools, sandbox, and persistence. Treating that runtime as a raw Harness LLM adapter would nest two agent loops and create ambiguous tool ownership.

## Decision

Run one `codex app-server` child process from Electron main and expose only bounded catalog, thread, turn, read, and interrupt operations through the sandboxed preload.

- DeepSeek prompts continue through the unchanged Harness Host.
- Codex prompts continue through the official App Server protocol and existing Codex login.
- The model selector merges both catalogs.
- Reasoning efforts are copied from each exact model's advertised capabilities.
- Provider-native histories remain separate and are restored when the user switches provider.
- Before a Codex turn, the requested working directory must match the selected Harness session or workspace.
- Codex runs with `approvalPolicy: never` inside a workspace-write sandbox; unexpected interactive requests are declined.

## Consequences

The integration uses ChatGPT subscription access without handling credentials and preserves both upstream systems. Model and effort changes apply to the next turn without restarting either Host.

Cross-provider conversation state is intentionally not synthesized. A DeepSeek thread and a Codex thread in the same desktop session can diverge; the UI switches between their real histories instead of showing a false merged context.
