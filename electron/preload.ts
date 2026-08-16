import { contextBridge, ipcRenderer } from 'electron'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting'

contextBridge.exposeInMainWorld('dshDesktop', {
  runtime: 'electron',
  platform: process.platform,
  arch: process.arch,
  rpc: (method: string, payload: unknown) => ipcRenderer.invoke('dsh:rpc', method, payload),
  plugins: () => ipcRenderer.invoke('dsh:plugins'),
  togglePlugin: (entryId: string, enabled: boolean) => ipcRenderer.invoke('dsh:toggle-plugin', entryId, enabled),
  pickDirectory: () => ipcRenderer.invoke('dsh:pick-directory') as Promise<string | null>,
  showSessionMenu: (state: { pinned: boolean; unread: boolean; archived: boolean; running: boolean; extended?: boolean }) => ipcRenderer.invoke('dsh:show-session-menu', state),
  showWorkspaceMenu: () => ipcRenderer.invoke('dsh:show-workspace-menu'),
  revealPath: (path: string) => ipcRenderer.invoke('dsh:reveal-path', path),
  copyText: (text: string) => ipcRenderer.invoke('dsh:copy-text', text),
  sessionDeeplink: (sessionId: string) => ipcRenderer.invoke('dsh:session-deeplink', sessionId),
  openSessionWindow: (sessionId: string) => ipcRenderer.invoke('dsh:open-session-window', sessionId),
  respond: (rpcId: string, result: unknown) => ipcRenderer.invoke('dsh:respond', rpcId, result),
  exportSession: (sessionId: string, includeDescendants: boolean) => ipcRenderer.invoke('dsh:export-session', sessionId, includeDescendants),
  codexCatalog: (refresh?: boolean) => ipcRenderer.invoke('dsh:codex-catalog', refresh),
  codexUsage: () => ipcRenderer.invoke('dsh:codex-usage'),
  deepSeekBilling: () => ipcRenderer.invoke('dsh:deepseek-billing'),
  setDeepSeekBillingKey: (value: string) => ipcRenderer.invoke('dsh:set-deepseek-billing-key', value),
  removeDeepSeekBillingKey: () => ipcRenderer.invoke('dsh:remove-deepseek-billing-key'),
  codexPrompt: (payload: unknown) => ipcRenderer.invoke('dsh:codex-prompt', payload),
  codexReadThread: (threadId: string) => ipcRenderer.invoke('dsh:codex-read-thread', threadId),
  codexSteer: (threadId: string, turnId: string, prompt: string) => ipcRenderer.invoke('dsh:codex-steer', threadId, turnId, prompt),
  codexInterrupt: (threadId: string, turnId: string) => ipcRenderer.invoke('dsh:codex-interrupt', threadId, turnId),
  codexRespondApproval: (requestId: string | number, decision: string) => ipcRenderer.invoke('dsh:codex-respond-approval', requestId, decision),
  antigravityCatalog: (refresh?: boolean) => ipcRenderer.invoke('dsh:antigravity-catalog', refresh),
  antigravityPrompt: (payload: unknown) => ipcRenderer.invoke('dsh:antigravity-prompt', payload),
  antigravityReadThread: (conversationId: string) => ipcRenderer.invoke('dsh:antigravity-read-thread', conversationId),
  antigravityInterrupt: (conversationId: string, turnId: string) => ipcRenderer.invoke('dsh:antigravity-interrupt', conversationId, turnId),
  terminalRun: (input: unknown) => ipcRenderer.invoke('dsh:terminal-run', input),
  terminalStop: (id: string) => ipcRenderer.invoke('dsh:terminal-stop', id),
  terminalChangeDirectory: (cwd: string, target: string) => ipcRenderer.invoke('dsh:terminal-change-directory', cwd, target),
  setupInspect: () => ipcRenderer.invoke('dsh:setup-inspect'),
  setupStartHost: () => ipcRenderer.invoke('dsh:setup-start-host'),
  setupStopHost: () => ipcRenderer.invoke('dsh:setup-stop-host'),
  setupOpenExternal: (target: string) => ipcRenderer.invoke('dsh:setup-open-external', target),
  setupOpenCodexLogin: () => ipcRenderer.invoke('dsh:setup-open-codex-login'),
  reviewList: (input: unknown) => ipcRenderer.invoke('dsh:review-list', input),
  reviewDirectory: (input: unknown) => ipcRenderer.invoke('dsh:review-directory', input),
  reviewRead: (input: unknown) => ipcRenderer.invoke('dsh:review-read', input),
  reviewWrite: (input: unknown) => ipcRenderer.invoke('dsh:review-write', input),
  reviewOpen: (input: unknown) => ipcRenderer.invoke('dsh:review-open', input),
  agentWorkspace: (input: unknown) => ipcRenderer.invoke('dsh:agent-workspace', input),
  connectionState: () => ipcRenderer.invoke('dsh:connection-state') as Promise<ConnectionState>,
  onDownlink: (listener: (frame: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, frame: unknown): void => listener(frame)
    ipcRenderer.on('dsh:downlink', handler)
    return () => ipcRenderer.removeListener('dsh:downlink', handler)
  },
  onConnectionState: (listener: (state: ConnectionState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ConnectionState): void => listener(state)
    ipcRenderer.on('dsh:connection-state', handler)
    return () => ipcRenderer.removeListener('dsh:connection-state', handler)
  },
  onOpenPlugins: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('dsh:open-plugins', handler)
    return () => ipcRenderer.removeListener('dsh:open-plugins', handler)
  },
  onOpenSettings: (listener: () => void) => {
    const handler = (): void => listener()
    ipcRenderer.on('dsh:open-settings', handler)
    return () => ipcRenderer.removeListener('dsh:open-settings', handler)
  },
  onCodexEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on('dsh:codex-event', handler)
    return () => ipcRenderer.removeListener('dsh:codex-event', handler)
  },
  onAntigravityEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on('dsh:antigravity-event', handler)
    return () => ipcRenderer.removeListener('dsh:antigravity-event', handler)
  },
  onTerminalEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on('dsh:terminal-event', handler)
    return () => ipcRenderer.removeListener('dsh:terminal-event', handler)
  },
  onSetupEvent: (listener: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on('dsh:setup-event', handler)
    return () => ipcRenderer.removeListener('dsh:setup-event', handler)
  },
})
