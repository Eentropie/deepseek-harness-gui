import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  AntigravityCatalog,
  AntigravityCatalogModel,
  AntigravityEvent,
  AntigravityPermissionMode,
  AntigravityPromptResult,
  AntigravityThreadSnapshot,
  ConversationMessage,
  EffectiveNetworkMode,
  ProcessBlock,
  ProviderHandoffMessage,
  PluginControlSnapshot,
  PluginToggleResult,
  ToolStatus,
} from '../src/lib/types.ts'
import { joinTurnBlocks } from '../src/lib/thought-process.ts'
import { desktopAgentRoomCapability } from '../src/lib/agent-room-protocol.ts'
import { providerHandoffText } from '../src/lib/provider-handoff.ts'
import { antigravityExecutableCandidates, type AntigravityExecutableCandidate } from '../server/antigravity-executable.ts'
import { antigravityNetworkInstruction, antigravityVariant, parseAntigravityModels } from '../server/antigravity-protocol.ts'
import { codexSpawnEnvironment } from '../server/codex-launch.ts'

interface AntigravityPromptInput {
  sessionId: string
  conversationId?: string
  cwd: string
  model: string
  effort: string
  permission: AntigravityPermissionMode
  network: EffectiveNetworkMode
  prompt: string
  context?: ProviderHandoffMessage[]
}

interface ActiveTurn {
  process: ChildProcessWithoutNullStreams
  sessionId: string
  turnId: string
  conversationId?: string
  prompt: string
  modelName: string
  answer: string
  thoughts: ProcessBlock[]
  tools: Map<string, Extract<ProcessBlock, { kind: 'tool' }>>
  resultSeen: boolean
  settled: boolean
  resolve: (value: AntigravityPromptResult) => void
  reject: (reason: Error) => void
  initTimer: ReturnType<typeof setTimeout>
  stdout: string
  stderr: string
  releaseSlot: () => void
}

interface PersistedThreads {
  version: 1
  conversations: Record<string, ConversationMessage[]>
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2).slice(0, 40_000)
  } catch {
    return String(value).slice(0, 40_000)
  }
}

function toolStatus(state: string | undefined): ToolStatus {
  if (state === 'ACTIVE' || state === 'PENDING') return 'running'
  if (state === 'ERROR' || state === 'FAILED' || state === 'CANCELLED') return 'failed'
  return 'succeeded'
}

async function executable(): Promise<AntigravityExecutableCandidate> {
  for (const candidate of antigravityExecutableCandidates()) {
    try {
      await access(candidate.path)
      return candidate
    } catch {
      // Continue through the official user-local and PATH candidates.
    }
  }
  throw new Error('Antigravity CLI was not found. Install `agy` from antigravity.google or set DEEPSEEK_HARNESS_ANTIGRAVITY_BIN.')
}

async function collect(candidate: AntigravityExecutableCandidate, args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.path, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: codexSpawnEnvironment(candidate.path),
      shell: candidate.shell,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Antigravity CLI timed out during ${args[0] ?? 'request'}`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reason => {
      clearTimeout(timer)
      reject(reason)
    })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `Antigravity CLI exited with code ${code ?? 'unknown'}`))
    })
  })
}

/** Desktop-owned bridge over AGY's stable print-mode NDJSON stream. */
export class AntigravityCli {
  private catalogCache?: AntigravityCatalogModel[]
  private version?: string
  private readonly activeByTurn = new Map<string, ActiveTurn>()
  private readonly messagesByConversation = new Map<string, ConversationMessage[]>()
  private loaded?: Promise<void>
  private persistChain = Promise.resolve()
  private turnLaunchTail: Promise<void> = Promise.resolve()
  private shuttingDown = false

  constructor(
    private readonly stateFile: string,
    private readonly publish: (event: AntigravityEvent) => void,
  ) {}

  async catalog(refresh = false): Promise<AntigravityCatalog> {
    try {
      if (!refresh && this.catalogCache !== undefined) {
        return { available: true, authenticatedWith: 'Google', ...(this.version === undefined ? {} : { version: this.version }), models: this.catalogCache }
      }
      const candidate = await executable()
      const [version, modelsOutput] = await Promise.all([
        collect(candidate, ['--version'], 15_000),
        collect(candidate, ['models'], 45_000),
      ])
      const models = parseAntigravityModels(modelsOutput)
      if (models.length === 0) throw new Error('Antigravity CLI returned no models. Open `agy` once and complete Google sign-in.')
      this.version = version.trim()
      this.catalogCache = models
      return { available: true, authenticatedWith: 'Google', version: this.version, models }
    } catch (reason) {
      return { available: false, authenticatedWith: 'Google', models: [], error: errorMessage(reason) }
    }
  }

  async plugins(): Promise<PluginControlSnapshot> {
    const candidate = await executable()
    const output = await collect(candidate, ['plugins', 'list'], 30_000)
    const entries = output.split(/\r?\n/).flatMap(line => {
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim()
      if (clean === '' || /no imported plugins/i.test(clean) || /^name\s+/i.test(clean)) return []
      const match = clean.match(/^([@A-Za-z0-9._/-]+)(?:\s+|\s*[-:])([\s\S]*)$/)
      if (match === null) return []
      const name = match[1]
      const detail = match[2]?.trim() ?? ''
      if (name === undefined || !/^[@A-Za-z0-9._/-]{1,160}$/.test(name)) return []
      const disabled = /\bdisabled\b|\boff\b/i.test(detail)
      return [{
        entryId: `antigravity:${name}`,
        moduleName: `Antigravity · ${name}`,
        enabled: !disabled,
        fiberPhase: disabled ? null : 'active' as const,
        controllable: true,
      }]
    })
    return { profile: 'Host + Antigravity CLI', configFile: 'Harness Host + ~/.gemini/antigravity-cli', entries }
  }

  async togglePlugin(entryId: string, enabled: boolean): Promise<PluginToggleResult> {
    const match = entryId.match(/^antigravity:([@A-Za-z0-9._/-]{1,160})$/)
    if (match?.[1] === undefined) throw new Error('Antigravity plugin id is invalid')
    const candidate = await executable()
    await collect(candidate, ['plugins', enabled ? 'enable' : 'disable', match[1]], 60_000)
    return { changed: true, snapshot: await this.plugins() }
  }

  async prompt(input: AntigravityPromptInput): Promise<AntigravityPromptResult> {
    this.assertPrompt(input)
    if (this.shuttingDown) throw new Error('Antigravity CLI bridge is shutting down')
    await this.ensureLoaded()
    const candidate = await executable()
    const catalog = this.catalogCache ?? (await this.catalog(true)).models
    const model = catalog.find(item => item.id === input.model)
    if (model === undefined) throw new Error(`Antigravity model ${input.model} is unavailable`)
    const variant = antigravityVariant(model, input.effort)
    if (variant === undefined) throw new Error(`${input.effort} is not supported by ${model.name}`)
    const releaseSlot = await this.reserveTurnSlot()
    if (this.shuttingDown) {
      releaseSlot()
      throw new Error('Antigravity CLI bridge is shutting down')
    }
    const turnId = randomUUID()
    const args = this.promptArguments(input, variant, model.name)
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(candidate.path, args, {
        cwd: input.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: codexSpawnEnvironment(candidate.path),
        shell: candidate.shell,
      })
      child.stdin.end()
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
    } catch (reason) {
      releaseSlot()
      throw reason
    }
    return new Promise((resolve, reject) => {
      const turn: ActiveTurn = {
        process: child,
        sessionId: input.sessionId,
        turnId,
        ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
        prompt: input.prompt,
        modelName: model.name,
        answer: '',
        thoughts: [],
        tools: new Map(),
        resultSeen: false,
        settled: false,
        resolve,
        reject,
        initTimer: setTimeout(() => {
          if (turn.settled) return
          turn.settled = true
          child.kill('SIGTERM')
          reject(new Error('Antigravity CLI did not initialize its event stream'))
        }, 45_000),
        stdout: '',
        stderr: '',
        releaseSlot,
      }
      this.activeByTurn.set(turnId, turn)
      child.stdout.on('data', (chunk: string) => this.consume(turn, chunk))
      child.stderr.on('data', (chunk: string) => { turn.stderr = `${turn.stderr}${chunk}`.slice(-12_000) })
      child.on('error', reason => this.failTurn(turn, reason))
      child.on('exit', (code, signal) => this.finishProcess(turn, code, signal))
    })
  }

  async readThread(conversationId: string): Promise<AntigravityThreadSnapshot> {
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(conversationId)) throw new Error('Antigravity conversation id is invalid')
    await this.ensureLoaded()
    return { conversationId, messages: this.messagesByConversation.get(conversationId) ?? [] }
  }

  interrupt(conversationId: string, turnId: string): void {
    const turn = this.activeByTurn.get(turnId)
    if (turn === undefined || turn.conversationId !== conversationId) throw new Error('Antigravity turn is no longer running')
    turn.process.kill('SIGTERM')
  }

  shutdown(): void {
    this.shuttingDown = true
    for (const turn of this.activeByTurn.values()) turn.process.kill('SIGTERM')
  }

  private async reserveTurnSlot(): Promise<() => void> {
    const previous = this.turnLaunchTail
    let unlock: (() => void) | undefined
    this.turnLaunchTail = new Promise<void>(resolve => { unlock = resolve })
    await previous
    let released = false
    return () => {
      if (released) return
      released = true
      unlock?.()
    }
  }

  private promptArguments(input: AntigravityPromptInput, variant: string, modelName: string): string[] {
    const handoff = input.context === undefined || input.context.length === 0
      ? ''
      : providerHandoffText('DeepSeek Harness', { messages: input.context, omitted: 0 })
    const prompt = [
      antigravityNetworkInstruction(input.network),
      desktopAgentRoomCapability('Antigravity', modelName),
      handoff,
      `<current_user_message>\n${input.prompt}\n</current_user_message>`,
    ].filter(Boolean).join('\n\n')
    const args = [
      ...(input.conversationId === undefined ? [] : ['--conversation', input.conversationId]),
      '--print', prompt,
      '--output-format', 'stream-json',
      '--model', variant,
      '--effort', input.effort,
      '--print-timeout', '30m',
    ]
    if (input.permission === 'read-only') args.push('--mode', 'plan', '--sandbox')
    if (input.permission === 'workspace-write') args.push('--mode', 'accept-edits', '--sandbox', '--dangerously-skip-permissions')
    if (input.permission === 'full-access') args.push('--mode', 'accept-edits', '--dangerously-skip-permissions')
    return args
  }

  private consume(turn: ActiveTurn, chunk: string): void {
    turn.stdout += chunk
    for (;;) {
      const newline = turn.stdout.indexOf('\n')
      if (newline < 0) return
      const line = turn.stdout.slice(0, newline).trim()
      turn.stdout = turn.stdout.slice(newline + 1)
      if (line === '') continue
      try {
        this.onEvent(turn, JSON.parse(line) as unknown)
      } catch (reason) {
        this.publish({ type: 'error', sessionId: turn.sessionId, ...(turn.conversationId === undefined ? {} : { threadId: turn.conversationId }), turnId: turn.turnId, message: `Antigravity protocol error: ${errorMessage(reason)}` })
      }
    }
  }

  private onEvent(turn: ActiveTurn, value: unknown): void {
    const envelope = record(value)
    const event = string(envelope?.['event'])
    if (event === 'init') {
      const conversationId = string(envelope?.['conversation_id']) ?? string(record(envelope?.['init'])?.['conversation_id'])
      if (conversationId === undefined) throw new Error('Antigravity init event has no conversation id')
      turn.conversationId = conversationId
      this.appendUser(turn)
      this.publish({ type: 'turn-started', sessionId: turn.sessionId, threadId: conversationId, turnId: turn.turnId })
      if (!turn.settled) {
        clearTimeout(turn.initTimer)
        turn.settled = true
        turn.resolve({ conversationId, turnId: turn.turnId })
      }
      return
    }
    if (event === 'step_update') {
      this.onStep(turn, record(envelope?.['step_update']))
      return
    }
    if (event === 'result') this.onResult(turn, record(envelope?.['result']))
  }

  private onStep(turn: ActiveTurn, step: Record<string, unknown> | undefined): void {
    if (step === undefined || turn.conversationId === undefined) return
    const stepType = string(step['step_type']) ?? 'unknown'
    const stepIndex = number(step['step_index']) ?? 0
    const delta = string(step['text_delta'])
    if (delta !== undefined) {
      if (stepType === 'agent_response') turn.answer += delta
      else {
        const previous = turn.thoughts.at(-1)
        if (previous?.kind === 'reasoning') {
          turn.thoughts[turn.thoughts.length - 1] = { ...previous, text: previous.text + delta }
        } else {
          turn.thoughts.push({ kind: 'reasoning', text: delta })
        }
      }
      this.publish({
        type: stepType === 'agent_response' ? 'assistant-delta' : 'reasoning-delta',
        sessionId: turn.sessionId,
        threadId: turn.conversationId,
        turnId: turn.turnId,
        itemId: `agy-step-${stepIndex}`,
        delta,
      })
    }
    if (stepType !== 'tool') return
    const info = record(step['tool_info'])
    const name = string(step['tool_name']) ?? string(info?.['name']) ?? 'tool'
    const callId = `agy-${turn.turnId}-${stepIndex}`
    const status = toolStatus(string(step['state']))
    const previous = turn.tools.get(callId)
    const output = info?.['output']
    const block: Extract<ProcessBlock, { kind: 'tool' }> = {
      kind: 'tool',
      name,
      arguments: safeJson(info?.['parameters']),
      callId,
      status,
      ...(previous?.startedAt === undefined && status === 'running' ? { startedAt: Date.now() } : previous?.startedAt === undefined ? {} : { startedAt: previous.startedAt }),
      ...(status === 'running' ? {} : { finishedAt: Date.now() }),
      ...(output === undefined ? previous?.result === undefined ? {} : { result: previous.result } : { result: safeJson(output) }),
    }
    turn.tools.set(callId, block)
    this.publish({ type: 'tool-item', sessionId: turn.sessionId, threadId: turn.conversationId, turnId: turn.turnId, block })
  }

  private onResult(turn: ActiveTurn, result: Record<string, unknown> | undefined): void {
    if (turn.conversationId === undefined) return
    turn.resultSeen = true
    const response = string(result?.['response']) ?? ''
    if (turn.answer === '' && response !== '') {
      turn.answer = response
      this.publish({ type: 'assistant-delta', sessionId: turn.sessionId, threadId: turn.conversationId, turnId: turn.turnId, itemId: `agy-result-${turn.turnId}`, delta: response })
    }
    const rawStatus = string(result?.['status'])
    const status = rawStatus === 'SUCCESS' ? 'completed' : rawStatus === 'CANCELLED' ? 'interrupted' : 'failed'
    this.commitAssistant(turn)
    this.publish({
      type: 'turn-completed',
      sessionId: turn.sessionId,
      threadId: turn.conversationId,
      turnId: turn.turnId,
      status,
      ...(status === 'failed' ? { error: string(result?.['error']) ?? 'Antigravity turn failed' } : {}),
    })
  }

  private appendUser(turn: ActiveTurn): void {
    const conversationId = turn.conversationId
    if (conversationId === undefined) return
    const messages = [...(this.messagesByConversation.get(conversationId) ?? [])]
    messages.push({
      id: `agy-user-${turn.turnId}`,
      seq: (messages.at(-1)?.seq ?? 0) + 1,
      time: Date.now(),
      role: 'user',
      blocks: [{ kind: 'text', text: turn.prompt }],
    })
    this.messagesByConversation.set(conversationId, messages)
    this.persist()
  }

  private commitAssistant(turn: ActiveTurn): void {
    const conversationId = turn.conversationId
    if (conversationId === undefined) return
    const messages = [...(this.messagesByConversation.get(conversationId) ?? [])]
    if (messages.some(message => message.id === `agy-turn-${turn.turnId}`)) return
    const thought = [...turn.thoughts, ...turn.tools.values()]
    messages.push({
      id: `agy-turn-${turn.turnId}`,
      seq: (messages.at(-1)?.seq ?? 0) + 1,
      time: Date.now(),
      role: 'assistant',
      agent: 'Antigravity',
      modelName: turn.modelName,
      blocks: joinTurnBlocks(thought, turn.answer === '' ? [] : [{ kind: 'text', text: turn.answer }]),
      streaming: false,
    })
    this.messagesByConversation.set(conversationId, messages)
    this.persist()
  }

  private finishProcess(turn: ActiveTurn, code: number | null, signal: NodeJS.Signals | null): void {
    clearTimeout(turn.initTimer)
    this.activeByTurn.delete(turn.turnId)
    turn.releaseSlot()
    if (!turn.settled) {
      turn.settled = true
      turn.reject(new Error(turn.stderr.trim() || turn.stdout.trim() || `Antigravity CLI exited before initialization (${signal ?? code ?? 'unknown'})`))
      return
    }
    if (turn.resultSeen) return
    this.commitAssistant(turn)
    if (turn.conversationId !== undefined) {
      const interrupted = signal === 'SIGTERM' || signal === 'SIGINT'
      this.publish({
        type: 'turn-completed',
        sessionId: turn.sessionId,
        threadId: turn.conversationId,
        turnId: turn.turnId,
        status: interrupted ? 'interrupted' : 'failed',
        ...(interrupted ? {} : { error: turn.stderr.trim() || `Antigravity CLI exited with code ${code ?? 'unknown'}` }),
      })
    }
  }

  private failTurn(turn: ActiveTurn, reason: unknown): void {
    clearTimeout(turn.initTimer)
    this.activeByTurn.delete(turn.turnId)
    turn.releaseSlot()
    if (!turn.settled) {
      turn.settled = true
      turn.reject(reason instanceof Error ? reason : new Error(errorMessage(reason)))
      return
    }
    this.publish({ type: 'error', sessionId: turn.sessionId, ...(turn.conversationId === undefined ? {} : { threadId: turn.conversationId }), turnId: turn.turnId, message: errorMessage(reason) })
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= readFile(this.stateFile, 'utf8').then(text => {
      const parsed = JSON.parse(text) as PersistedThreads
      if (parsed.version !== 1 || typeof parsed.conversations !== 'object') return
      Object.entries(parsed.conversations).forEach(([id, messages]) => {
        if (Array.isArray(messages)) this.messagesByConversation.set(id, messages)
      })
    }).catch(() => undefined)
    return this.loaded
  }

  private persist(): void {
    const payload: PersistedThreads = { version: 1, conversations: Object.fromEntries(this.messagesByConversation) }
    this.persistChain = this.persistChain.then(async () => {
      await mkdir(dirname(this.stateFile), { recursive: true })
      const temporary = `${this.stateFile}.tmp`
      await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 })
      await rename(temporary, this.stateFile)
    }).catch(() => undefined)
  }

  private assertPrompt(input: AntigravityPromptInput): void {
    if (!/^[A-Za-z0-9._:-]{1,240}$/.test(input.sessionId)) throw new Error('Antigravity session id is invalid')
    if (input.conversationId !== undefined && !/^[A-Za-z0-9._-]{1,200}$/.test(input.conversationId)) throw new Error('Antigravity conversation id is invalid')
    if (input.prompt.trim() === '' || input.prompt.length > 1_000_000) throw new Error('Antigravity prompt must not be empty')
    if (!input.cwd.startsWith('/') && process.platform !== 'win32') throw new Error('Antigravity working directory must be absolute')
    if (input.permission !== 'read-only' && input.permission !== 'workspace-write' && input.permission !== 'full-access') {
      throw new Error('Antigravity permission mode is invalid')
    }
    if (input.context !== undefined) {
      if (input.context.length > 24) throw new Error('Antigravity handoff context is too large')
      const characters = input.context.reduce((total, message) => total + message.text.length, 0)
      if (characters > 24_000 || input.context.some(message => message.text.trim() === '' || (message.role !== 'user' && message.role !== 'assistant'))) {
        throw new Error('Antigravity handoff context is invalid')
      }
    }
  }
}
