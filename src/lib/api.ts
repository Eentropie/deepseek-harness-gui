import type {
  AgentPresetDocument,
  AgentPresetOpenResult,
  AgentPresetRoster,
  CodexCatalog,
  CodexEvent,
  CodexPromptResult,
  CodexThreadSnapshot,
  CodexUsageSnapshot,
  ConfigurableProviderView,
  CredentialView,
  DeepSeekBillingSnapshot,
  DiscoveredModelView,
  DownlinkFrame,
  HistoryPage,
  HostModelCatalog,
  HostDescription,
  ImageAttachmentRef,
  ImageLimits,
  PluginControlSnapshot,
  PluginToggleResult,
  PromptContentPart,
  QueueItem,
  ReviewDocument,
  ReviewDirectorySnapshot,
  ReviewSnapshot,
  RpcEnvelope,
  SessionSearchHit,
  SessionExportResult,
  SessionModels,
  SessionSummary,
  SetupEvent,
  SetupSnapshot,
  SkillEntry,
  SettingsDescription,
  SettingsNamespaceView,
  SettingsPathOpView,
  SubagentCatalog,
  SubagentEntry,
  TerminalEvent,
  WorkspaceSummary,
  WorkspaceCreateResult,
} from './types.ts'

let nextRpc = 0

export class HarnessRpcError extends Error {
  readonly code: string
  readonly details: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HarnessRpcError'
    this.code = code
    this.details = details
  }
}

function rpcId(): string {
  nextRpc += 1
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${nextRpc}`
  return `workbench-${random}`
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new DOMException('The operation was aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      value => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      reason => {
        signal.removeEventListener('abort', abort)
        reject(reason)
      },
    )
  })
}

export async function rpc<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  if (window.dshDesktop !== undefined) {
    return withAbort(window.dshDesktop.rpc<T>(method, payload), signal)
  }
  const id = rpcId()
  const response = await fetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload }),
    signal,
  })
  if (!response.ok) {
    throw new HarnessRpcError('transport', `Host returned HTTP ${response.status}`)
  }
  const envelope = await response.json() as RpcEnvelope<T>
  if (envelope.rpcId !== id) {
    throw new HarnessRpcError('protocol', 'Host returned a mismatched RPC identifier')
  }
  if (!envelope.result.ok) {
    throw new HarnessRpcError(
      envelope.result.error.code,
      envelope.result.error.message,
      envelope.result.error.details,
    )
  }
  return envelope.result.value
}

async function controlRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  })
  const payload = await response.json().catch(() => undefined) as { error?: string } | undefined
  if (!response.ok) {
    throw new HarnessRpcError('plugin-control', payload?.error ?? `Plugin control returned HTTP ${response.status}`)
  }
  return payload as T
}

export const harnessApi = {
  describe: (signal?: AbortSignal) => rpc<HostDescription>('host.describe', {}, signal),
  sessions: (signal?: AbortSignal) =>
    rpc<{ items: SessionSummary[] }>('session.list', {}, signal),
  workspaces: (signal?: AbortSignal) =>
    rpc<{ items: WorkspaceSummary[]; archivedSessionIds: string[] }>('workspace.list', {}, signal),
  createWorkspace: (path: string) =>
    rpc<WorkspaceCreateResult>('workspace.create', { path }),
  pickDirectory: () => window.dshDesktop === undefined
    ? rpc<{ path: string | null }>('host.pickDirectory', {}).then(result => result.path)
    : window.dshDesktop.pickDirectory(),
  history: (sessionId: string, signal?: AbortSignal) =>
    rpc<HistoryPage>('session.history', { sessionId, maxMessages: 100 }, signal),
  historyPage: (sessionId: string, beforeSeq?: number, signal?: AbortSignal) =>
    rpc<HistoryPage>('session.history', {
      sessionId,
      maxMessages: 100,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    }, signal),
  searchSessions: (query: string, signal?: AbortSignal) =>
    rpc<{ items: SessionSearchHit[]; hasMore: boolean }>('session.search', { query }, signal),
  renameSession: (sessionId: string, title: string) =>
    rpc<{ title: string; seq: number }>('session.rename', { sessionId, title }),
  forkSession: (sessionId: string, atSeq?: number) =>
    rpc<{ sessionId: string }>('session.fork', {
      sessionId,
      ...(atSeq === undefined ? {} : { atSeq }),
    }),
  readAttachment: (sessionId: string, attachmentId: string, signal?: AbortSignal) =>
    rpc<{ attachment: ImageAttachmentRef; data: string }>('session.attachment', { sessionId, attachmentId }, signal),
  exportSession: async (sessionId: string, includeDescendants = false): Promise<SessionExportResult> => {
    const query = new URLSearchParams({ sessionId })
    if (includeDescendants) query.set('includeDescendants', 'true')
    if (window.dshDesktop !== undefined) return window.dshDesktop.exportSession(sessionId, includeDescendants)
    const response = await fetch(`/api/session.export?${query.toString()}`)
    if (!response.ok) throw new HarnessRpcError('transport', `Host returned HTTP ${response.status}`)
    const blob = await response.blob()
    const disposition = response.headers.get('content-disposition')
    const filename = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? `dsh-session-${sessionId}.zip`
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    return { canceled: false, filename }
  },
  updateQueue: (sessionId: string, itemId: string, action: { kind: 'remove' | 'steer' } | { kind: 'edit'; content: PromptContentPart[] }) =>
    rpc<{ accepted: true }>('session.updateQueue', { sessionId, itemId, action }),
  models: (sessionId: string, signal?: AbortSignal) =>
    rpc<SessionModels>('session.models', { sessionId }, signal),
  createSession: (options: { workspaceId?: string; cwd?: string; agentPreset?: string }) =>
    rpc<{ sessionId: string; agentPreset?: string }>('session.create', options),
  openPath: (path: string) => rpc<{ opened: true }>('host.openPath', { path }),
  renameWorkspace: (workspaceId: string, title: string) =>
    rpc<{ workspace: WorkspaceSummary }>('workspace.rename', { workspaceId, title }),
  moveWorkspace: (workspaceId: string, beforeWorkspaceId?: string) =>
    rpc<{ workspaceIds: string[] }>('workspace.insertBefore', {
      workspaceId,
      ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
    }),
  moveSession: (workspaceId: string, sessionId: string, beforeSessionId?: string) =>
    rpc<{ workspace: WorkspaceSummary }>('workspace.insertSessionBefore', {
      workspaceId,
      sessionId,
      ...(beforeSessionId === undefined ? {} : { beforeSessionId }),
    }),
  deleteWorkspace: (workspaceId: string) =>
    rpc<{ deleted: true }>('workspace.delete', { workspaceId }),
  archiveSession: (sessionId: string) =>
    rpc<{ archivedSessionIds: string[] }>('workspace.archiveSession', { sessionId }),
  skills: (sessionId: string, signal?: AbortSignal) =>
    rpc<{ skills: SkillEntry[] }>('skill.list', { sessionId }, signal),
  subagents: (parentSessionId: string, signal?: AbortSignal) =>
    rpc<SubagentCatalog>('subagent.list', { parentSessionId }, signal),
  subagentHistory: (payload: {
    parentSessionId: string
    childSessionId: string
    mode: 'one-shot' | 'continuable'
    beforeSeq?: number
  }, signal?: AbortSignal) => rpc<HistoryPage>('subagent.history', {
    ...payload,
    maxMessages: 100,
  }, signal),
  subagentPrompt: (payload: { parentSessionId: string; childSessionId: string; text: string }) =>
    rpc<{ messageId: string }>('subagent.prompt', {
      parentSessionId: payload.parentSessionId,
      childSessionId: payload.childSessionId,
      mode: 'continuable',
      content: [{ type: 'text', text: payload.text }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  subagentInterrupt: (parentSessionId: string, childSessionId: string) =>
    rpc<{ accepted: true }>('subagent.interrupt', {
      parentSessionId,
      childSessionId,
      mode: 'continuable',
    }),
  goalCreate: (sessionId: string, objective: string, maxGoalRounds?: number) =>
    rpc<{ ref: { id: string; revision: number } }>('goal.create', {
      sessionId,
      objective,
      ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }),
    }),
  goalEdit: (sessionId: string, ref: { id: string; revision: number }, objective?: string, maxGoalRounds?: number) =>
    rpc<{ ref: { id: string; revision: number } }>('goal.edit', {
      sessionId,
      ref,
      ...(objective === undefined ? {} : { objective }),
      ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }),
    }),
  goalPause: (sessionId: string, ref: { id: string; revision: number }) =>
    rpc<{ ref: { id: string; revision: number } }>('goal.pause', { sessionId, ref }),
  goalResume: (sessionId: string, ref: { id: string; revision: number }) =>
    rpc<{ ref: { id: string; revision: number } }>('goal.resume', { sessionId, ref }),
  goalComplete: (sessionId: string, ref: { id: string; revision: number }) =>
    rpc<{ ref: { id: string; revision: number } }>('goal.complete', { sessionId, ref }),
  goalClear: (sessionId: string, ref: { id: string; revision: number }) =>
    rpc<{ cleared: true }>('goal.clear', { sessionId, ref }),
  agentPresets: (signal?: AbortSignal) =>
    rpc<AgentPresetRoster>('agentPreset.list', {}, signal),
  selectAgentPreset: (sessionId: string, agentPreset: string) =>
    rpc<{ agentPreset: string }>('agentPreset.select', { sessionId, agentPreset }),
  readAgentPreset: (agentPreset: string) =>
    rpc<AgentPresetDocument>('agentPreset.read', { agentPreset }),
  copyAgentPreset: (from: string, agentPreset: string, name?: string) =>
    rpc<{ agentPreset: string }>('agentPreset.copy', {
      from,
      agentPreset,
      ...(name === undefined ? {} : { name }),
    }),
  openAgentPreset: (agentPreset: string) =>
    rpc<AgentPresetOpenResult>('agentPreset.openDocument', { agentPreset }),
  removeAgentPreset: (agentPreset: string) =>
    rpc<Record<string, never>>('agentPreset.remove', { agentPreset }),
  describeSettings: (signal?: AbortSignal) =>
    rpc<SettingsDescription>('settings.describe', {}, signal),
  mutateSettings: (ns: string, ops: SettingsPathOpView[], expectedRevision?: number) =>
    rpc<SettingsNamespaceView>('settings.mutate', {
      ns,
      ops,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }),
  replaceSettings: (ns: string, section: object, expectedRevision?: number) =>
    rpc<SettingsNamespaceView>('settings.replace', {
      ns,
      section,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }),
  updateAgentPresetDefault: (agentPreset: string, expectedRevision?: number) =>
    rpc<SettingsNamespaceView>('settings.update', {
      ns: 'agent-presets',
      patch: { default: agentPreset },
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }),
  openSettingsDocument: () =>
    rpc<{ opened: true }>('settings.openDocument', {}),
  describeCredentials: (refs: string[]) =>
    rpc<{ credentials: Record<string, CredentialView> }>('credentials.describe', { refs }),
  setCredential: (ref: string, value: string) =>
    rpc<Record<string, never>>('credentials.set', { ref, value }),
  unsetCredential: (ref: string) =>
    rpc<Record<string, never>>('credentials.unset', { ref }),
  llmProviders: (signal?: AbortSignal) =>
    rpc<{ providers: ConfigurableProviderView[] }>('llm.providers', {}, signal),
  llmModels: (signal?: AbortSignal) =>
    rpc<HostModelCatalog>('llm.models', {}, signal),
  discoverModels: (payload: {
    settingsNs: string
    provider?: string
    baseURL?: string
    api?: string
    apiKey?: string
  }) => rpc<{ models: DiscoveredModelView[] }>('llm.discoverModels', payload),
  prompt: (sessionId: string, content: PromptContentPart[], mode: 'queue' | 'steer' = 'queue') => rpc<{ accepted: true }>('session.prompt', {
    sessionId,
    mode,
    content,
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
  cancel: (sessionId: string) => rpc<{ accepted: true }>('session.cancel', { sessionId }),
  selectModel: (sessionId: string, provider: string, model: string, reasoningEffort?: string) =>
    rpc<{ selected: { provider: string; model: string; reasoningEffort?: string } }>(
      'session.selectModel',
      { sessionId, provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) },
    ),
  setPermission: (sessionId: string, preset: string, mode: 'queue' | 'steer' = 'queue') =>
    rpc<{ accepted: true }>('session.prompt', {
      sessionId,
      mode,
      content: [{ type: 'text', text: `/permission ${preset}` }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  respond: async (rpcId: string, result: unknown): Promise<{ accepted: boolean; reason?: string }> => {
    if (window.dshDesktop !== undefined) return window.dshDesktop.respond(rpcId, result)
    const response = await fetch('/api/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-response', rpcId, result }),
    })
    if (!response.ok) throw new HarnessRpcError('transport', `Host returned HTTP ${response.status}`)
    return await response.json() as { accepted: boolean; reason?: string }
  },
  plugins: (signal?: AbortSignal) =>
    window.dshDesktop === undefined
      ? controlRequest<PluginControlSnapshot>('/workbench/plugins', { signal })
      : withAbort(window.dshDesktop.plugins(), signal),
  togglePlugin: (entryId: string, enabled: boolean) =>
    window.dshDesktop === undefined
      ? controlRequest<PluginToggleResult>('/workbench/plugins/toggle', {
          method: 'POST',
          headers: { 'x-dsh-workbench': '1' },
          body: JSON.stringify({ entryId, enabled }),
        })
      : window.dshDesktop.togglePlugin(entryId, enabled),
}

export const codexApi = {
  catalog: (refresh = false): Promise<CodexCatalog> => window.dshDesktop === undefined
    ? Promise.resolve({
        available: false,
        authenticatedWith: 'ChatGPT',
        models: [],
        error: 'Codex CLI integration is available in the packaged desktop app.',
      })
    : window.dshDesktop.codexCatalog(refresh),
  usage: (): Promise<CodexUsageSnapshot> => window.dshDesktop === undefined
    ? Promise.resolve({
        available: false,
        rateLimits: [],
        dailyUsageBuckets: [],
        updatedAt: Date.now(),
        error: 'Codex usage is available in the packaged desktop app.',
      })
    : window.dshDesktop.codexUsage(),
  prompt: (payload: {
    sessionId: string
    threadId?: string
    cwd: string
    model: string
    effort: string
    permission: string
    network: import('./types.ts').EffectiveNetworkMode
    prompt: string
    context?: import('./types.ts').ProviderHandoffMessage[]
  }): Promise<CodexPromptResult> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Codex CLI requires the desktop app'))
    return window.dshDesktop.codexPrompt(payload)
  },
  readThread: (threadId: string): Promise<CodexThreadSnapshot> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Codex CLI requires the desktop app'))
    return window.dshDesktop.codexReadThread(threadId)
  },
  steer: (threadId: string, turnId: string, prompt: string): Promise<import('./types.ts').CodexSteerResult> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Codex CLI requires the desktop app'))
    return window.dshDesktop.codexSteer(threadId, turnId, prompt)
  },
  interrupt: (threadId: string, turnId: string): Promise<void> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Codex CLI requires the desktop app'))
    return window.dshDesktop.codexInterrupt(threadId, turnId)
  },
  respondApproval: (requestId: string | number, decision: import('./types.ts').CodexApprovalDecision): Promise<void> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Codex CLI requires the desktop app'))
    return window.dshDesktop.codexRespondApproval(requestId, decision)
  },
}

export const terminalApi = {
  run: (input: { id: string; cwd: string; command: string }): Promise<{ accepted: true }> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Terminal requires the desktop app'))
    return window.dshDesktop.terminalRun(input)
  },
  stop: (id: string): Promise<void> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Terminal requires the desktop app'))
    return window.dshDesktop.terminalStop(id)
  },
  changeDirectory: (cwd: string, target: string): Promise<string> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Terminal requires the desktop app'))
    return window.dshDesktop.terminalChangeDirectory(cwd, target)
  },
}

export function subscribeTerminal(onEvent: (event: TerminalEvent) => void): () => void {
  return window.dshDesktop?.onTerminalEvent(onEvent) ?? (() => {})
}

export const setupApi = {
  inspect: (): Promise<SetupSnapshot> => {
    if (window.dshDesktop === undefined) return Promise.resolve({
      platform: 'Linux',
      host: { online: false, managed: false, error: 'Setup is available in the packaged desktop app.' },
      node: { available: false, compatible: false },
    })
    return window.dshDesktop.setupInspect()
  },
  startHost: (): Promise<SetupSnapshot> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Host setup requires the desktop app'))
    return window.dshDesktop.setupStartHost()
  },
  stopHost: (): Promise<void> => window.dshDesktop?.setupStopHost() ?? Promise.resolve(),
  openExternal: (target: 'deepseek-key' | 'node' | 'codex-install'): Promise<void> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Setup links require the desktop app'))
    return window.dshDesktop.setupOpenExternal(target)
  },
  openCodexLogin: (): Promise<void> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Codex login requires the desktop app'))
    return window.dshDesktop.setupOpenCodexLogin()
  },
}

export function subscribeSetup(onEvent: (event: SetupEvent) => void): () => void {
  return window.dshDesktop?.onSetupEvent(onEvent) ?? (() => {})
}

export const reviewApi = {
  list: (input: { sessionId: string; cwd: string }): Promise<ReviewSnapshot> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Workspace review requires the desktop app'))
    return window.dshDesktop.reviewList(input)
  },
  directory: (input: { sessionId: string; cwd: string; path: string }): Promise<ReviewDirectorySnapshot> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Workspace review requires the desktop app'))
    return window.dshDesktop.reviewDirectory(input)
  },
  read: (input: { sessionId: string; cwd: string; path: string }): Promise<ReviewDocument> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Workspace review requires the desktop app'))
    return window.dshDesktop.reviewRead(input)
  },
  write: (input: { sessionId: string; cwd: string; path: string; content: string; expectedHash: string }): Promise<ReviewDocument> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Workspace review requires the desktop app'))
    return window.dshDesktop.reviewWrite(input)
  },
  open: (input: { sessionId: string; cwd: string; path: string }): Promise<{ opened: true }> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Opening workspace files requires the desktop app'))
    return window.dshDesktop.reviewOpen(input)
  },
}

export const agentWorkspaceApi = {
  ensure: (input: { parentSessionId: string; cwd: string; agentId: string }) => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Agent worktrees require the desktop app'))
    return window.dshDesktop.agentWorkspace(input)
  },
}

export const billingApi = {
  deepSeek: (): Promise<DeepSeekBillingSnapshot> => window.dshDesktop === undefined
    ? Promise.resolve({
        configured: false,
        writable: false,
        balances: [],
        updatedAt: Date.now(),
        error: 'Secure billing credentials are available in the packaged desktop app.',
      })
    : window.dshDesktop.deepSeekBilling(),
  setDeepSeekKey: (value: string): Promise<DeepSeekBillingSnapshot> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Secure billing credentials require the desktop app'))
    return window.dshDesktop.setDeepSeekBillingKey(value)
  },
  removeDeepSeekKey: (): Promise<DeepSeekBillingSnapshot> => {
    if (window.dshDesktop === undefined) return Promise.reject(new Error('Secure billing credentials require the desktop app'))
    return window.dshDesktop.removeDeepSeekBillingKey()
  },
}

export function subscribeCodex(onEvent: (event: CodexEvent) => void): () => void {
  return window.dshDesktop?.onCodexEvent(onEvent) ?? (() => {})
}

type DownlinkState = 'connecting' | 'connected' | 'reconnecting'

/**
 * Subscribe to both Host downlinks. Payloads are deliberately treated as
 * invalidation hints: the GUI refreshes authoritative unary projections and
 * never attempts to reimplement the Harness event fold.
 */
export function subscribeDownlinks(
  onFrame: (frame: DownlinkFrame) => void,
  onState: (state: DownlinkState) => void,
): () => void {
  if (window.dshDesktop !== undefined) {
    let active = true
    const stopFrames = window.dshDesktop.onDownlink(onFrame)
    const stopState = window.dshDesktop.onConnectionState(onState)
    void window.dshDesktop.connectionState().then(state => {
      if (active) onState(state)
    }).catch(() => {
      if (active) onState('reconnecting')
    })
    return () => {
      active = false
      stopFrames()
      stopState()
    }
  }

  const paths = ['/api/events.mux', '/api/events.host'] as const
  const sockets = new Map<string, WebSocket>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const open = new Set<string>()
  let active = true
  let retry = 0

  const publishState = (): void => {
    if (open.size === paths.length) {
      retry = 0
      onState('connected')
      return
    }
    onState(retry === 0 ? 'connecting' : 'reconnecting')
  }

  const connect = (path: string): void => {
    if (!active) return
    const url = new URL(path, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    sockets.set(path, socket)

    socket.addEventListener('open', () => {
      if (!active) return
      open.add(path)
      publishState()
    })
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      try {
        const envelope = JSON.parse(event.data) as { rpcId?: string; payload?: DownlinkFrame }
        if (envelope.payload !== undefined) onFrame({
          ...envelope.payload,
          ...(typeof envelope.rpcId === 'string' ? { __rpcId: envelope.rpcId } : {}),
        })
      } catch {
        // A malformed optional downlink frame must not take down the GUI.
      }
    })
    socket.addEventListener('close', () => {
      open.delete(path)
      if (!active) return
      retry += 1
      publishState()
      const delay = Math.min(5_000, 400 * 2 ** Math.min(retry, 4))
      timers.set(path, setTimeout(() => connect(path), delay))
    })
    socket.addEventListener('error', () => socket.close())
  }

  onState('connecting')
  paths.forEach(connect)

  return () => {
    active = false
    timers.forEach(clearTimeout)
    sockets.forEach(socket => socket.close())
    timers.clear()
    sockets.clear()
    open.clear()
  }
}
