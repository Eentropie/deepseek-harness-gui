import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, chmod, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { codexSpawnEnvironment } from '../server/codex-launch.ts'
import { codexExecutableCandidates } from '../server/codex-executable.ts'
import type { SetupEvent, SetupSnapshot } from '../src/lib/types.ts'

interface HostCandidate {
  kind: 'checkout' | 'installed' | 'npx'
  label: string
  executable: string
  args: string[]
  cwd?: string
  shell: boolean
}

function platformName(): SetupSnapshot['platform'] {
  if (process.platform === 'darwin') return 'macOS'
  if (process.platform === 'win32') return 'Windows'
  return 'Linux'
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function executablePaths(name: string): Array<{ path: string; shell: boolean }> {
  const pathEntries = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles']
    const appData = process.env['APPDATA']
    const extensions = ['.exe', '.cmd', '.bat']
    const conventional = [
      ...(programFiles === undefined ? [] : [join(programFiles, 'nodejs', `${name}.exe`), join(programFiles, 'nodejs', `${name}.cmd`)]),
      ...(appData === undefined ? [] : [join(appData, 'npm', `${name}.cmd`)]),
    ]
    return [...new Set([...conventional, ...pathEntries.flatMap(entry => extensions.map(extension => join(entry, `${name}${extension}`)))])]
      .map(path => ({ path, shell: /\.(?:cmd|bat)$/i.test(path) }))
  }
  const conventional = process.platform === 'darwin'
    ? [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]
    : [`/usr/local/bin/${name}`, `/usr/bin/${name}`]
  return [...new Set([...conventional, ...pathEntries.map(entry => join(entry, name))])]
    .map(path => ({ path, shell: false }))
}

async function firstExecutable(name: string): Promise<{ path: string; shell: boolean } | undefined> {
  for (const candidate of executablePaths(name)) {
    if (await exists(candidate.path)) return candidate
  }
  return undefined
}

async function capture(executable: string, args: string[], shell = false): Promise<string | undefined> {
  return await new Promise(resolve => {
    const child = spawn(executable, args, {
      env: codexSpawnEnvironment(executable),
      shell,
      windowsHide: true,
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve(undefined)
    }, 4_000)
    child.stdout.on('data', chunk => { output += chunk.toString() })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    child.once('error', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
    child.once('close', code => {
      clearTimeout(timer)
      resolve(code === 0 ? output.trim() : undefined)
    })
  })
}

function compatibleNode(version?: string): boolean {
  const major = Number(version?.match(/v?(\d+)/)?.[1])
  return Number.isInteger(major) && major >= 22
}

async function hostDescription(origin: string): Promise<{ version?: string } | undefined> {
  const rpcId = `setup-${randomUUID()}`
  try {
    const response = await fetch(`${origin}/api/host.describe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'host.describe', payload: {} }),
      signal: AbortSignal.timeout(1_200),
    })
    if (!response.ok) return undefined
    const envelope = await response.json() as { result?: { ok?: boolean; value?: { version?: unknown } } }
    if (envelope.result?.ok !== true) return undefined
    return typeof envelope.result.value?.version === 'string' ? { version: envelope.result.value.version } : {}
  } catch {
    return undefined
  }
}

async function validCheckout(path: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')) as { name?: unknown }
    return value.name === '@deepseek-ai/dsh-root'
  } catch {
    return false
  }
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export class SetupService {
  private managedHost?: ChildProcessWithoutNullStreams
  private managedCandidate?: HostCandidate

  constructor(
    private readonly hostOrigin: string,
    private readonly documentsPath: string,
    private readonly userDataPath: string,
  ) {}

  private publish(event: SetupEvent): void {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) window.webContents.send('dsh:setup-event', event)
    })
  }

  private async findHostCandidate(): Promise<HostCandidate | undefined> {
    const configured = process.env['DSH_HARNESS_DIR']?.trim()
    const checkouts = [...new Set([
      ...(configured !== undefined && isAbsolute(configured) ? [configured] : []),
      join(homedir(), 'deepseek-harness'),
      join(this.documentsPath, 'deepseek-harness'),
      join(this.documentsPath, 'GitHub', 'deepseek-harness'),
    ])]
    const corepack = await firstExecutable('corepack')
    for (const checkout of checkouts) {
      if (!await validCheckout(checkout)) continue
      const pnpm = process.platform === 'win32'
        ? join(checkout, 'node_modules', '.bin', 'pnpm.cmd')
        : join(checkout, 'node_modules', '.bin', 'pnpm')
      if (await exists(pnpm)) {
        return { kind: 'checkout', label: `Existing checkout · ${checkout}`, executable: pnpm, args: ['dsh', 'web'], cwd: checkout, shell: process.platform === 'win32' }
      }
      if (corepack !== undefined && await exists(join(checkout, 'node_modules'))) {
        return {
          kind: 'checkout',
          label: `Existing checkout via Corepack · ${checkout}`,
          executable: corepack.path,
          args: ['pnpm', 'dsh', 'web'],
          cwd: checkout,
          shell: corepack.shell,
        }
      }
    }
    const installed = await firstExecutable('dsh')
    if (installed !== undefined) {
      return { kind: 'installed', label: `Installed dsh · ${installed.path}`, executable: installed.path, args: ['web'], shell: installed.shell }
    }
    const npx = await firstExecutable('npx')
    if (npx !== undefined) {
      return { kind: 'npx', label: 'Install and run @deepseek-ai/dsh with npx', executable: npx.path, args: ['--yes', '@deepseek-ai/dsh', 'web'], shell: npx.shell }
    }
    return undefined
  }

  async inspect(): Promise<SetupSnapshot> {
    const [description, node, candidate] = await Promise.all([
      hostDescription(this.hostOrigin),
      firstExecutable('node'),
      this.findHostCandidate(),
    ])
    const nodeVersion = node === undefined ? undefined : await capture(node.path, ['--version'], node.shell)
    return {
      platform: platformName(),
      host: {
        online: description !== undefined,
        managed: this.managedHost !== undefined && this.managedHost.exitCode === null,
        ...(description?.version === undefined ? {} : { version: description.version }),
        ...(candidate === undefined ? {} : { candidate: candidate.kind, candidateLabel: candidate.label }),
        ...(description === undefined && candidate === undefined ? { error: 'Node.js 22+ is required to install and start the Local Host.' } : {}),
      },
      node: {
        available: nodeVersion !== undefined,
        compatible: compatibleNode(nodeVersion),
        ...(nodeVersion === undefined ? {} : { version: nodeVersion }),
      },
    }
  }

  async startHost(): Promise<SetupSnapshot> {
    if (await hostDescription(this.hostOrigin) !== undefined) return this.inspect()
    if (this.managedHost !== undefined && this.managedHost.exitCode === null) return this.waitForHost()
    const candidate = await this.findHostCandidate()
    if (candidate === undefined) throw new Error('Install Node.js 22 or newer, then run the environment check again.')
    const node = await firstExecutable('node')
    const nodeVersion = node === undefined ? undefined : await capture(node.path, ['--version'], node.shell)
    if (!compatibleNode(nodeVersion)) throw new Error(`DeepSeek Harness requires Node.js 22+. Found ${nodeVersion ?? 'no compatible Node.js installation'}.`)
    this.publish({ type: 'host-state', running: true, message: `Starting ${candidate.label}` })
    const child = spawn(candidate.executable, candidate.args, {
      ...(candidate.cwd === undefined ? {} : { cwd: candidate.cwd }),
      env: {
        ...codexSpawnEnvironment(candidate.executable),
        npm_config_cache: join(this.userDataPath, 'npm-cache'),
        NO_COLOR: '1',
      },
      shell: candidate.shell,
      windowsHide: true,
    })
    this.managedHost = child
    this.managedCandidate = candidate
    child.stdout.on('data', chunk => this.publish({ type: 'host-log', stream: 'stdout', data: chunk.toString() }))
    child.stderr.on('data', chunk => this.publish({ type: 'host-log', stream: 'stderr', data: chunk.toString() }))
    child.once('error', reason => this.publish({ type: 'host-state', running: false, message: reason.message }))
    child.once('close', code => {
      this.publish({ type: 'host-state', running: false, message: `Local Host exited with code ${code ?? 'unknown'}.` })
      if (this.managedHost === child) this.managedHost = undefined
    })
    return this.waitForHost()
  }

  private async waitForHost(): Promise<SetupSnapshot> {
    for (let attempt = 0; attempt < 360; attempt += 1) {
      const description = await hostDescription(this.hostOrigin)
      if (description !== undefined) {
        this.publish({ type: 'host-state', running: true, message: 'Local Host is ready.' })
        return this.inspect()
      }
      if (this.managedHost === undefined || this.managedHost.exitCode !== null) {
        throw new Error('Local Host stopped before it became ready. Review the setup log for details.')
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('Local Host did not become ready within three minutes.')
  }

  stopHost(): void {
    if (this.managedHost === undefined || this.managedHost.exitCode !== null) return
    this.managedHost.kill('SIGTERM')
    this.publish({ type: 'host-state', running: false, message: 'Stopping the app-managed Local Host…' })
  }

  async openExternal(target: 'deepseek-key' | 'node' | 'codex-install' | 'antigravity-install'): Promise<void> {
    const urls = {
      'deepseek-key': 'https://platform.deepseek.com/api_keys',
      node: 'https://nodejs.org/en/download',
      'codex-install': 'https://developers.openai.com/codex/cli/',
      'antigravity-install': 'https://www.antigravity.google/product/antigravity-cli',
    } as const
    await shell.openExternal(urls[target])
  }

  async openCodexLogin(): Promise<void> {
    let candidate: { path: string; shell: boolean } | undefined
    for (const item of codexExecutableCandidates()) {
      if (await exists(item.path)) {
        candidate = item
        break
      }
    }
    if (candidate === undefined) throw new Error('Codex CLI is not installed. Open the install guide first.')
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/d', '/k', `"${candidate.path}" login`], { detached: true, windowsHide: false })
      child.unref()
      return
    }
    if (process.platform === 'darwin') {
      const script = join(this.userDataPath, 'codex-login.command')
      await writeFile(script, `#!/bin/zsh\nclear\nprintf 'DeepSeek Harness · Codex login\\n\\n'\n${quoteShell(candidate.path)} login\nprintf '\\nYou can close this window after login completes.\\n'\n`, { mode: 0o700 })
      await chmod(script, 0o700)
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/usr/bin/open', ['-a', 'Terminal', script])
        child.once('error', reject)
        child.once('close', code => code === 0 ? resolve() : reject(new Error('Could not open Terminal for Codex login')))
      })
      return
    }
    const child = spawn('x-terminal-emulator', ['-e', candidate.path, 'login'], { detached: true })
    child.unref()
  }

  shutdown(): void {
    this.stopHost()
  }

  managedLabel(): string | undefined {
    return this.managedCandidate === undefined ? undefined : basename(this.managedCandidate.executable)
  }
}
