import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import WebSocket from 'ws'
import { PluginController, resolveHostOrigin } from '../server/plugin-control.ts'
import { CodexAppServer } from './codex-app-server.ts'
import { DeepSeekBillingService } from './deepseek-billing.ts'
import { assertDesktopRpcPayload } from './rpc-policy.ts'
import type { ProviderHandoffMessage } from '../src/lib/types.ts'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting'

interface RpcEnvelope<T> {
  rpcId?: string
  result?:
    | { ok: true; value: T }
    | { ok: false; error: { code?: string; message?: string } }
}

const APP_SCHEME = 'dsh-workbench'
const APP_ORIGIN = `${APP_SCHEME}://app`
const HOST_ORIGIN = resolveHostOrigin()
const ALLOWED_RPC_METHODS = new Set([
  'host.describe',
  'host.openPath',
  'session.list',
  'session.search',
  'workspace.list',
  'workspace.create',
  'workspace.rename',
  'workspace.insertBefore',
  'workspace.insertSessionBefore',
  'workspace.delete',
  'workspace.archiveSession',
  'session.history',
  'session.attachment',
  'session.updateQueue',
  'session.rename',
  'session.fork',
  'session.models',
  'session.create',
  'session.prompt',
  'session.cancel',
  'session.selectModel',
  'subagent.list',
  'subagent.history',
  'subagent.prompt',
  'subagent.interrupt',
  'skill.list',
  'goal.create',
  'goal.edit',
  'goal.pause',
  'goal.resume',
  'goal.complete',
  'goal.clear',
  'agentPreset.list',
  'agentPreset.select',
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'settings.describe',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'settings.openDocument',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.providers',
  'llm.models',
  'llm.discoverModels',
])

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.woff2', 'font/woff2'],
])

const LOCAL_FONT_FILES = new Map([
  ['/local-font/workbench-sans-roman.ttf', '/Applications/Claude.app/Contents/Resources/fonts/AnthropicSans-Romans-Variable-25x258.ttf'],
  ['/local-font/workbench-sans-italic.ttf', '/Applications/Claude.app/Contents/Resources/fonts/AnthropicSans-Italics-Variable-25x258.ttf'],
  ['/local-font/workbench-serif-roman.ttf', '/Applications/Claude.app/Contents/Resources/fonts/AnthropicSerif-Romans-Variable-25x258.ttf'],
  ['/local-font/workbench-serif-italic.ttf', '/Applications/Claude.app/Contents/Resources/fonts/AnthropicSerif-Italics-Variable-25x258.ttf'],
])

protocol.registerSchemesAsPrivileged([{
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
  },
}])

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  try {
    if (event.senderFrame === null) return false
    const sender = new URL(event.senderFrame.url)
    return sender.protocol === `${APP_SCHEME}:` && sender.hostname === 'app'
  } catch {
    return false
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) throw new Error('Rejected IPC from an untrusted renderer')
}

async function hostRpc<T>(method: string, payload: unknown): Promise<T> {
  if (!ALLOWED_RPC_METHODS.has(method)) throw new Error(`Desktop bridge does not allow RPC method ${method}`)
  assertDesktopRpcPayload(method, payload)
  const id = `desktop-${randomUUID()}`
  const response = await fetch(`${HOST_ORIGIN}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: HOST_ORIGIN,
    },
    body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload }),
  })
  if (!response.ok) throw new Error(`Harness Host returned HTTP ${response.status}`)
  const envelope = await response.json() as RpcEnvelope<T>
  if (envelope.rpcId !== id || envelope.result === undefined) {
    throw new Error('Harness Host returned an invalid RPC envelope')
  }
  if (!envelope.result.ok) {
    throw new Error(`${envelope.result.error.code ?? 'HOST_ERROR'}: ${envelope.result.error.message ?? 'Harness RPC failed'}`)
  }
  return envelope.result.value
}

async function hostRespond(rpcId: string, result: unknown): Promise<{ accepted: boolean; reason?: string }> {
  const response = await fetch(`${HOST_ORIGIN}/api/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: HOST_ORIGIN },
    body: JSON.stringify({ type: 'client-response', rpcId, result }),
  })
  if (!response.ok) throw new Error(`Harness Host returned HTTP ${response.status}`)
  return await response.json() as { accepted: boolean; reason?: string }
}

class DownlinkClient {
  private readonly sockets = new Map<string, WebSocket>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly openPaths = new Set<string>()
  private active = false
  private retries = 0
  private currentState: ConnectionState = 'connecting'

  constructor(private readonly window: BrowserWindow) {}

  state(): ConnectionState {
    return this.currentState
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.setState('connecting')
    this.connect('/api/events.mux')
    this.connect('/api/events.host')
  }

  stop(): void {
    this.active = false
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    this.sockets.forEach(socket => socket.close())
    this.sockets.clear()
    this.openPaths.clear()
  }

  private setState(state: ConnectionState): void {
    this.currentState = state
    if (!this.window.isDestroyed()) this.window.webContents.send('dsh:connection-state', state)
  }

  private publishState(): void {
    if (this.openPaths.size === 2) {
      this.retries = 0
      this.setState('connected')
      return
    }
    this.setState(this.retries === 0 ? 'connecting' : 'reconnecting')
  }

  private connect(path: string): void {
    if (!this.active) return
    const target = new URL(path, HOST_ORIGIN)
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(target, { headers: { origin: HOST_ORIGIN } })
    this.sockets.set(path, socket)

    socket.on('open', () => {
      if (!this.active) return
      this.openPaths.add(path)
      this.publishState()
    })
    socket.on('message', data => {
      if (!this.active || this.window.isDestroyed()) return
      try {
        const envelope = JSON.parse(data.toString()) as { rpcId?: string; payload?: unknown }
        if (envelope.payload !== undefined && typeof envelope.payload === 'object' && envelope.payload !== null) {
          this.window.webContents.send('dsh:downlink', {
            ...envelope.payload as Record<string, unknown>,
            ...(typeof envelope.rpcId === 'string' ? { __rpcId: envelope.rpcId } : {}),
          })
        }
      } catch {
        // Optional malformed downlinks are ignored; unary projections stay authoritative.
      }
    })
    socket.on('close', () => {
      this.openPaths.delete(path)
      this.sockets.delete(path)
      if (!this.active) return
      this.retries += 1
      this.publishState()
      const delay = Math.min(5_000, 400 * 2 ** Math.min(this.retries, 4))
      this.timers.set(path, setTimeout(() => this.connect(path), delay))
    })
    socket.on('error', () => socket.close())
  }
}

function safeAssetPath(pathname: string): string | undefined {
  const rendererRoot = join(app.getAppPath(), 'dist')
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const candidate = normalize(join(rendererRoot, requested))
  const fromRoot = relative(rendererRoot, candidate)
  if (fromRoot.startsWith('..') || fromRoot.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) return undefined
  return candidate
}

async function installAppProtocol(): Promise<void> {
  await protocol.handle(APP_SCHEME, async request => {
    const url = new URL(request.url)
    const localFont = LOCAL_FONT_FILES.get(url.pathname)
    if (localFont !== undefined) {
      try {
        const body = await readFile(localFont)
        return new Response(body, {
          headers: {
            'content-type': 'font/ttf',
            'cache-control': 'private, max-age=86400',
          },
        })
      } catch {
        return new Response('Local UI font is unavailable', { status: 404 })
      }
    }
    const filename = safeAssetPath(url.pathname)
    if (filename === undefined) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(filename)
      return new Response(body, {
        headers: {
          'content-type': MIME_TYPES.get(extname(filename)) ?? 'application/octet-stream',
          'cache-control': filename.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('IPC payload must be an object')
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} must be a non-empty string`)
  return value
}

function requestIdentifier(value: unknown): string | number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Codex request identifier is invalid')
  return value
}

function optionalHandoffMessages(value: unknown): ProviderHandoffMessage[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 24) throw new Error('Codex handoff context is invalid')
  let chars = 0
  const messages = value.map(raw => {
    const item = object(raw)
    const role = item['role']
    const text = requiredString(item['text'], 'Codex handoff text')
    const seq = item['seq']
    if ((role !== 'user' && role !== 'assistant') || !Number.isSafeInteger(seq) || (seq as number) < 0) {
      throw new Error('Codex handoff context is invalid')
    }
    chars += text.length
    return { role: role as ProviderHandoffMessage['role'], text, seq: seq as number }
  })
  if (chars > 24_000) throw new Error('Codex handoff context is too large')
  return messages
}

type SessionMenuAction =
  | 'toggle-pin'
  | 'rename'
  | 'archive'
  | 'delete'
  | 'toggle-unread'
  | 'reveal'
  | 'copy-working-directory'
  | 'copy-session-id'
  | 'copy-deeplink'
  | 'fork'
  | 'export'
  | 'open-new-window'

type WorkspaceMenuAction =
  | 'new-session'
  | 'rename'
  | 'reveal'
  | 'copy-working-directory'
  | 'open-new-window'
  | 'remove'

function popupActionMenu<T extends string>(
  event: IpcMainInvokeEvent,
  items: Array<{ id: T; label: string; enabled?: boolean } | 'separator'>,
): Promise<T | null> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (parent === null) return Promise.resolve(null)
  return new Promise(resolve => {
    let settled = false
    const finish = (action: T | null): void => {
      if (settled) return
      settled = true
      resolve(action)
    }
    const menu = Menu.buildFromTemplate(items.map(item => item === 'separator'
      ? { type: 'separator' as const }
      : {
          label: item.label,
          enabled: item.enabled ?? true,
          click: () => finish(item.id),
        }))
    menu.popup({ window: parent, callback: () => finish(null) })
  })
}

function sessionDeeplink(sessionId: string): string {
  return `${APP_SCHEME}://session/${encodeURIComponent(sessionId)}`
}

function sessionIdFromDeeplink(value: string): string | undefined {
  try {
    const target = new URL(value)
    if (target.protocol !== `${APP_SCHEME}:` || target.hostname !== 'session') return undefined
    const sessionId = decodeURIComponent(target.pathname.replace(/^\/+/, ''))
    return sessionId !== '' && sessionId.length <= 1_024 ? sessionId : undefined
  } catch {
    return undefined
  }
}

function exportFilename(sessionId: string): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '-')
  return `dsh-session-${safeId}.zip`
}

async function exportSessionLog(sessionId: string, includeDescendants: boolean): Promise<{ canceled: boolean; path?: string; filename?: string }> {
  const filename = exportFilename(sessionId)
  const result = await dialog.showSaveDialog({
    title: 'Export session log',
    defaultPath: join(app.getPath('downloads'), filename),
    buttonLabel: 'Export',
    filters: [{ name: 'Session archive', extensions: ['zip'] }],
  })
  if (result.canceled || result.filePath === undefined) return { canceled: true }
  const query = new URLSearchParams({ sessionId })
  if (includeDescendants) query.set('includeDescendants', 'true')
  const response = await fetch(`${HOST_ORIGIN}/api/session.export?${query.toString()}`, {
    headers: { origin: HOST_ORIGIN },
  })
  if (!response.ok) throw new Error(`Harness Host returned HTTP ${response.status}`)
  await writeFile(result.filePath, Buffer.from(await response.arrayBuffer()))
  return { canceled: false, path: result.filePath, filename }
}

async function assertCodexWorkspace(sessionId: string, cwd: string): Promise<void> {
  const [sessionPage, workspacePage] = await Promise.all([
    hostRpc<{ items: Array<{ sessionId: string; cwd?: string }> }>('session.list', {}),
    hostRpc<{ items: Array<{ path: string; sessionIds: string[] }> }>('workspace.list', {}),
  ])
  const session = sessionPage.items.find(candidate => candidate.sessionId === sessionId)
  if (session === undefined) throw new Error('Codex session is not present in the local Harness Host')
  const allowed = new Set<string>()
  if (session.cwd !== undefined) allowed.add(session.cwd)
  workspacePage.items.forEach(workspace => {
    if (workspace.sessionIds.includes(sessionId)) allowed.add(workspace.path)
  })
  if (!allowed.has(cwd)) throw new Error('Codex working directory is not owned by the selected Harness session')
}

function installIpc(
  controller: PluginController,
  codex: CodexAppServer,
  billing: DeepSeekBillingService,
  downlinks: (event: IpcMainInvokeEvent) => DownlinkClient | undefined,
): void {
  ipcMain.handle('dsh:rpc', async (event, method: unknown, payload: unknown) => {
    assertTrustedSender(event)
    if (typeof method !== 'string') throw new Error('RPC method must be a string')
    return hostRpc(method, payload)
  })
  ipcMain.handle('dsh:respond', async (event, rpcId: unknown, result: unknown) => {
    assertTrustedSender(event)
    return hostRespond(requiredString(rpcId, 'rpcId'), result)
  })
  ipcMain.handle('dsh:export-session', async (event, sessionId: unknown, includeDescendants: unknown) => {
    assertTrustedSender(event)
    if (typeof includeDescendants !== 'boolean') throw new Error('includeDescendants must be a boolean')
    return exportSessionLog(requiredString(sessionId, 'sessionId'), includeDescendants)
  })
  ipcMain.handle('dsh:plugins', async event => {
    assertTrustedSender(event)
    return controller.list()
  })
  ipcMain.handle('dsh:toggle-plugin', async (event, entryId: unknown, enabled: unknown) => {
    assertTrustedSender(event)
    if (typeof entryId !== 'string' || typeof enabled !== 'boolean') throw new Error('Plugin toggle fields are invalid')
    return controller.toggle(entryId, enabled)
  })
  ipcMain.handle('dsh:connection-state', event => {
    assertTrustedSender(event)
    return downlinks(event)?.state() ?? 'connecting'
  })
  ipcMain.handle('dsh:pick-directory', async event => {
    assertTrustedSender(event)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Open Work Folder',
      buttonLabel: 'Open Folder',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = parent === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('dsh:show-session-menu', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const state = object(raw)
    if (typeof state['pinned'] !== 'boolean' || typeof state['unread'] !== 'boolean'
      || typeof state['archived'] !== 'boolean' || typeof state['running'] !== 'boolean'
      || (state['extended'] !== undefined && typeof state['extended'] !== 'boolean')) {
      throw new Error('Session menu state is invalid')
    }
    const extendedItems: Array<{ id: SessionMenuAction; label: string } | 'separator'> = state['extended'] === true
      ? [
          'separator',
          { id: 'fork', label: 'Fork chat' },
          { id: 'export', label: 'Export session log…' },
        ]
      : []
    return popupActionMenu<SessionMenuAction>(event, [
      { id: 'toggle-pin', label: state['pinned'] ? 'Unpin chat' : 'Pin chat' },
      { id: 'rename', label: 'Rename chat' },
      ...(state['archived'] === true ? [] : [{ id: 'archive' as const, label: 'Archive chat' }]),
      { id: 'toggle-unread', label: state['unread'] ? 'Mark as read' : 'Mark as unread' },
      'separator',
      { id: 'reveal', label: 'Reveal in Finder' },
      { id: 'copy-working-directory', label: 'Copy working directory' },
      { id: 'copy-session-id', label: 'Copy session ID' },
      { id: 'copy-deeplink', label: 'Copy deeplink' },
      ...extendedItems,
      'separator',
      { id: 'open-new-window', label: 'Open in new window' },
      'separator',
      { id: 'delete', label: 'Delete chat…', enabled: state['running'] !== true },
    ])
  })
  ipcMain.handle('dsh:show-workspace-menu', async event => {
    assertTrustedSender(event)
    return popupActionMenu<WorkspaceMenuAction>(event, [
      { id: 'new-session', label: 'New chat' },
      { id: 'rename', label: 'Rename work folder' },
      'separator',
      { id: 'reveal', label: 'Reveal in Finder' },
      { id: 'copy-working-directory', label: 'Copy working directory' },
      { id: 'open-new-window', label: 'Open in new window' },
      'separator',
      { id: 'remove', label: 'Remove from sidebar' },
    ])
  })
  ipcMain.handle('dsh:reveal-path', (event, value: unknown) => {
    assertTrustedSender(event)
    const path = requiredString(value, 'path')
    if (!isAbsolute(path)) throw new Error('Reveal path must be absolute')
    shell.showItemInFolder(path)
  })
  ipcMain.handle('dsh:copy-text', (event, value: unknown) => {
    assertTrustedSender(event)
    const text = requiredString(value, 'text')
    if (text.length > 16_384) throw new Error('Clipboard text is too long')
    clipboard.writeText(text)
  })
  ipcMain.handle('dsh:session-deeplink', (event, sessionId: unknown) => {
    assertTrustedSender(event)
    return sessionDeeplink(requiredString(sessionId, 'sessionId'))
  })
  ipcMain.handle('dsh:open-session-window', (event, sessionId: unknown) => {
    assertTrustedSender(event)
    createMainWindow(requiredString(sessionId, 'sessionId'))
  })
  ipcMain.handle('dsh:codex-catalog', async (event, refresh: unknown) => {
    assertTrustedSender(event)
    if (refresh !== undefined && typeof refresh !== 'boolean') throw new Error('Codex catalog refresh flag is invalid')
    return codex.catalog(refresh === true)
  })
  ipcMain.handle('dsh:codex-usage', async event => {
    assertTrustedSender(event)
    return codex.usage()
  })
  ipcMain.handle('dsh:deepseek-billing', async event => {
    assertTrustedSender(event)
    return billing.snapshot()
  })
  ipcMain.handle('dsh:set-deepseek-billing-key', async (event, value: unknown) => {
    assertTrustedSender(event)
    return billing.setKey(requiredString(value, 'DeepSeek API key'))
  })
  ipcMain.handle('dsh:remove-deepseek-billing-key', async event => {
    assertTrustedSender(event)
    return billing.removeKey()
  })
  ipcMain.handle('dsh:codex-prompt', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const payload = object(raw)
    const sessionId = requiredString(payload['sessionId'], 'sessionId')
    const cwd = requiredString(payload['cwd'], 'cwd')
    await assertCodexWorkspace(sessionId, cwd)
    return codex.prompt({
      sessionId,
      ...(payload['threadId'] === undefined ? {} : { threadId: requiredString(payload['threadId'], 'threadId') }),
      cwd,
      model: requiredString(payload['model'], 'model'),
      effort: requiredString(payload['effort'], 'effort'),
      permission: requiredString(payload['permission'], 'permission'),
      prompt: requiredString(payload['prompt'], 'prompt'),
      ...(payload['context'] === undefined ? {} : { context: optionalHandoffMessages(payload['context']) }),
    })
  })
  ipcMain.handle('dsh:codex-read-thread', async (event, threadId: unknown) => {
    assertTrustedSender(event)
    return codex.readThread(requiredString(threadId, 'threadId'))
  })
  ipcMain.handle('dsh:codex-interrupt', async (event, threadId: unknown, turnId: unknown) => {
    assertTrustedSender(event)
    await codex.interrupt(requiredString(threadId, 'threadId'), requiredString(turnId, 'turnId'))
  })
  ipcMain.handle('dsh:codex-respond-approval', (event, requestId: unknown, approved: unknown) => {
    assertTrustedSender(event)
    if (typeof approved !== 'boolean') throw new Error('Codex approval decision is invalid')
    codex.respondApproval(requestIdentifier(requestId), approved)
  })
}

const downlinkClients = new Map<number, DownlinkClient>()
const pendingDeeplinks: string[] = []

function createMainWindow(initialSessionId?: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 930,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: 'DeepSeek Harness',
    backgroundColor: '#e7e7e7',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 17 },
    webPreferences: {
      preload: join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  const downlinks = new DownlinkClient(window)
  const webContentsId = window.webContents.id
  downlinkClients.set(webContentsId, downlinks)

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'http:') void shell.openExternal(target.href)
    } catch {
      // Ignore malformed external targets.
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(APP_ORIGIN)) event.preventDefault()
  })
  window.webContents.on('before-input-event', (event, input) => {
    const commandKey = process.platform === 'darwin' ? input.meta : input.control
    if (input.type !== 'keyDown' || !commandKey || input.alt) return
    if (!input.shift && input.key === ',') {
      event.preventDefault()
      window.webContents.send('dsh:open-settings')
      return
    }
    if (input.shift && input.key.toLocaleLowerCase() === 'p') {
      event.preventDefault()
      window.webContents.send('dsh:open-plugins')
    }
  })
  window.webContents.on('did-finish-load', () => downlinks.start())
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    downlinks.stop()
    downlinkClients.delete(webContentsId)
  })
  const target = new URL(`${APP_ORIGIN}/index.html`)
  if (initialSessionId !== undefined) target.searchParams.set('sessionId', initialSessionId)
  void window.loadURL(target.href)

  return window
}

let codexServer: CodexAppServer | undefined

app.on('open-url', (event, url) => {
  event.preventDefault()
  const sessionId = sessionIdFromDeeplink(url)
  if (sessionId === undefined) return
  if (app.isReady()) createMainWindow(sessionId)
  else pendingDeeplinks.push(sessionId)
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  await installAppProtocol()
  const controller = new PluginController()
  const billing = new DeepSeekBillingService(join(app.getPath('userData'), 'billing-credentials.json'))
  codexServer = new CodexAppServer(event => {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('dsh:codex-event', event)
    })
  })
  installIpc(controller, codexServer, billing, event => downlinkClients.get(event.sender.id))
  app.setAsDefaultProtocolClient(APP_SCHEME)
  createMainWindow(pendingDeeplinks.shift())
  pendingDeeplinks.splice(0).forEach(sessionId => createMainWindow(sessionId))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length !== 0) return
    createMainWindow()
  })
}).catch(reason => {
  process.stderr.write(`DeepSeek Harness failed to start: ${reason instanceof Error ? reason.stack : String(reason)}\n`)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  codexServer?.shutdown()
  codexServer = undefined
})
