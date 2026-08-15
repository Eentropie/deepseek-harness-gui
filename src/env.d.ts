import type {
  CodexCatalog,
  CodexEvent,
  CodexPromptResult,
  CodexThreadSnapshot,
  CodexUsageSnapshot,
  DeepSeekBillingSnapshot,
  DownlinkFrame,
  PluginControlSnapshot,
  PluginToggleResult,
  ReviewDocument,
  ReviewSnapshot,
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
    prompt: string
    context?: import('./lib/types.ts').ProviderHandoffMessage[]
  }) => Promise<CodexPromptResult>
  codexReadThread: (threadId: string) => Promise<CodexThreadSnapshot>
  codexInterrupt: (threadId: string, turnId: string) => Promise<void>
  codexRespondApproval: (requestId: string | number, approved: boolean) => Promise<void>
  terminalRun: (input: { id: string; cwd: string; command: string }) => Promise<{ accepted: true }>
  terminalStop: (id: string) => Promise<void>
  terminalChangeDirectory: (cwd: string, target: string) => Promise<string>
  setupInspect: () => Promise<SetupSnapshot>
  setupStartHost: () => Promise<SetupSnapshot>
  setupStopHost: () => Promise<void>
  setupOpenExternal: (target: 'deepseek-key' | 'node' | 'codex-install') => Promise<void>
  setupOpenCodexLogin: () => Promise<void>
  reviewList: (input: { sessionId: string; cwd: string }) => Promise<ReviewSnapshot>
  reviewRead: (input: { sessionId: string; cwd: string; path: string }) => Promise<ReviewDocument>
  reviewWrite: (input: { sessionId: string; cwd: string; path: string; content: string; expectedHash: string }) => Promise<ReviewDocument>
  connectionState: () => Promise<DesktopConnectionState>
  onDownlink: (listener: (frame: DownlinkFrame) => void) => () => void
  onConnectionState: (listener: (state: DesktopConnectionState) => void) => () => void
  onOpenPlugins: (listener: () => void) => () => void
  onOpenSettings: (listener: () => void) => () => void
  onCodexEvent: (listener: (event: CodexEvent) => void) => () => void
  onTerminalEvent: (listener: (event: TerminalEvent) => void) => () => void
  onSetupEvent: (listener: (event: SetupEvent) => void) => () => void
}

declare global {
  interface Window {
    dshDesktop?: DeepSeekDesktopBridge
  }
}

export {}
