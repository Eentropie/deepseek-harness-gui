import type {
  ConversationMessage,
  DshEvent,
  DownlinkFrame,
  HistoryEntry,
  HistoryPage,
  MessageBlock,
  ImageMediaType,
  QueueItem,
  ToolStatus,
} from './types.ts'
import { visibleProviderBlocks, visibleProviderText } from './provider-handoff.ts'
import { composeTurnBlocks } from './thought-process.ts'
import { webToolView } from './web-tools.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function imageMediaType(value: unknown): ImageMediaType | undefined {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
    ? value
    : undefined
}

function blockFromContent(value: unknown): MessageBlock {
  const item = record(value)
  const type = string(item?.['type'])
  if (type === 'text') return { kind: 'text', text: string(item?.['text']) ?? '' }
  if (type === 'reasoning') return { kind: 'reasoning', text: string(item?.['text']) ?? '' }
  if (type === 'tool-call') {
    const callId = string(item?.['id']) ?? string(item?.['toolCallId'])
    return {
      kind: 'tool',
      name: string(item?.['name']) ?? 'tool',
      arguments: textValue(item?.['arguments']),
      ...(callId === undefined ? {} : { callId }),
    }
  }
  if (type === 'image') {
    const attachment = record(item?.['attachment'])
    const mediaType = imageMediaType(attachment?.['mediaType'])
    const attachmentId = string(attachment?.['attachmentId'])
    return {
      kind: 'image',
      label: string(attachment?.['name']) ?? 'Image attachment',
      ...(attachmentId === undefined ? {} : { attachmentId }),
      ...(mediaType === undefined ? {} : { mediaType }),
      ...(string(attachment?.['name']) === undefined ? {} : { name: string(attachment?.['name']) }),
    }
  }
  return { kind: 'other', value }
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolResult(value: Record<string, unknown>): { callId?: string; result: string; isError: boolean; errorCode?: string } {
  const message = record(value['message'])
  const source = record(message?.['source'])
  const content = Array.isArray(message?.['content']) ? message['content'] : Array.isArray(value['content']) ? value['content'] : []
  const toolPart = content.map(record).find(item => item?.['type'] === 'tool-result')
  const nested = Array.isArray(toolPart?.['content']) ? toolPart?.['content'] : content
  const result = (nested ?? []).flatMap(item => {
    const part = record(item)
    return part?.['type'] === 'text' && typeof part['text'] === 'string' ? [part['text']] : []
  }).join('\n\n')
  const error = record(value['error'])
  return {
    callId: string(value['callId']) ?? string(source?.['callId']) ?? string(toolPart?.['toolCallId']),
    result,
    isError: value['isError'] === true || toolPart?.['isError'] === true || error !== undefined,
    ...(string(error?.['code']) === undefined ? {} : { errorCode: string(error?.['code']) }),
  }
}

function toolStatus(isError: boolean, code: string | undefined, result: string): ToolStatus {
  if (!isError) return 'succeeded'
  return /cancel|abort|interrupt/i.test(`${code ?? ''} ${result}`) ? 'cancelled' : 'failed'
}

function contentBlocks(value: unknown): MessageBlock[] {
  return Array.isArray(value)
    ? visibleProviderBlocks(value.map(blockFromContent))
    : []
}

interface PartialStep {
  turn: number
  step: number
  seq: number
  time: number
  blocks: Array<MessageBlock | undefined>
}

interface AssistantStep {
  step: number
  seq: number
  time: number
  blocks: MessageBlock[]
  usage?: unknown
}

function applyChunk(step: PartialStep, chunkValue: unknown): void {
  const chunk = record(chunkValue)
  const type = string(chunk?.['type'])
  const index = number(chunk?.['index'])
  if (index === undefined || index < 0) return
  if (type === 'block-start') {
    const blockType = string(chunk?.['blockType'])
    if (blockType === 'reasoning') step.blocks[index] = { kind: 'reasoning', text: '' }
    else if (blockType === 'text') step.blocks[index] = { kind: 'text', text: '' }
    return
  }
  if (type === 'text-delta' || type === 'reasoning-delta') {
    const kind = type === 'text-delta' ? 'text' : 'reasoning'
    const previous = step.blocks[index]
    const prefix = previous?.kind === kind ? previous.text : ''
    step.blocks[index] = { kind, text: prefix + (string(chunk?.['text']) ?? '') }
    return
  }
  if (type === 'tool-call-delta') {
    const previous = step.blocks[index]
    const prior = previous?.kind === 'tool'
      ? previous
      : { kind: 'tool' as const, name: '', arguments: '', callId: '' }
    step.blocks[index] = {
      kind: 'tool',
      name: string(chunk?.['name']) ?? prior.name,
      arguments: prior.arguments + (string(chunk?.['argumentsDelta']) ?? ''),
      callId: string(chunk?.['id']) ?? prior.callId,
    }
    return
  }
  if (type === 'block-end') step.blocks[index] = blockFromContent(chunk?.['block'])
}

function stepKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

/** Incrementally project an append-only history tail without rescanning settled events. */
export class ConversationProjector {
  private entries: HistoryEntry[] = []
  private messages: ConversationMessage[] = []
  private readonly partials = new Map<string, PartialStep>()
  private readonly finalized = new Set<string>()
  private readonly turns = new Map<number, Map<number, AssistantStep>>()
  private readonly turnIndexes = new Map<number, number>()
  private readonly tools = new Map<string, Extract<MessageBlock, { kind: 'tool' }>>()
  private snapshotCache: ConversationMessage[] = []
  private dirty = true

  sync(entries: HistoryEntry[]): ConversationMessage[] {
    const appendOnly = this.entries.length <= entries.length
      && this.entries.every((entry, index) => entry.event.seq === entries[index]?.event.seq)
    if (!appendOnly) this.reset()
    const start = this.entries.length
    this.entries = entries
    for (let index = start; index < entries.length; index += 1) {
      const entry = entries[index]
      if (entry !== undefined) this.ingest(entry)
    }
    return this.snapshot()
  }

  private reset(): void {
    this.entries = []
    this.messages = []
    this.partials.clear()
    this.finalized.clear()
    this.turns.clear()
    this.turnIndexes.clear()
    this.tools.clear()
    this.snapshotCache = []
    this.dirty = true
  }

  private ingest(entry: HistoryEntry): void {
    const { event } = entry
    if (event.type === 'user/message') {
      const source = record(event.data['source'])
      const sourceKind = string(source?.['kind'])
      if (sourceKind !== 'user' && sourceKind !== 'steering') return
      this.messages.push({
        id: string(event.data['id']) ?? `user-${event.seq}`,
        seq: event.seq,
        time: event.time,
        role: 'user',
        blocks: contentBlocks(event.data['content']),
      })
      this.dirty = true
      return
    }

    if (event.type === 'tool/call') {
      const callId = string(event.data['callId']) ?? string(event.data['id'])
      if (callId === undefined) return
      const name = string(event.data['name']) ?? 'tool'
      const argumentsText = textValue(event.data['arguments'])
      this.tools.set(callId, {
        kind: 'tool',
        name,
        arguments: argumentsText,
        callId,
        status: 'running',
        startedAt: event.time,
        ...(webToolView(entry.view, argumentsText) === undefined ? {} : { view: webToolView(entry.view, argumentsText) }),
      })
      this.dirty = true
      return
    }

    if (event.type === 'tool/result') {
      const result = toolResult(event.data)
      if (result.callId === undefined) return
      const previous = this.tools.get(result.callId)
      const view = webToolView(entry.view, previous?.arguments)
      this.tools.set(result.callId, {
        kind: 'tool',
        name: previous?.name ?? 'tool',
        arguments: previous?.arguments ?? '',
        callId: result.callId,
        status: toolStatus(result.isError, result.errorCode, result.result),
        ...(result.result === '' ? {} : { result: result.result }),
        ...(previous?.startedAt === undefined ? {} : { startedAt: previous.startedAt }),
        finishedAt: event.time,
        ...(view === undefined ? previous?.view === undefined ? {} : { view: previous.view } : { view }),
      })
      this.dirty = true
      return
    }

    if (event.type === 'assistant/chunk') {
      const turn = number(event.data['turn'])
      const step = number(event.data['step'])
      if (turn === undefined || step === undefined) return
      const key = stepKey(turn, step)
      const partial = this.partials.get(key) ?? {
        turn,
        step,
        seq: event.seq,
        time: event.time,
        blocks: [],
      }
      applyChunk(partial, event.data['chunk'])
      this.partials.set(key, partial)
      this.dirty = true
      return
    }

    if (event.type === 'assistant/message') {
      const turn = number(event.data['turn'])
      const step = number(event.data['step'])
      const message = record(event.data['message'])
      if (turn === undefined || step === undefined || message === undefined) return
      this.finalized.add(stepKey(turn, step))
      const steps = this.turns.get(turn) ?? new Map<number, AssistantStep>()
      steps.set(step, {
        step,
        seq: event.seq,
        time: event.time,
        blocks: contentBlocks(message['content']),
        ...(event.data['usage'] === undefined ? {} : { usage: event.data['usage'] }),
      })
      this.turns.set(turn, steps)
      const projected = this.projectTurn(turn, [...steps.values()])
      const index = this.turnIndexes.get(turn)
      if (index === undefined) {
        this.turnIndexes.set(turn, this.messages.length)
        this.messages.push(projected)
      } else {
        this.messages[index] = projected
      }
      this.dirty = true
    }
  }

  private projectTurn(turn: number, steps: AssistantStep[], streaming = false): ConversationMessage {
    const ordered = steps.sort((left, right) => left.step - right.step || left.seq - right.seq)
    const tail = ordered.at(-1)
    return {
      id: `assistant-turn-${turn}`,
      seq: tail?.seq ?? 0,
      time: tail?.time ?? 0,
      role: 'assistant',
      blocks: composeTurnBlocks(ordered.map(item => item.blocks)),
      ...(streaming ? { streaming: true } : {}),
      ...(tail?.usage === undefined ? {} : { usage: tail.usage }),
    }
  }

  private snapshot(): ConversationMessage[] {
    if (!this.dirty) return this.snapshotCache
    const messages = [...this.messages]
    const partialTurns = new Map<number, AssistantStep[]>()
    for (const [key, partial] of this.partials) {
      if (this.finalized.has(key)) continue
      const blocks = partial.blocks.filter((block): block is MessageBlock => block !== undefined)
      if (!blocks.some(block => block.kind === 'tool' || (block.kind !== 'other' && 'text' in block && block.text !== ''))) continue
      const steps = partialTurns.get(partial.turn) ?? [...(this.turns.get(partial.turn)?.values() ?? [])]
      steps.push({ step: partial.step, seq: partial.seq, time: partial.time, blocks })
      partialTurns.set(partial.turn, steps)
    }
    for (const [turn, steps] of partialTurns) {
      const projected = this.projectTurn(turn, steps, true)
      const index = this.turnIndexes.get(turn)
      if (index === undefined) messages.push(projected)
      else messages[index] = projected
    }
    const previousById = new Map(this.snapshotCache.map(message => [message.id, message]))
    const projected = messages
      .map(message => {
        const blocks = this.decorateBlocks(message.blocks)
        return blocks === message.blocks ? message : { ...message, blocks }
      })
      .sort((left, right) => left.seq - right.seq)
    this.snapshotCache = projected.map(message => {
      const previous = previousById.get(message.id)
      return previous !== undefined && conversationMessagesEqual(previous, message) ? previous : message
    })
    this.dirty = false
    return this.snapshotCache
  }

  private decorateBlocks(blocks: MessageBlock[]): MessageBlock[] {
    let changed = false
    const decorated = blocks.map(block => {
      if (block.kind === 'thought') {
        const nested = this.decorateProcessBlocks(block.blocks)
        if (nested === block.blocks) return block
        changed = true
        return { ...block, blocks: nested }
      }
      if (block.kind !== 'tool' || block.callId === undefined) return block
      const next = this.tools.get(block.callId) ?? block
      if (next !== block) changed = true
      return next
    })
    return changed ? decorated : blocks
  }

  private decorateProcessBlocks(blocks: import('./types.ts').ProcessBlock[]): import('./types.ts').ProcessBlock[] {
    let changed = false
    const decorated = blocks.map(block => {
      if (block.kind !== 'tool' || block.callId === undefined) return block
      const next = this.tools.get(block.callId) ?? block
      if (next !== block) changed = true
      return next
    })
    return changed ? decorated : blocks
  }
}

/** Convert the public history wire events into the small transcript this GUI owns. */
export function projectConversation(entries: HistoryEntry[]): ConversationMessage[] {
  return new ConversationProjector().sync(entries)
}

/** Merge an authoritative tail pull with already-loaded older pages and live events. */
export function mergeHistoryTail(current: HistoryPage, tail: HistoryPage): HistoryPage {
  if (current.events.length === 0) return tail
  const bySeq = new Map<number, HistoryEntry>()
  current.events.forEach(entry => bySeq.set(entry.event.seq, entry))
  tail.events.forEach(entry => {
    if (!bySeq.has(entry.event.seq)) bySeq.set(entry.event.seq, entry)
  })
  const currentFirst = current.events[0]?.event.seq
  const tailFirst = tail.events[0]?.event.seq
  const keptOlderWindow = currentFirst !== undefined && tailFirst !== undefined && currentFirst < tailFirst
  return {
    events: [...bySeq.values()].sort((left, right) => left.event.seq - right.event.seq),
    hasMore: keptOlderWindow ? current.hasMore : tail.hasMore,
    ...(tail.projections === undefined
      ? current.projections === undefined ? {} : { projections: current.projections }
      : { projections: tail.projections }),
  }
}

export interface LiveHistoryAppend {
  page: HistoryPage
  appended: number
  gap: boolean
}

/** Append ordered mux events by seq; any gap asks the caller for one tail repair. */
export function appendLiveHistory(current: HistoryPage, incoming: readonly HistoryEntry[]): LiveHistoryAppend {
  if (incoming.length === 0) return { page: current, appended: 0, gap: false }
  const events = [...incoming].sort((left, right) => left.event.seq - right.event.seq)
  let tailSeq = current.events.at(-1)?.event.seq
  const appended: HistoryEntry[] = []
  for (const entry of events) {
    const seq = entry.event.seq
    if (tailSeq === undefined) {
      if (seq !== 0) return { page: current, appended: 0, gap: true }
      appended.push(entry)
      tailSeq = seq
      continue
    }
    if (seq <= tailSeq) continue
    if (seq !== tailSeq + 1) {
      return {
        page: appended.length === 0 ? current : { ...current, events: [...current.events, ...appended] },
        appended: appended.length,
        gap: true,
      }
    }
    appended.push(entry)
    tailSeq = seq
  }
  return appended.length === 0
    ? { page: current, appended: 0, gap: false }
    : { page: { ...current, events: [...current.events, ...appended] }, appended: appended.length, gap: false }
}

/** Parse the durable event carried by a Host mux frame. */
export function liveHistoryEntry(frame: DownlinkFrame): HistoryEntry | undefined {
  if (frame.type !== 'session/event') return undefined
  const event = record(frame['event'])
  const type = string(event?.['type'])
  const seq = number(event?.['seq'])
  const time = number(event?.['time'])
  const data = record(event?.['data'])
  if (type === undefined || seq === undefined || time === undefined || data === undefined) return undefined
  return {
    event: {
      type,
      seq,
      time,
      data,
      ...(typeof event?.['surfaceOp'] === 'string' ? { surfaceOp: event['surfaceOp'] } : {}),
      ...(Array.isArray(event?.['sourceEventSeqs'])
        ? { sourceEventSeqs: event['sourceEventSeqs'].filter((value): value is number => typeof value === 'number') }
        : {}),
    },
    ...(frame['view'] === undefined ? {} : { view: frame['view'] }),
  }
}

/** Update one live projection only after a tail baseline has established its watermark. */
export function applyLiveProjection(current: HistoryPage, key: string, value: unknown, seq: number): HistoryPage {
  const projections = current.projections
  if (projections === undefined || seq < projections.asOfSeq) return current
  return {
    ...current,
    projections: {
      asOfSeq: Math.max(projections.asOfSeq, seq),
      values: { ...projections.values, [key]: value },
    },
  }
}

export function conversationMessagesEqual(left: ConversationMessage, right: ConversationMessage): boolean {
  if (left === right) return true
  if (left.id !== right.id || left.seq !== right.seq || left.time !== right.time || left.role !== right.role
    || left.agent !== right.agent || left.streaming !== right.streaming || left.transient !== right.transient
    || left.blocks.length !== right.blocks.length) return false
  const blocksEqual = (leftBlocks: MessageBlock[], rightBlocks: MessageBlock[]): boolean => leftBlocks.length === rightBlocks.length && leftBlocks.every((block, index) => {
    const other = rightBlocks[index]
    if (other === undefined || block.kind !== other.kind) return false
    if (block.kind === 'text') return other.kind === 'text' && block.text === other.text
    if (block.kind === 'reasoning') return other.kind === 'reasoning' && block.text === other.text
    if (block.kind === 'tool' && other.kind === 'tool') {
      return block.name === other.name && block.arguments === other.arguments && block.callId === other.callId
        && block.status === other.status && block.result === other.result
        && block.startedAt === other.startedAt && block.finishedAt === other.finishedAt
        && JSON.stringify(block.view) === JSON.stringify(other.view)
    }
    if (block.kind === 'image' && other.kind === 'image') {
      return block.label === other.label && block.attachmentId === other.attachmentId
        && block.mediaType === other.mediaType && block.src === other.src && block.name === other.name
    }
    if (block.kind === 'thought' && other.kind === 'thought') return blocksEqual(block.blocks, other.blocks)
    return block.kind === 'other' && other.kind === 'other' && block.value === other.value
  })
  return blocksEqual(left.blocks, right.blocks)
}

export interface ActivityItem {
  id: string
  label: string
  detail: string
  time: number
  tone: 'neutral' | 'blue' | 'green' | 'amber' | 'red'
}

function reasonText(value: unknown): string {
  const reason = record(value)
  const kind = string(reason?.['kind'])
  if (kind === undefined) return ''
  const failure = record(reason?.['failure'])
  return string(failure?.['message']) ?? kind
}

/** Summarize recent control/tool events for the right-hand inspector. */
export function projectActivity(entries: HistoryEntry[], limit = 14): ActivityItem[] {
  const rows: ActivityItem[] = []
  for (const { event } of entries) {
    let row: Omit<ActivityItem, 'id' | 'time'> | undefined
    switch (event.type) {
      case 'turn/start':
        row = { label: 'Turn started', detail: `Turn ${String(event.data['turn'] ?? '')}`, tone: 'blue' }
        break
      case 'turn/end': {
        const reason = reasonText(event.data['reason'])
        row = {
          label: reason === 'success' || reason === '' ? 'Turn complete' : 'Turn ended',
          detail: reason || `Turn ${String(event.data['turn'] ?? '')}`,
          tone: reason === 'success' || reason === '' ? 'green' : 'amber',
        }
        break
      }
      case 'tool/call':
        row = {
          label: string(event.data['name']) ?? 'Tool call',
          detail: 'Running tool',
          tone: 'blue',
        }
        break
      case 'tool/result': {
        const message = record(event.data['message'])
        row = {
          label: 'Tool result',
          detail: event.data['error'] === undefined ? 'Completed' : string(record(event.data['error'])?.['code']) ?? 'Failed',
          tone: event.data['error'] === undefined ? 'green' : 'red',
        }
        break
      }
      case 'llm/retry':
        row = { label: 'Model retry', detail: 'Waiting to retry', tone: 'amber' }
        break
      case 'command/run':
        row = { label: 'Command', detail: string(event.data['name']) ?? 'Running', tone: 'blue' }
        break
      case 'command/done':
        row = { label: 'Command finished', detail: 'Completed', tone: 'green' }
        break
      case 'permission/preset':
        row = { label: 'Permissions', detail: string(event.data['preset']) ?? 'Updated', tone: 'neutral' }
        break
      case 'session/title':
        row = { label: 'Session renamed', detail: string(event.data['title']) ?? '', tone: 'neutral' }
        break
      default:
        break
    }
    if (row !== undefined) rows.push({ ...row, id: `${event.seq}-${event.type}`, time: event.time })
  }
  return rows.slice(-limit).reverse()
}

/** Find the session identifier carried by a live invalidation frame, if any. */
export function frameSessionId(frame: Record<string, unknown>): string | undefined {
  const direct = string(frame['sessionId'])
  if (direct !== undefined) return direct
  const event = record(frame['event'])
  return string(event?.['sessionId'])
}

function queueContent(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function queueText(content: unknown[]): string | null {
  if (!content.every(item => record(item)?.['type'] === 'text')) return null
  return content.flatMap(item => {
    const visible = visibleProviderText(string(record(item)?.['text']) ?? '')
    return visible === undefined ? [] : [visible]
  }).join('')
}

function queuePreview(content: unknown[]): string {
  const text = content.map(item => {
    const block = record(item)
    if (block?.['type'] === 'text') return visibleProviderText(string(block['text']) ?? '') ?? ''
    return `[${String(block?.['type'] ?? 'content')}]`
  }).join(' ').replace(/\s+/g, ' ').trim()
  return Array.from(text).length > 200 ? `${Array.from(text).slice(0, 200).join('')}…` : text
}

/** Parse the host's authoritative transient queue snapshot. */
export function projectQueue(frame: Record<string, unknown>): QueueItem[] | undefined {
  if (frame['type'] !== 'session/queue' || !Array.isArray(frame['items'])) return undefined
  return frame['items'].flatMap(item => {
    const row = record(item)
    const id = string(row?.['id'])
    const placement = row?.['placement']
    const message = record(row?.['message'])
    if (id === undefined || (placement !== 'queued' && placement !== 'steering' && placement !== 'context')) return []
    const content = queueContent(message?.['content'])
    return [{ id, placement, content, preview: queuePreview(content), text: queueText(content) }]
  })
}

export function eventTypeLabel(event: DshEvent): string {
  return event.type.replaceAll('/', ' · ')
}
