import type {
  AntigravityCatalog,
  AntigravityEvent,
  AntigravityPermissionMode,
  AntigravityPromptResult,
  AntigravityThreadSnapshot,
  CodexCatalog,
  CodexEvent,
  CodexApprovalDecision,
  CodexPromptResult,
  CodexSteerResult,
  CodexThreadSnapshot,
  CodexUsageSnapshot,
  DeepSeekBillingSnapshot,
  DownlinkFrame,
  PluginControlSnapshot,
  PluginToggleResult,
  ReviewDocument,
  ReviewDirectorySnapshot,
  ReviewSnapshot,
  AgentWorkspaceResult,
  SessionExportResult,
  SetupEvent,
  SetupSnapshot,
  TerminalEvent,
} from './lib/types.ts'

type DesktopConnectionState = 'connecting' | 'connected' | 'reconnecting'
type SessionMenuAction = 'toggle-pin' | 'rename' | 'archive' | 'delete' | 'toggle-unread' | 'reveal' | 'copy-working-directory' | 'copy-session-id' | 'copy-deeplink' | 'fork' | 'export' | 'open-new-window'
type WorkspaceMenuAction = 'new-session' | 'rename' | 'reveal' | 'copy-working-directory' | 'open-new-window' | 'remove'

interface DeepSeekDesktopBridge {
  readonly runtime: 'electron'
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly arch: string
  rpc: <T>(method: string, payload: unknown) => Promise<T>
  plugins: () => Promise<PluginControlSnapshot>
  togglePlugin: (entryId: string, enabled: boolean) => Promise<PluginToggleResult>
  pickDirectory: () => Promise<string | null>
  showSessionMenu: (state: { pinned: boolean; unread: boolean; archived: boolean; running: boolean; extended?: boolean }) => Promise<SessionMenuAction | null>
  showWorkspaceMenu: () => Promise<WorkspaceMenuAction | null>
  revealPath: (path: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  sessionDeeplink: (sessionId: string) => Promise<string>
  openSessionWindow: (sessionId: string) => Promise<void>
  respond: (rpcId: string, result: unknown) => Promise<{ accepted: boolean; reason?: string }>
  exportSession: (sessionId: string, includeDescendants: boolean) => Promise<SessionExportResult>
  codexCatalog: (refresh?: boolean) => Promise<CodexCatalog>
  codexUsage: () => Promise<CodexUsageSnapshot>
  deepSeekBilling: () => Promise<DeepSeekBillingSnapshot>
  setDeepSeekBillingKey: (value: string) => Promise<DeepSeekBillingSnapshot>
  removeDeepSeekBillingKey: () => Promise<DeepSeekBillingSnapshot>
  codexPrompt: (payload: {
    sessionId: string
    threadId?: string
    cwd: string
    model: string
    effort: string
    permission: string
    network: import('./lib/types.ts').EffectiveNetworkMode
    prompt: string
    context?: import('./lib/types.ts').ProviderHandoffMessage[]
  }) => Promise<CodexPromptResult>
  codexReadThread: (threadId: string) => Promise<CodexThreadSnapshot>
  codexSteer: (threadId: string, turnId: string, prompt: string) => Promise<CodexSteerResult>
  codexInterrupt: (threadId: string, turnId: string) => Promise<void>
  codexRespondApproval: (requestId: string | number, decision: CodexApprovalDecision) => Promise<void>
  antigravityCatalog: (refresh?: boolean) => Promise<AntigravityCatalog>
  antigravityPrompt: (payload: {
    sessionId: string
    conversationId?: string
    cwd: string
    model: string
    effort: string
    permission: AntigravityPermissionMode
    network: import('./lib/types.ts').EffectiveNetworkMode
    prompt: string
    context?: import('./lib/types.ts').ProviderHandoffMessage[]
  }) => Promise<AntigravityPromptResult>
  antigravityReadThread: (conversationId: string) => Promise<AntigravityThreadSnapshot>
  antigravityInterrupt: (conversationId: string, turnId: string) => Promise<void>
  terminalRun: (input: { id: string; sessionId: string; cwd: string; command: string }) => Promise<{ accepted: true }>
  terminalStop: (id: string) => Promise<void>
  terminalChangeDirectory: (sessionId: string, cwd: string, target: string) => Promise<string>
  setupInspect: () => Promise<SetupSnapshot>
  setupStartHost: () => Promise<SetupSnapshot>
  setupStopHost: () => Promise<void>
  setupOpenExternal: (target: 'deepseek-key' | 'node' | 'codex-install' | 'antigravity-install') => Promise<void>
  setupOpenCodexLogin: () => Promise<void>
  reviewList: (input: { sessionId: string; cwd: string }) => Promise<ReviewSnapshot>
  reviewDirectory: (input: { sessionId: string; cwd: string; path: string }) => Promise<ReviewDirectorySnapshot>
  reviewRead: (input: { sessionId: string; cwd: string; path: string }) => Promise<ReviewDocument>
  reviewWrite: (input: { sessionId: string; cwd: string; path: string; content: string; expectedHash: string }) => Promise<ReviewDocument>
  reviewOpen: (input: { sessionId: string; cwd: string; path: string }) => Promise<{ opened: true }>
  agentWorkspace: (input: { parentSessionId: string; cwd: string; agentId: string }) => Promise<AgentWorkspaceResult>
  connectionState: () => Promise<DesktopConnectionState>
  onDownlink: (listener: (frame: DownlinkFrame) => void) => () => void
  onConnectionState: (listener: (state: DesktopConnectionState) => void) => () => void
  onOpenPlugins: (listener: () => void) => () => void
  onOpenSettings: (listener: () => void) => () => void
  onCodexEvent: (listener: (event: CodexEvent) => void) => () => void
  onAntigravityEvent: (listener: (event: AntigravityEvent) => void) => () => void
  onTerminalEvent: (listener: (event: TerminalEvent) => void) => () => void
  onSetupEvent: (listener: (event: SetupEvent) => void) => () => void
}

declare global {
  interface Window {
    dshDesktop?: DeepSeekDesktopBridge
  }
}

export {}
