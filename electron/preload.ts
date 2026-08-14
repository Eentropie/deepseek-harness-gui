import { contextBridge, ipcRenderer } from 'electron'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting'

contextBridge.exposeInMainWorld('dshDesktop', {
  runtime: 'electron',
  rpc: (method: string, payload: unknown) => ipcRenderer.invoke('dsh:rpc', method, payload),
  plugins: () => ipcRenderer.invoke('dsh:plugins'),
  togglePlugin: (entryId: string, enabled: boolean) => ipcRenderer.invoke('dsh:toggle-plugin', entryId, enabled),
  pickDirectory: () => ipcRenderer.invoke('dsh:pick-directory') as Promise<string | null>,
  respond: (rpcId: string, result: unknown) => ipcRenderer.invoke('dsh:respond', rpcId, result),
  exportSession: (sessionId: string, includeDescendants: boolean) => ipcRenderer.invoke('dsh:export-session', sessionId, includeDescendants),
  codexCatalog: () => ipcRenderer.invoke('dsh:codex-catalog'),
  codexPrompt: (payload: unknown) => ipcRenderer.invoke('dsh:codex-prompt', payload),
  codexReadThread: (threadId: string) => ipcRenderer.invoke('dsh:codex-read-thread', threadId),
  codexInterrupt: (threadId: string, turnId: string) => ipcRenderer.invoke('dsh:codex-interrupt', threadId, turnId),
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
})
