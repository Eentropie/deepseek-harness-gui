import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type {
  CodexCatalog,
  CodexCatalogModel,
  CodexApprovalDecision,
  CodexEvent,
  CodexPromptResult,
  CodexSteerResult,
  CodexThreadSnapshot,
  CodexUsageSnapshot,
  ProviderHandoffMessage,
  EffectiveNetworkMode,
} from '../src/lib/types.ts'
import { PROVIDER_HANDOFF_MARKER, providerHandoffText } from '../src/lib/provider-handoff.ts'
import { codexSpawnEnvironment } from '../server/codex-launch.ts'
import { codexExecutableCandidates, type CodexExecutableCandidate } from '../server/codex-executable.ts'
import { codexExecutionPolicy } from '../server/codex-permissions.ts'
import { normalizeCodexModels, normalizeCodexUsage, projectCodexThread, projectCodexToolItem } from '../server/codex-protocol.ts'
import { codexWebSearchMode } from '../src/lib/network-mode.ts'
import { desktopAgentRoomCapability } from '../src/lib/agent-room-protocol.ts'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface CodexPromptInput {
  sessionId: string
  threadId?: string
  cwd: string
  model: string
  effort: string
  permission: string
  prompt: string
  network: EffectiveNetworkMode
  context?: ProviderHandoffMessage[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function requestId(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

async function codexExecutable(): Promise<CodexExecutableCandidate> {
  const candidates = codexExecutableCandidates()
  for (const candidate of candidates) {
    try {
      await access(candidate.path)
      return candidate
    } catch {
      // Keep looking through the fixed local installation candidates.
    }
  }
  throw new Error(process.platform === 'win32'
    ? 'Codex CLI was not found. Install Codex for Windows or set DEEPSEEK_WORKBENCH_CODEX_BIN to an absolute codex.exe/codex.cmd path.'
    : 'Codex CLI was not found in the configured path, Homebrew locations, or PATH')
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function usageFailureMessage(error: unknown): string {
  const message = errorMessage(error)
  if (/not signed in|unauthorized|authentication|\b401\b/i.test(message)) {
    return 'Codex CLI is not signed in. Sign in again, then refresh.'
  }
  if (/timed out/i.test(message)) {
    return 'Codex usage data took too long to respond. Refresh to try again.'
  }
  if (/sending request|network|connect|dns|fetch|socket|certificate|tls/i.test(message)) {
    return 'ChatGPT usage data could not be reached. Check the connection or proxy, then refresh.'
  }
  return 'Codex usage data is temporarily unavailable. Refresh to try again.'
}

function turnError(params: Record<string, unknown>): string | undefined {
  const turn = record(params['turn'])
  const error = record(turn?.['error'])
  return string(error?.['message']) ?? string(error?.['additionalDetails'])
}

const MAX_PROTOCOL_BUFFER_BYTES = 16 * 1024 * 1024

/** A single authenticated Codex App Server process owned by the desktop main process. */
export class CodexAppServer {
  private process?: ChildProcessWithoutNullStreams
  private startPromise?: Promise<void>
  private stdout = ''
  private stderr = ''
  private nextId = 0
  private readonly pending = new Map<string | number, PendingRequest>()
  private readonly loadedThreads = new Set<string>()
  private readonly webModeByThread = new Map<string, string>()
  private readonly sessionByThread = new Map<string, string>()
  private readonly activeTurnsByThread = new Map<string, { sessionId?: string; turnId: string }>()
  private readonly incomingApprovals = new Map<string | number, string>()
  private catalogCache?: CodexCatalogModel[]
  private usageCache?: CodexUsageSnapshot
  private stopping = false

  constructor(private readonly publish: (event: CodexEvent) => void) {}

  async catalog(refresh = false): Promise<CodexCatalog> {
    try {
      await this.ensureStarted()
      const models = refresh ? await this.loadCatalog() : this.catalogCache ?? await this.loadCatalog()
      return { available: true, authenticatedWith: 'ChatGPT', models }
    } catch (reason) {
      return {
        available: false,
        authenticatedWith: 'ChatGPT',
        models: [],
        error: errorMessage(reason),
      }
    }
  }

  async usage(): Promise<CodexUsageSnapshot> {
    try {
      await this.ensureStarted()
      const account = await this.request('account/read', {}, 45_000)
      const [rateLimitsResult, activityResult] = await Promise.allSettled([
        this.retryUsageRequest('account/rateLimits/read'),
        this.retryUsageRequest('account/usage/read'),
      ])
      const rateLimits = rateLimitsResult.status === 'fulfilled' ? rateLimitsResult.value : {}
      const activity = activityResult.status === 'fulfilled' ? activityResult.value : {}
      const fresh = normalizeCodexUsage(account, rateLimits, activity)
      const warnings = [
        ...(rateLimitsResult.status === 'rejected' ? [usageFailureMessage(rateLimitsResult.reason)] : []),
        ...(activityResult.status === 'rejected' ? ['Codex token history could not be refreshed.'] : []),
      ]
      const snapshot: CodexUsageSnapshot = {
        ...fresh,
        rateLimits: rateLimitsResult.status === 'fulfilled'
          ? fresh.rateLimits
          : this.usageCache?.rateLimits ?? [],
        dailyUsageBuckets: activityResult.status === 'fulfilled'
          ? fresh.dailyUsageBuckets
          : this.usageCache?.dailyUsageBuckets ?? [],
        ...(activityResult.status === 'fulfilled'
          ? fresh.summary === undefined ? {} : { summary: fresh.summary }
          : this.usageCache?.summary === undefined ? {} : { summary: this.usageCache.summary }),
        ...(warnings.length === 0 ? {} : { stale: true, warnings }),
      }
      if (rateLimitsResult.status === 'fulfilled' || activityResult.status === 'fulfilled') {
        this.usageCache = snapshot
      }
      return snapshot
    } catch (reason) {
      const error = usageFailureMessage(reason)
      if (this.usageCache !== undefined && !/not signed in|unauthorized|authentication|\b401\b/i.test(errorMessage(reason))) {
        return {
          ...this.usageCache,
          stale: true,
          warnings: [error],
          updatedAt: Date.now(),
        }
      }
      return {
        available: false,
        rateLimits: [],
        dailyUsageBuckets: [],
        updatedAt: Date.now(),
        error,
      }
    }
  }

  private async retryUsageRequest(method: 'account/rateLimits/read' | 'account/usage/read'): Promise<unknown> {
    try {
      return await this.request(method, null, 35_000)
    } catch {
      await new Promise(resolve => setTimeout(resolve, 400))
      return this.request(method, null, 20_000)
    }
  }

  async prompt(input: CodexPromptInput): Promise<CodexPromptResult> {
    this.assertPrompt(input)
    const policy = codexExecutionPolicy(input.permission, input.cwd)
    await this.ensureStarted()
    const models = this.catalogCache ?? await this.loadCatalog()
    const selected = models.find(model => model.id === input.model)
    if (selected === undefined) throw new Error(`Codex model ${input.model} is not available for this account`)
    if (!selected.efforts.some(effort => effort.id === input.effort)) {
      throw new Error(`${input.effort} is not supported by ${selected.name}`)
    }

    let threadId = input.threadId
    const webSearch = codexWebSearchMode(input.network)
    if (threadId === undefined) {
      const started = record(await this.request('thread/start', {
        model: input.model,
        modelProvider: 'openai',
        cwd: input.cwd,
        approvalPolicy: policy.approvalPolicy,
        approvalsReviewer: policy.approvalsReviewer,
        sandbox: policy.threadSandbox,
        serviceName: 'deepseek_workbench',
        developerInstructions: 'Do not ask the user for interactive input. Make safe, reasonable assumptions and continue within the workspace sandbox.',
        config: { web_search: webSearch },
      }))
      threadId = string(record(started?.['thread'])?.['id'])
      if (threadId === undefined) throw new Error('Codex did not return a thread id')
      this.loadedThreads.add(threadId)
      this.webModeByThread.set(threadId, webSearch)
    } else if (!this.loadedThreads.has(threadId) || this.webModeByThread.get(threadId) !== webSearch) {
      await this.request('thread/resume', { threadId, config: { web_search: webSearch } })
      this.loadedThreads.add(threadId)
      this.webModeByThread.set(threadId, webSearch)
    }
    this.sessionByThread.set(threadId, input.sessionId)

    let handoffFallback = ''
    if (input.context !== undefined && input.context.length > 0) {
      try {
        await this.request('thread/inject_items', {
          threadId,
          items: input.context.map(message => ({
            type: 'message',
            role: message.role,
            content: [{
              type: message.role === 'assistant' ? 'output_text' : 'input_text',
              text: `${PROVIDER_HANDOFF_MARKER}\nContext transferred from DeepSeek.\n\n${message.text}`,
            }],
          })),
        }, 60_000)
      } catch {
        handoffFallback = providerHandoffText('DeepSeek', { messages: input.context, omitted: 0 })
      }
    }
    const prompt = [
      desktopAgentRoomCapability('Codex', selected.name),
      handoffFallback,
      `<current_user_message>\n${input.prompt}\n</current_user_message>`,
    ].filter(Boolean).join('\n\n')

    const response = record(await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      cwd: input.cwd,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
      sandboxPolicy: policy.sandboxPolicy,
      model: input.model,
      effort: input.effort,
      summary: 'auto',
    }, 60_000))
    const turnId = string(record(response?.['turn'])?.['id'])
    if (turnId === undefined) throw new Error('Codex did not return a turn id')
    this.activeTurnsByThread.set(threadId, { sessionId: input.sessionId, turnId })
    return { threadId, turnId }
  }

  async readThread(threadId: string): Promise<CodexThreadSnapshot> {
    this.assertIdentifier(threadId, 'thread id')
    await this.ensureStarted()
    const response = await this.request('thread/read', { threadId, includeTurns: true }, 60_000)
    return { threadId, messages: projectCodexThread(response) }
  }

  async steer(threadId: string, turnId: string, prompt: string): Promise<CodexSteerResult> {
    this.assertIdentifier(threadId, 'thread id')
    this.assertIdentifier(turnId, 'turn id')
    if (prompt.trim() === '') throw new Error('Codex steering prompt must not be empty')
    await this.ensureStarted()
    const response = record(await this.request('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: [{
        type: 'text',
        text: `${desktopAgentRoomCapability('Codex')}\n\n<current_user_message>\n${prompt}\n</current_user_message>`,
        text_elements: [],
      }],
    }, 60_000))
    const steeredTurnId = string(response?.['turnId'])
    if (steeredTurnId === undefined) throw new Error('Codex did not confirm the steered turn')
    this.activeTurnsByThread.set(threadId, {
      ...(this.sessionByThread.get(threadId) === undefined ? {} : { sessionId: this.sessionByThread.get(threadId) }),
      turnId: steeredTurnId,
    })
    return { turnId: steeredTurnId }
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    this.assertIdentifier(threadId, 'thread id')
    this.assertIdentifier(turnId, 'turn id')
    await this.ensureStarted()
    await this.request('turn/interrupt', { threadId, turnId })
  }

  respondApproval(requestId: string | number, decision: CodexApprovalDecision): void {
    const method = this.incomingApprovals.get(requestId)
    if (method === undefined) throw new Error('Codex approval request is no longer pending')
    this.incomingApprovals.delete(requestId)
    this.respond(requestId, { decision })
  }

  shutdown(): void {
    this.stopping = true
    this.startPromise = undefined
    this.loadedThreads.clear()
    this.webModeByThread.clear()
    this.activeTurnsByThread.clear()
    for (const requestId of this.incomingApprovals.keys()) this.respond(requestId, { decision: 'decline' })
    this.incomingApprovals.clear()
    this.rejectPending(new Error('Codex App Server stopped'))
    this.process?.kill('SIGTERM')
    this.process = undefined
  }

  private async ensureStarted(): Promise<void> {
    if (this.startPromise !== undefined) {
      await this.startPromise
      return
    }
    if (this.process !== undefined && !this.process.killed) return
    this.startPromise = this.launch().finally(() => { this.startPromise = undefined })
    await this.startPromise
  }

  private async launch(): Promise<void> {
    const executable = await codexExecutable()
    this.stopping = false
    this.stdout = ''
    this.stderr = ''
    const child = spawn(executable.path, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: codexSpawnEnvironment(executable.path),
      shell: executable.shell ? process.env['ComSpec'] ?? true : false,
    })
    this.process = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consume(chunk))
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4_000)
    })
    child.on('error', error => this.handleExit(error))
    child.on('exit', (code, signal) => {
      if (this.process !== child) return
      const detail = this.stderr.trim()
      const suffix = detail === '' ? '' : `: ${detail}`
      this.handleExit(new Error(`Codex App Server exited (${signal ?? code ?? 'unknown'})${suffix}`))
    })

    try {
      await this.rawRequest('initialize', {
        clientInfo: {
          name: 'deepseek_workbench',
          title: 'DeepSeek Harness',
          version: '0.1.0',
        },
      }, 30_000)
      this.notify('initialized', {})
    } catch (reason) {
      if (this.process === child) {
        this.stderr = errorMessage(reason)
        this.terminateProcess(child)
      }
      throw reason
    }
  }

  private async loadCatalog(): Promise<CodexCatalogModel[]> {
    const result = await this.request('model/list', { limit: 100, includeHidden: false }, 30_000)
    const models = normalizeCodexModels(result)
    if (models.length === 0) throw new Error('Codex returned no selectable models')
    this.catalogCache = models
    return models
  }

  private request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    return this.ensureStarted().then(() => this.rawRequest(method, params, timeoutMs))
  }

  private rawRequest(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.process
    if (child === undefined || child.killed || !child.stdin.writable) {
      return Promise.reject(new Error('Codex App Server is not running'))
    }
    this.nextId += 1
    const id = this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex App Server timed out during ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, error => {
        if (error === null || error === undefined) return
        const pending = this.pending.get(id)
        if (pending === undefined) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  private notify(method: string, params: unknown): void {
    const child = this.process
    if (child === undefined || child.killed || !child.stdin.writable) return
    child.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }

  private respond(id: string | number, result: unknown): void {
    const child = this.process
    if (child === undefined || child.killed || !child.stdin.writable) return
    child.stdin.write(`${JSON.stringify({ id, result })}\n`)
  }

  private respondError(id: string | number, message: string): void {
    const child = this.process
    if (child === undefined || child.killed || !child.stdin.writable) return
    child.stdin.write(`${JSON.stringify({ id, error: { code: -32601, message } })}\n`)
  }

  private consume(chunk: string): void {
    this.stdout += chunk
    if (Buffer.byteLength(this.stdout, 'utf8') > MAX_PROTOCOL_BUFFER_BYTES) {
      this.stdout = ''
      this.stderr = 'Codex App Server exceeded the 16 MB protocol line limit'
      if (this.process !== undefined) this.terminateProcess(this.process)
      return
    }
    for (;;) {
      const newline = this.stdout.indexOf('\n')
      if (newline < 0) return
      const line = this.stdout.slice(0, newline).trim()
      this.stdout = this.stdout.slice(newline + 1)
      if (line === '') continue
      try {
        this.onMessage(JSON.parse(line) as unknown)
      } catch (reason) {
        this.publish({ type: 'error', message: `Codex protocol error: ${errorMessage(reason)}` })
      }
    }
  }

  private onMessage(value: unknown): void {
    const message = record(value)
    if (message === undefined) return
    const id = requestId(message['id'])
    const method = string(message['method'])
    if (id !== undefined && method === undefined) {
      const pending = this.pending.get(id)
      if (pending === undefined) return
      clearTimeout(pending.timer)
      this.pending.delete(id)
      const error = record(message['error'])
      if (error !== undefined) pending.reject(new Error(string(error['message']) ?? 'Codex request failed'))
      else pending.resolve(message['result'])
      return
    }
    if (id !== undefined && method !== undefined) {
      this.handleServerRequest(id, method, record(message['params']) ?? {})
      return
    }
    if (method !== undefined) this.handleNotification(method, record(message['params']) ?? {})
  }

  private handleServerRequest(id: string | number, method: string, params: Record<string, unknown>): void {
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      const threadId = string(params['threadId'])
      const turnId = string(params['turnId'])
      const command = string(params['command'])
      const reason = string(params['reason'])
      this.incomingApprovals.set(id, method)
      this.publish({
        type: 'approval-requested',
        requestId: id,
        ...(threadId === undefined ? {} : { threadId }),
        ...(turnId === undefined ? {} : { turnId }),
        ...(threadId === undefined || this.sessionByThread.get(threadId) === undefined
          ? {}
          : { sessionId: this.sessionByThread.get(threadId) }),
        toolName: command === undefined
          ? method === 'item/fileChange/requestApproval' ? 'File changes' : 'Command execution'
          : command.slice(0, 1_000),
        ...(reason === undefined ? {} : { reason }),
      })
      return
    }
    if (method === 'applyPatchApproval' || method === 'execCommandApproval') {
      this.respond(id, { decision: { denied: { rejection: 'Interactive approval is unavailable in this desktop bridge.' } } })
      return
    }
    if (method === 'item/tool/requestUserInput') {
      this.respond(id, { answers: {} })
      return
    }
    if (method === 'mcpServer/elicitation/request') {
      this.respond(id, { action: 'decline', content: null, _meta: null })
      return
    }
    if (method === 'item/tool/call') {
      this.respond(id, { contentItems: [], success: false })
      return
    }
    this.respondError(id, `${method} is not supported by DeepSeek Harness`)
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
    if (method === 'account/rateLimits/updated' || method === 'thread/tokenUsage/updated') {
      this.publish({ type: 'usage-updated' })
      return
    }
    const threadId = string(params['threadId'])
    const turn = record(params['turn'])
    const turnId = string(params['turnId']) ?? string(turn?.['id'])
    const sessionId = threadId === undefined ? undefined : this.sessionByThread.get(threadId)
    if ((method === 'item/started' || method === 'item/completed') && threadId !== undefined && turnId !== undefined) {
      const timestamp = number(params[method === 'item/started' ? 'startedAtMs' : 'completedAtMs'])
      const block = projectCodexToolItem(params['item'], method === 'item/started' ? 'running' : 'succeeded', timestamp)
      if (block !== undefined) {
        this.publish({
          type: 'tool-item',
          ...(sessionId === undefined ? {} : { sessionId }),
          threadId,
          turnId,
          block,
        })
      }
      return
    }
    if (method === 'turn/started' && threadId !== undefined && turnId !== undefined) {
      this.activeTurnsByThread.set(threadId, {
        ...(sessionId === undefined ? {} : { sessionId }),
        turnId,
      })
      this.publish({ type: 'turn-started', ...(sessionId === undefined ? {} : { sessionId }), threadId, turnId })
      return
    }
    if ((method === 'item/agentMessage/delta' || method === 'item/reasoning/summaryTextDelta')
      && threadId !== undefined && turnId !== undefined) {
      const itemId = string(params['itemId'])
      const delta = string(params['delta'])
      if (itemId === undefined || delta === undefined) return
      this.publish({
        type: method === 'item/agentMessage/delta' ? 'assistant-delta' : 'reasoning-delta',
        ...(sessionId === undefined ? {} : { sessionId }),
        threadId,
        turnId,
        itemId,
        delta,
      })
      return
    }
    if (method === 'turn/completed' && threadId !== undefined && turnId !== undefined) {
      this.activeTurnsByThread.delete(threadId)
      const rawStatus = string(turn?.['status'])
      const status = rawStatus === 'interrupted' || rawStatus === 'failed' ? rawStatus : 'completed'
      const error = turnError(params)
      this.publish({
        type: 'turn-completed',
        ...(sessionId === undefined ? {} : { sessionId }),
        threadId,
        turnId,
        status,
        ...(error === undefined ? {} : { error }),
      })
      return
    }
    if (method === 'error') {
      const error = record(params['error'])
      if (threadId !== undefined && turnId !== undefined) this.activeTurnsByThread.delete(threadId)
      this.publish({
        type: 'error',
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(threadId === undefined ? {} : { threadId }),
        ...(turnId === undefined ? {} : { turnId }),
        message: string(error?.['message']) ?? string(params['message']) ?? 'Codex turn failed',
      })
    }
  }

  private handleExit(reason: Error): void {
    if (this.process === undefined) return
    this.process = undefined
    this.startPromise = undefined
    const activeTurns = [...this.activeTurnsByThread.entries()]
    this.activeTurnsByThread.clear()
    for (const [threadId, turn] of activeTurns) {
      this.publish({
        type: 'turn-completed',
        ...(turn.sessionId === undefined ? {} : { sessionId: turn.sessionId }),
        threadId,
        turnId: turn.turnId,
        status: 'failed',
        error: reason.message,
      })
    }
    this.loadedThreads.clear()
    this.webModeByThread.clear()
    this.catalogCache = undefined
    this.incomingApprovals.clear()
    this.rejectPending(reason)
    if (!this.stopping) this.publish({ type: 'error', message: reason.message })
  }

  private terminateProcess(child: ChildProcessWithoutNullStreams): void {
    child.kill('SIGTERM')
    const timer = setTimeout(() => {
      if (this.process === child) child.kill('SIGKILL')
    }, 2_000)
    timer.unref()
  }

  private rejectPending(reason: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    this.pending.clear()
  }

  private assertPrompt(input: CodexPromptInput): void {
    this.assertIdentifier(input.sessionId, 'session id')
    if (input.threadId !== undefined) this.assertIdentifier(input.threadId, 'thread id')
    if (!isAbsolute(input.cwd) || input.cwd.includes('\0')) throw new Error('Codex working directory must be an absolute path')
    if (input.model.length === 0 || input.model.length > 160) throw new Error('Codex model id is invalid')
    if (input.effort.length === 0 || input.effort.length > 40) throw new Error('Codex reasoning effort is invalid')
    if (input.network !== 'off' && input.network !== 'auto') throw new Error('Codex network mode is invalid')
    if (input.prompt.trim() === '' || input.prompt.length > 1_000_000) throw new Error('Codex prompt is invalid')
    if (input.context !== undefined) {
      if (input.context.length > 24) throw new Error('Codex handoff context is too large')
      let contextChars = 0
      for (const message of input.context) {
        if ((message.role !== 'user' && message.role !== 'assistant')
          || message.text.trim() === '' || !Number.isSafeInteger(message.seq) || message.seq < 0) {
          throw new Error('Codex handoff context is invalid')
        }
        contextChars += message.text.length
      }
      if (contextChars > 24_000) throw new Error('Codex handoff context is too large')
    }
  }

  private assertIdentifier(value: string, label: string): void {
    if (value.length === 0 || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
      throw new Error(`Codex ${label} is invalid`)
    }
  }
}
