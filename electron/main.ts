import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { homedir } from 'node:os'
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import WebSocket from 'ws'
import { PluginController, resolveHostOrigin } from '../server/plugin-control.ts'
import { CodexAppServer } from './codex-app-server.ts'
import { DeepSeekBillingService } from './deepseek-billing.ts'
import { assertDesktopRpcPayload } from './rpc-policy.ts'
import { SetupService } from './setup-service.ts'
import type { AgentWorkspaceResult, ProviderHandoffMessage, ReviewDirectorySnapshot, ReviewDocument, ReviewSnapshot } from '../src/lib/types.ts'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting'

interface TerminalProcess {
  owner: number
  child: ChildProcessWithoutNullStreams
}

const terminalProcesses = new Map<string, TerminalProcess>()

interface RpcEnvelope<T> {
  rpcId?: string
  result?:
    | { ok: true; value: T }
    | { ok: false; error: { code?: string; message?: string } }
}

const APP_SCHEME = 'dsh-workbench'
const APP_ORIGIN = `${APP_SCHEME}://app`
const HOST_ORIGIN = resolveHostOrigin()
const APP_NAME = 'DeepSeek Harness'

// Keep Electron's internal/runtime name aligned with the packaged product.
// The OS-level executable name is supplied by the branded package launcher.
app.setName(APP_NAME)
process.title = APP_NAME
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
const FILE_MANAGER_NAME = process.platform === 'win32' ? 'Explorer' : process.platform === 'darwin' ? 'Finder' : 'file manager'

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
  const agentRoom = agentRoomIdentity(sessionId)
  const sidechatRemainder = sessionId.startsWith('sidechat:') ? sessionId.slice('sidechat:'.length) : undefined
  const ownerSessionId = agentRoom?.parentSessionId
    ?? (sidechatRemainder === undefined ? sessionId : sidechatRemainder.split(':', 1)[0] ?? sidechatRemainder)
  const [sessionPage, workspacePage] = await Promise.all([
    hostRpc<{ items: Array<{ sessionId: string; cwd?: string }> }>('session.list', {}),
    hostRpc<{ items: Array<{ path: string; sessionIds: string[] }> }>('workspace.list', {}),
  ])
  const session = sessionPage.items.find(candidate => candidate.sessionId === ownerSessionId)
  if (session === undefined) throw new Error('Codex session is not present in the local Harness Host')
  const allowed = new Set<string>()
  if (session.cwd !== undefined) allowed.add(session.cwd)
  workspacePage.items.forEach(workspace => {
    if (workspace.sessionIds.includes(ownerSessionId)) allowed.add(workspace.path)
  })
  if (allowed.has(cwd)) return
  if (agentRoom !== undefined) {
    for (const candidate of allowed) {
      const expected = await agentWorktreePath(candidate, agentRoom.agentId).catch(() => undefined)
      if (expected !== undefined && resolve(cwd) === resolve(expected)) return
    }
  }
  throw new Error('Codex working directory is not owned by the selected Harness session')
}

async function canonicalTerminalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || path.length > 4_096) throw new Error('Terminal working directory must be an absolute path')
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isDirectory()) throw new Error('Terminal working directory is not a directory')
  return canonical
}

async function changeTerminalDirectory(cwd: string, rawTarget: string): Promise<string> {
  const base = await canonicalTerminalDirectory(cwd)
  const unquoted = rawTarget.trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
  const homeRelative = unquoted === '~'
    ? homedir()
    : /^~[\\/]/.test(unquoted)
      ? join(homedir(), unquoted.slice(2))
      : unquoted
  return canonicalTerminalDirectory(homeRelative === '' ? homedir() : resolve(base, homeRelative))
}

function terminalInvocation(command: string): { executable: string; args: string[] } {
  if (process.platform === 'win32') {
    return { executable: process.env['ComSpec'] ?? 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  const configured = process.env['SHELL']
  const executable = configured !== undefined && isAbsolute(configured)
    ? configured
    : process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  return { executable, args: ['-lc', command] }
}

function stopTerminalProcesses(owner: number): void {
  for (const [id, processRecord] of terminalProcesses) {
    if (processRecord.owner !== owner) continue
    processRecord.child.kill('SIGTERM')
    terminalProcesses.delete(id)
  }
}

async function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const executable = process.platform === 'darwin' ? '/usr/bin/git' : 'git'
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer): string => `${current}${chunk.toString()}`.slice(-8_000_000)
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
    child.once('error', reject)
    child.once('close', code => resolvePromise({ code: code ?? 1, stdout, stderr }))
  })
}

function agentRoomIdentity(sessionId: string): { parentSessionId: string; agentId: string } | undefined {
  if (!sessionId.startsWith('agent-room:')) return undefined
  const remainder = sessionId.slice('agent-room:'.length)
  const divider = remainder.indexOf(':')
  if (divider <= 0) return undefined
  const parentSessionId = remainder.slice(0, divider)
  const agentId = remainder.slice(divider + 1)
  if (!/^[a-zA-Z0-9._-]{1,256}$/.test(parentSessionId) || !/^[a-zA-Z0-9-]{1,96}$/.test(agentId)) return undefined
  return { parentSessionId, agentId }
}

async function gitRoot(cwd: string): Promise<string> {
  const canonical = await canonicalTerminalDirectory(cwd)
  const result = await git(canonical, ['rev-parse', '--show-toplevel'])
  if (result.code !== 0) throw new Error('Writable Agent Room agents require a Git workspace')
  return realpath(result.stdout.trim())
}

async function agentWorktreePath(cwd: string, agentId: string): Promise<string> {
  if (!/^[a-zA-Z0-9-]{1,96}$/.test(agentId)) throw new Error('Agent id is invalid')
  const root = await gitRoot(cwd)
  const workspaceKey = createHash('sha256').update(root).digest('hex').slice(0, 16)
  return join(app.getPath('userData'), 'agent-worktrees', workspaceKey, agentId)
}

async function ensureAgentWorktree(parentSessionId: string, cwd: string, agentId: string): Promise<AgentWorkspaceResult> {
  await assertCodexWorkspace(parentSessionId, cwd)
  const root = await gitRoot(cwd)
  const target = await agentWorktreePath(root, agentId)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  try {
    const existing = await realpath(target)
    const existingRoot = await git(existing, ['rev-parse', '--show-toplevel'])
    if (existingRoot.code === 0 && resolve(existingRoot.stdout.trim()) === resolve(existing)) {
      return { cwd: existing, isolated: true, reused: true }
    }
    throw new Error('The saved Agent Room worktree path is not a valid Git worktree')
  } catch (reason) {
    if (reason instanceof Error && reason.message === 'The saved Agent Room worktree path is not a valid Git worktree') throw reason
  }
  const created = await git(root, ['worktree', 'add', '--detach', target, 'HEAD'])
  if (created.code !== 0) throw new Error(`Could not create the Agent Room worktree: ${created.stderr.trim() || 'git worktree add failed'}`)
  return { cwd: await realpath(target), isolated: true, reused: false }
}

async function reviewEntryPath(cwd: string, requestedPath: string, allowRoot = false): Promise<{ root: string; target: string; path: string }> {
  if (requestedPath.includes('\0') || isAbsolute(requestedPath)) throw new Error('Review path must be relative to the work folder')
  const path = normalize(requestedPath.trim() === '' ? '.' : requestedPath).replaceAll('\\', '/')
  if (path === '..' || path.startsWith('../')) throw new Error('Review path leaves the work folder')
  const root = await realpath(cwd)
  const target = await realpath(resolve(root, path))
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    throw new Error('Review path resolves outside the work folder')
  }
  const displayPath = path === '.' ? '' : path
  if (!allowRoot && displayPath === '') throw new Error('Review requires a file inside the work folder')
  return { root, target, path: displayPath }
}

async function reviewFilePath(cwd: string, requestedPath: string): Promise<{ root: string; target: string; path: string }> {
  const resolved = await reviewEntryPath(cwd, requestedPath)
  const metadata = await stat(resolved.target)
  if (!metadata.isFile() || metadata.size > 2_000_000) throw new Error('Review supports text files up to 2 MB')
  return resolved
}

async function reviewDirectory(cwd: string, requestedPath: string): Promise<ReviewDirectorySnapshot> {
  const resolved = await reviewEntryPath(cwd, requestedPath, true)
  const metadata = await stat(resolved.target)
  if (!metadata.isDirectory()) throw new Error('Review tree path is not a directory')
  const rawEntries = await readdir(resolved.target, { withFileTypes: true })
  const entries: ReviewDirectorySnapshot['entries'] = []
  for (const entry of rawEntries) {
    let kind: 'directory' | 'file' | undefined
    let symlink = false
    if (entry.isDirectory()) kind = 'directory'
    else if (entry.isFile()) kind = 'file'
    else if (entry.isSymbolicLink()) {
      symlink = true
      try {
        const linked = await realpath(join(resolved.target, entry.name))
        const fromRoot = relative(resolved.root, linked)
        if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) continue
        const linkedMetadata = await stat(linked)
        if (linkedMetadata.isDirectory()) kind = 'directory'
        else if (linkedMetadata.isFile()) kind = 'file'
      } catch {
        continue
      }
    }
    if (kind === undefined) continue
    entries.push({
      name: entry.name,
      path: resolved.path === '' ? entry.name : `${resolved.path}/${entry.name}`,
      kind,
      hidden: entry.name.startsWith('.'),
      ...(symlink ? { symlink: true } : {}),
    })
  }
  entries.sort((left, right) => left.kind === right.kind
    ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    : left.kind === 'directory' ? -1 : 1)
  const limit = 1_000
  return { path: resolved.path, entries: entries.slice(0, limit), truncated: entries.length > limit }
}

async function openReviewFile(cwd: string, requestedPath: string): Promise<{ opened: true }> {
  const resolved = await reviewEntryPath(cwd, requestedPath)
  const metadata = await stat(resolved.target)
  if (!metadata.isFile()) throw new Error('Only files can be opened from the Review tree')
  const failure = await shell.openPath(resolved.target)
  if (failure !== '') throw new Error(failure)
  return { opened: true }
}

function contentHash(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function reviewDocument(cwd: string, requestedPath: string): Promise<ReviewDocument> {
  const resolved = await reviewFilePath(cwd, requestedPath)
  const content = await readFile(resolved.target)
  if (content.includes(0)) throw new Error('Binary files cannot be edited in Review')
  let diff = ''
  try {
    const againstHead = await git(resolved.root, ['diff', '--no-ext-diff', '--no-color', 'HEAD', '--', resolved.path])
    const fallback = againstHead.code === 0 ? againstHead : await git(resolved.root, ['diff', '--no-ext-diff', '--no-color', '--', resolved.path])
    if (fallback.code === 0) diff = fallback.stdout
  } catch {
    // Reading and editing still work outside Git repositories.
  }
  return { path: resolved.path, content: content.toString('utf8'), diff, hash: contentHash(content) }
}

async function reviewSnapshot(cwd: string): Promise<ReviewSnapshot> {
  try {
    const root = await git(cwd, ['rev-parse', '--show-toplevel'])
    if (root.code !== 0) return { git: false, files: [], error: root.stderr.trim() || 'This work folder is not a Git repository.' }
    const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    if (status.code !== 0) return { git: true, files: [], error: status.stderr.trim() || 'Git status failed.' }
    const records = status.stdout.split('\0')
    const files: ReviewSnapshot['files'] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (record === undefined || record.length < 4) continue
      const indexStatus = record[0] ?? ' '
      const worktreeStatus = record[1] ?? ' '
      const path = record.slice(3)
      files.push({ path, indexStatus, worktreeStatus, untracked: indexStatus === '?' && worktreeStatus === '?' })
      if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') index += 1
    }
    return { git: true, files }
  } catch (reason) {
    return { git: false, files: [], error: reason instanceof Error ? reason.message : String(reason) }
  }
}

function installIpc(
  controller: PluginController,
  codex: CodexAppServer,
  billing: DeepSeekBillingService,
  setup: SetupService,
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
      { id: 'reveal', label: `Reveal in ${FILE_MANAGER_NAME}` },
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
      { id: 'reveal', label: `Reveal in ${FILE_MANAGER_NAME}` },
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
      network: (() => {
        const value = requiredString(payload['network'], 'network')
        if (value !== 'off' && value !== 'auto') throw new Error('network must be off or auto')
        return value
      })(),
      prompt: requiredString(payload['prompt'], 'prompt'),
      ...(payload['context'] === undefined ? {} : { context: optionalHandoffMessages(payload['context']) }),
    })
  })
  ipcMain.handle('dsh:codex-read-thread', async (event, threadId: unknown) => {
    assertTrustedSender(event)
    return codex.readThread(requiredString(threadId, 'threadId'))
  })
  ipcMain.handle('dsh:codex-steer', async (event, threadId: unknown, turnId: unknown, prompt: unknown) => {
    assertTrustedSender(event)
    return codex.steer(
      requiredString(threadId, 'threadId'),
      requiredString(turnId, 'turnId'),
      requiredString(prompt, 'prompt'),
    )
  })
  ipcMain.handle('dsh:codex-interrupt', async (event, threadId: unknown, turnId: unknown) => {
    assertTrustedSender(event)
    await codex.interrupt(requiredString(threadId, 'threadId'), requiredString(turnId, 'turnId'))
  })
  ipcMain.handle('dsh:codex-respond-approval', (event, requestId: unknown, decision: unknown) => {
    assertTrustedSender(event)
    if (decision !== 'accept' && decision !== 'acceptForSession' && decision !== 'decline') {
      throw new Error('Codex approval decision is invalid')
    }
    codex.respondApproval(requestIdentifier(requestId), decision)
  })
  ipcMain.handle('dsh:setup-inspect', async event => {
    assertTrustedSender(event)
    return setup.inspect()
  })
  ipcMain.handle('dsh:setup-start-host', async event => {
    assertTrustedSender(event)
    return setup.startHost()
  })
  ipcMain.handle('dsh:setup-stop-host', event => {
    assertTrustedSender(event)
    setup.stopHost()
  })
  ipcMain.handle('dsh:setup-open-external', async (event, target: unknown) => {
    assertTrustedSender(event)
    if (target !== 'deepseek-key' && target !== 'node' && target !== 'codex-install') throw new Error('Unknown setup link')
    await setup.openExternal(target)
  })
  ipcMain.handle('dsh:setup-open-codex-login', async event => {
    assertTrustedSender(event)
    await setup.openCodexLogin()
  })
  ipcMain.handle('dsh:review-list', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const input = object(raw)
    const sessionId = requiredString(input['sessionId'], 'review session id')
    const cwd = requiredString(input['cwd'], 'review working directory')
    await assertCodexWorkspace(sessionId, cwd)
    return reviewSnapshot(cwd)
  })
  ipcMain.handle('dsh:review-directory', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const input = object(raw)
    const sessionId = requiredString(input['sessionId'], 'review session id')
    const cwd = requiredString(input['cwd'], 'review working directory')
    const path = typeof input['path'] === 'string' ? input['path'] : ''
    await assertCodexWorkspace(sessionId, cwd)
    return reviewDirectory(cwd, path)
  })
  ipcMain.handle('dsh:review-read', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const input = object(raw)
    const sessionId = requiredString(input['sessionId'], 'review session id')
    const cwd = requiredString(input['cwd'], 'review working directory')
    await assertCodexWorkspace(sessionId, cwd)
    return reviewDocument(cwd, requiredString(input['path'], 'review file path'))
  })
  ipcMain.handle('dsh:review-write', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const input = object(raw)
    const sessionId = requiredString(input['sessionId'], 'review session id')
    const cwd = requiredString(input['cwd'], 'review working directory')
    const path = requiredString(input['path'], 'review file path')
    const content = requiredString(input['content'], 'review file content')
    const expectedHash = requiredString(input['expectedHash'], 'review file hash')
    if (content.length > 2_000_000 || !/^[a-f\d]{64}$/i.test(expectedHash)) throw new Error('Review write payload is invalid')
    await assertCodexWorkspace(sessionId, cwd)
    const resolved = await reviewFilePath(cwd, path)
    const current = await readFile(resolved.target)
    if (contentHash(current) !== expectedHash) throw new Error('The file changed on disk. Reload it before saving your edit.')
    const metadata = await stat(resolved.target)
    const temporary = join(dirname(resolved.target), `.${randomUUID()}.dsh-review.tmp`)
    try {
      await writeFile(temporary, content, { mode: metadata.mode })
      await rename(temporary, resolved.target)
    } catch (reason) {
      await unlink(temporary).catch(() => undefined)
      throw reason
    }
    return reviewDocument(cwd, resolved.path)
  })
  ipcMain.handle('dsh:review-open', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const input = object(raw)
    const sessionId = requiredString(input['sessionId'], 'review session id')
    const cwd = requiredString(input['cwd'], 'review working directory')
    await assertCodexWorkspace(sessionId, cwd)
    return openReviewFile(cwd, requiredString(input['path'], 'review file path'))
  })
  ipcMain.handle('dsh:agent-workspace', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const input = object(raw)
    return ensureAgentWorktree(
      requiredString(input['parentSessionId'], 'parent session id'),
      requiredString(input['cwd'], 'agent working directory'),
      requiredString(input['agentId'], 'agent id'),
    )
  })
  ipcMain.handle('dsh:terminal-run', async (event, raw: unknown) => {
    assertTrustedSender(event)
    const payload = object(raw)
    const id = requiredString(payload['id'], 'terminal command id')
    const command = requiredString(payload['command'], 'terminal command')
    const cwd = await canonicalTerminalDirectory(requiredString(payload['cwd'], 'terminal working directory'))
    if (id.length > 128 || command.length > 20_000 || terminalProcesses.has(id)) throw new Error('Terminal command payload is invalid')
    const invocation = terminalInvocation(command)
    const child = spawn(invocation.executable, invocation.args, {
      cwd,
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
      windowsHide: true,
    })
    terminalProcesses.set(id, { owner: event.sender.id, child })
    const publish = (payload: object): void => {
      if (!event.sender.isDestroyed()) event.sender.send('dsh:terminal-event', { id, ...payload })
    }
    child.stdout.on('data', chunk => publish({ type: 'data', stream: 'stdout', data: chunk.toString() }))
    child.stderr.on('data', chunk => publish({ type: 'data', stream: 'stderr', data: chunk.toString() }))
    child.once('error', reason => publish({ type: 'error', message: reason.message }))
    child.once('close', (code, signal) => {
      terminalProcesses.delete(id)
      publish({ type: 'exit', code, signal })
    })
    return { accepted: true as const }
  })
  ipcMain.handle('dsh:terminal-stop', (event, rawId: unknown) => {
    assertTrustedSender(event)
    const id = requiredString(rawId, 'terminal command id')
    const processRecord = terminalProcesses.get(id)
    if (processRecord === undefined || processRecord.owner !== event.sender.id) return
    processRecord.child.kill('SIGTERM')
  })
  ipcMain.handle('dsh:terminal-change-directory', async (event, rawCwd: unknown, rawTarget: unknown) => {
    assertTrustedSender(event)
    if (typeof rawTarget !== 'string' || rawTarget.length > 4_096) throw new Error('Terminal directory target is invalid')
    return changeTerminalDirectory(requiredString(rawCwd, 'terminal working directory'), rawTarget)
  })
}

const downlinkClients = new Map<number, DownlinkClient>()
const pendingDeeplinks: string[] = []

function sessionIdFromArguments(argv: string[]): string | undefined {
  for (const argument of argv) {
    const sessionId = sessionIdFromDeeplink(argument)
    if (sessionId !== undefined) return sessionId
  }
  return undefined
}

function createMainWindow(initialSessionId?: string): BrowserWindow {
  const appIconPath = join(app.getAppPath(), 'build', 'icon.png')
  const window = new BrowserWindow({
    width: 1440,
    height: 930,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    icon: appIconPath,
    backgroundColor: '#e7e7e7',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 14 } }
      : { titleBarStyle: 'default' as const, autoHideMenuBar: true }),
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
    stopTerminalProcesses(webContentsId)
  })
  const target = new URL(`${APP_ORIGIN}/index.html`)
  if (initialSessionId !== undefined) target.searchParams.set('sessionId', initialSessionId)
  void window.loadURL(target.href)

  return window
}

let codexServer: CodexAppServer | undefined
let setupService: SetupService | undefined
const singleInstanceLock = app.requestSingleInstanceLock()

const startupSessionId = sessionIdFromArguments(process.argv)
if (startupSessionId !== undefined) pendingDeeplinks.push(startupSessionId)

app.on('second-instance', (_event, argv) => {
  const sessionId = sessionIdFromArguments(argv)
  if (sessionId !== undefined) {
    if (app.isReady()) createMainWindow(sessionId)
    else pendingDeeplinks.push(sessionId)
    return
  }
  const window = BrowserWindow.getAllWindows().at(-1)
  if (window === undefined) {
    if (app.isReady()) createMainWindow()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  const sessionId = sessionIdFromDeeplink(url)
  if (sessionId === undefined) return
  if (app.isReady()) createMainWindow(sessionId)
  else pendingDeeplinks.push(sessionId)
})

if (!singleInstanceLock) {
  app.quit()
} else app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('ai.deepseek.harness.workbench')
  if (process.platform === 'darwin' && app.dock !== undefined) {
    const dockIcon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }
  Menu.setApplicationMenu(null)
  await installAppProtocol()
  const controller = new PluginController()
  const userDataPath = app.getPath('userData')
  const appDataPath = app.getPath('appData')
  const billing = new DeepSeekBillingService(
    join(userDataPath, 'billing-credentials.json'),
    ['DeepSeek Workbench', 'DeepSeek Harness Workbench', 'Electron', 'deepseek-harness-workbench']
      .map(name => join(appDataPath, name, 'billing-credentials.json')),
  )
  setupService = new SetupService(HOST_ORIGIN, app.getPath('documents'), app.getPath('userData'))
  codexServer = new CodexAppServer(event => {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('dsh:codex-event', event)
    })
  })
  installIpc(controller, codexServer, billing, setupService, event => downlinkClients.get(event.sender.id))
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
  for (const owner of new Set([...terminalProcesses.values()].map(item => item.owner))) stopTerminalProcesses(owner)
  codexServer?.shutdown()
  codexServer = undefined
  setupService?.shutdown()
  setupService = undefined
})
