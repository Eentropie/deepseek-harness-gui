import { randomUUID } from 'node:crypto'
import { open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

export interface HostPluginEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: PluginFiberPhase
}

export interface ControlledPluginEntry extends HostPluginEntry {
  controllable: boolean
  protectedReason?: string
}

export interface PluginControlSnapshot {
  profile: string
  configFile: string
  entries: ControlledPluginEntry[]
}

export interface PluginToggleResult {
  changed: boolean
  backupFile?: string
  snapshot: PluginControlSnapshot
}

interface ManagedOverride {
  id: string
  name: string
  disabled: boolean
}

interface RpcEnvelope<T> {
  result?:
    | { ok: true; value: T }
    | { ok: false; error: { code?: string; message?: string } }
}

const MANAGED_BEGIN = '# >>> DeepSeek Workbench managed plugin switches'
const MANAGED_END = '# <<< DeepSeek Workbench managed plugin switches'
const DEFAULT_HOST_ORIGIN = 'http://127.0.0.1:3080'
const STABLE_ENTRY = /^include:[A-Za-z0-9._:/-]+$/

const PROTECTED_ENTRIES = new Map<string, string>([
  ['include:timer', '配置热重载依赖此计时服务'],
  ['include:hmr', 'Harness 管理自己的配置热重载实例'],
  ['include:typert', '插件控制 RPC 依赖此协议注册表'],
  ['include:typert-loader', '插件控制 RPC 依赖此协议加载器'],
  ['include:typert-gateway', '插件控制 RPC 依赖此 API 网关'],
  ['include:plugin-inventory', '插件管理器依赖此实时清单'],
  ['include:api-gateway', '独立 GUI 与 Host 的 API 通道'],
  ['include:webserver', '本地 Host HTTP/WS 服务'],
  ['include:web-startup', '本地 Host 启动边界'],
  ['include:cordis-host-runner', '本地 Host 运行时边界'],
  ['include:web-runtime', '原有 localhost Web 运行时'],
  ['include:modules', '原有 localhost 模块加载器'],
  ['include:connection', '原有 localhost 连接层'],
  ['include:api-remotes', '原有 localhost Remote 客户端'],
  ['include:client-runtime', '原有 localhost 客户端运行时'],
  ['include:cordis-client-runner', '原有 localhost 客户端边界'],
])

export class PluginControlError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'PluginControlError'
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

export function resolveHostOrigin(): string {
  const raw = process.env['DSH_GUI_HOST_ORIGIN']?.trim() || DEFAULT_HOST_ORIGIN
  const parsed = new URL(raw)
  if (!isLoopback(parsed.hostname) || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('DSH_GUI_HOST_ORIGIN must be an http(s) loopback URL')
  }
  return parsed.origin
}

function resolveProfile(): string {
  const profile = process.env['DSH_GUI_PROFILE']?.trim() || 'web'
  if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
    throw new Error('DSH_GUI_PROFILE contains unsupported characters')
  }
  return profile
}

function resolveProfilePatch(profile: string): string {
  const dshHome = process.env['DSH_HOME']?.trim() || join(homedir(), '.dsh')
  return join(dshHome, 'profiles', profile, 'cordis.patch.yml')
}

export function protectionReason(entry: HostPluginEntry): string | undefined {
  if (!STABLE_ENTRY.test(entry.entryId)) return '运行时生成的条目没有稳定配置 ID'
  const exact = PROTECTED_ENTRIES.get(entry.entryId)
  if (exact !== undefined) return exact
  if (entry.entryId.startsWith('include:ui-') || entry.entryId.startsWith('include:client-')) {
    return '保留原有 localhost GUI，不由独立 GUI 卸载'
  }
  return undefined
}

function locateManagedBlock(source: string): { start: number; end: number; body: string } | undefined {
  const start = source.indexOf(MANAGED_BEGIN)
  const endMarker = source.indexOf(MANAGED_END)
  if (start === -1 && endMarker === -1) return undefined
  if (start === -1 || endMarker === -1 || endMarker < start) {
    throw new PluginControlError(409, '插件开关托管区标记不完整，请先修复 cordis.patch.yml')
  }
  if (source.indexOf(MANAGED_BEGIN, start + MANAGED_BEGIN.length) !== -1
    || source.indexOf(MANAGED_END, endMarker + MANAGED_END.length) !== -1) {
    throw new PluginControlError(409, '插件开关托管区重复，请先修复 cordis.patch.yml')
  }
  const end = endMarker + MANAGED_END.length
  return {
    start,
    end: source[end] === '\n' ? end + 1 : end,
    body: source.slice(start + MANAGED_BEGIN.length, endMarker),
  }
}

export function parseManagedOverrides(source: string): Map<string, ManagedOverride> {
  const located = locateManagedBlock(source)
  const overrides = new Map<string, ManagedOverride>()
  if (located === undefined) return overrides

  for (const rawLine of located.body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    if (!line.startsWith('- ')) {
      throw new PluginControlError(409, '插件开关托管区包含无法识别的内容')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line.slice(2))
    } catch {
      throw new PluginControlError(409, '插件开关托管区包含无效条目')
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new PluginControlError(409, '插件开关托管区包含无效条目')
    }
    const candidate = parsed as Partial<ManagedOverride>
    if (typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.disabled !== 'boolean'
      || !STABLE_ENTRY.test(candidate.id)) {
      throw new PluginControlError(409, '插件开关托管区条目字段无效')
    }
    overrides.set(candidate.id, {
      id: candidate.id,
      name: candidate.name,
      disabled: candidate.disabled,
    })
  }
  return overrides
}

function meaningfulLines(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

function withFinalNewline(source: string): string {
  return `${source.replace(/\s+$/, '')}\n`
}

export function renderManagedOverrides(source: string, overrides: ReadonlyMap<string, ManagedOverride>): string {
  const located = locateManagedBlock(source)
  let base = located === undefined
    ? source
    : `${source.slice(0, located.start)}${source.slice(located.end)}`

  if (overrides.size === 0) {
    if (meaningfulLines(base).length === 0) base = `${base.replace(/\s+$/, '')}\n[]`
    return withFinalNewline(base)
  }

  const rows = [...overrides.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(entry => `- ${JSON.stringify(entry)}`)
  const block = [MANAGED_BEGIN, ...rows, MANAGED_END].join('\n')
  const meaningful = meaningfulLines(base)

  if (meaningful.length === 1 && meaningful[0] === '[]') {
    const lines = base.split(/\r?\n/)
    const index = lines.findIndex(line => line.trim() === '[]')
    lines.splice(index, 1, block)
    return withFinalNewline(lines.join('\n'))
  }

  base = base.replace(/\s+$/, '')
  return withFinalNewline(base === '' ? block : `${base}\n\n${block}`)
}

async function atomicWrite(filename: string, content: string, mode: number): Promise<void> {
  const temporary = join(dirname(filename), `.${basename(filename)}.workbench-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', mode)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, filename)
}

function backupSuffix(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '')
}

function displayConfigFile(profile: string): string {
  return `~/.dsh/profiles/${profile}/cordis.patch.yml`
}

export class PluginController {
  readonly profile = resolveProfile()
  readonly patchFile = resolveProfilePatch(this.profile)
  readonly hostOrigin = resolveHostOrigin()
  private mutationQueue: Promise<void> = Promise.resolve()

  async list(signal?: AbortSignal): Promise<PluginControlSnapshot> {
    const entries = await this.readHostInventory(signal)
    return {
      profile: this.profile,
      configFile: displayConfigFile(this.profile),
      entries: entries.map(entry => {
        const protectedReason = protectionReason(entry)
        return {
          ...entry,
          controllable: protectedReason === undefined,
          ...(protectedReason === undefined ? {} : { protectedReason }),
        }
      }),
    }
  }

  toggle(entryId: string, enabled: boolean): Promise<PluginToggleResult> {
    const run = this.mutationQueue.then(() => this.applyToggle(entryId, enabled))
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async readHostInventory(signal?: AbortSignal): Promise<HostPluginEntry[]> {
    const id = `workbench-control-${randomUUID()}`
    let response: Response
    try {
      response = await fetch(`${this.hostOrigin}/api/pluginInventory/list`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: this.hostOrigin,
        },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: id,
          method: 'pluginInventory/list',
          payload: { args: {} },
        }),
        signal,
      })
    } catch (reason) {
      throw new PluginControlError(503, `无法连接 Harness 插件清单：${reason instanceof Error ? reason.message : String(reason)}`)
    }
    if (!response.ok) throw new PluginControlError(503, `Harness 插件清单返回 HTTP ${response.status}`)
    const envelope = await response.json() as RpcEnvelope<{ entries?: HostPluginEntry[] }>
    if (envelope.result?.ok !== true || !Array.isArray(envelope.result.value.entries)) {
      const message = envelope.result?.ok === false ? envelope.result.error.message : undefined
      throw new PluginControlError(503, message || 'Harness 插件清单响应无效')
    }
    return envelope.result.value.entries
  }

  private async waitForState(entryId: string, enabled: boolean, timeoutMs: number): Promise<PluginControlSnapshot> {
    const deadline = Date.now() + timeoutMs
    let lastError: unknown
    while (Date.now() < deadline) {
      try {
        const snapshot = await this.list()
        const entry = snapshot.entries.find(candidate => candidate.entryId === entryId)
        if (entry?.enabled === enabled) return snapshot
      } catch (reason) {
        lastError = reason
      }
      await new Promise(resolve => setTimeout(resolve, 160))
    }
    const suffix = lastError instanceof Error ? `：${lastError.message}` : ''
    throw new PluginControlError(409, `Host 未在时限内应用插件状态${suffix}`)
  }

  private async applyToggle(entryId: string, enabled: boolean): Promise<PluginToggleResult> {
    if (!STABLE_ENTRY.test(entryId)) throw new PluginControlError(400, '插件 ID 无效或不稳定')
    const before = await this.list()
    const entry = before.entries.find(candidate => candidate.entryId === entryId)
    if (entry === undefined) throw new PluginControlError(404, '插件条目不存在')
    if (!entry.controllable) throw new PluginControlError(403, entry.protectedReason || '该插件受保护')
    if (entry.enabled === enabled) return { changed: false, snapshot: before }

    let original: string
    let mode = 0o600
    try {
      original = await readFile(this.patchFile, 'utf8')
      mode = (await stat(this.patchFile)).mode & 0o777
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      original = '[]\n'
    }

    const overrides = parseManagedOverrides(original)
    overrides.set(entry.entryId, {
      id: entry.entryId,
      name: entry.moduleName,
      disabled: !enabled,
    })
    const next = renderManagedOverrides(original, overrides)
    const backup = `${this.patchFile}.workbench-backup-${backupSuffix()}`
    await writeFile(backup, original, { encoding: 'utf8', flag: 'wx', mode })
    await atomicWrite(this.patchFile, next, mode)

    try {
      const snapshot = await this.waitForState(entryId, enabled, 8_000)
      return { changed: true, backupFile: basename(backup), snapshot }
    } catch (reason) {
      await atomicWrite(this.patchFile, original, mode)
      try {
        await this.waitForState(entryId, entry.enabled, 5_000)
      } catch {
        // The original file is restored even if the Host is no longer reachable.
      }
      const message = reason instanceof Error ? reason.message : String(reason)
      throw new PluginControlError(409, `插件切换失败，已恢复原配置：${message}`)
    }
  }
}
