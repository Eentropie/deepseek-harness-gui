import type {
  CodexCatalog,
  CodexEvent,
  CodexPromptResult,
  CodexThreadSnapshot,
  DownlinkFrame,
  PluginControlSnapshot,
  PluginToggleResult,
  SessionExportResult,
} from './lib/types.ts'

type DesktopConnectionState = 'connecting' | 'connected' | 'reconnecting'

interface DeepSeekDesktopBridge {
  readonly runtime: 'electron'
  rpc: <T>(method: string, payload: unknown) => Promise<T>
  plugins: () => Promise<PluginControlSnapshot>
  togglePlugin: (entryId: string, enabled: boolean) => Promise<PluginToggleResult>
  pickDirectory: () => Promise<string | null>
  respond: (rpcId: string, result: unknown) => Promise<{ accepted: boolean; reason?: string }>
  exportSession: (sessionId: string, includeDescendants: boolean) => Promise<SessionExportResult>
  codexCatalog: () => Promise<CodexCatalog>
  codexPrompt: (payload: {
    sessionId: string
    threadId?: string
    cwd: string
    model: string
    effort: string
    prompt: string
  }) => Promise<CodexPromptResult>
  codexReadThread: (threadId: string) => Promise<CodexThreadSnapshot>
  codexInterrupt: (threadId: string, turnId: string) => Promise<void>
  connectionState: () => Promise<DesktopConnectionState>
  onDownlink: (listener: (frame: DownlinkFrame) => void) => () => void
  onConnectionState: (listener: (state: DesktopConnectionState) => void) => () => void
  onOpenPlugins: (listener: () => void) => () => void
  onOpenSettings: (listener: () => void) => () => void
  onCodexEvent: (listener: (event: CodexEvent) => void) => () => void
}

declare global {
  interface Window {
    dshDesktop?: DeepSeekDesktopBridge
  }
}

export {}
