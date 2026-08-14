import type {
  ConversationMessage,
  DshEvent,
  HistoryEntry,
  MessageBlock,
  ImageMediaType,
  QueueItem,
} from './types.ts'

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
    return {
      kind: 'tool',
      name: string(item?.['name']) ?? 'tool',
      arguments: string(item?.['arguments']) ?? '',
      ...(string(item?.['id']) === undefined ? {} : { callId: string(item?.['id']) }),
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

function contentBlocks(value: unknown): MessageBlock[] {
  return Array.isArray(value) ? value.map(blockFromContent) : []
}

interface PartialStep {
  turn: number
  step: number
  seq: number
  time: number
  blocks: Array<MessageBlock | undefined>
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

/** Convert the public history wire events into the small transcript this GUI owns. */
export function projectConversation(entries: HistoryEntry[]): ConversationMessage[] {
  const messages: ConversationMessage[] = []
  const partials = new Map<string, PartialStep>()
  const finalized = new Set<string>()

  for (const { event } of entries) {
    if (event.type === 'user/message') {
      const source = record(event.data['source'])
      const sourceKind = string(source?.['kind'])
      if (sourceKind !== 'user' && sourceKind !== 'steering') continue
      messages.push({
        id: string(event.data['id']) ?? `user-${event.seq}`,
        seq: event.seq,
        time: event.time,
        role: 'user',
        blocks: contentBlocks(event.data['content']),
      })
      continue
    }

    if (event.type === 'assistant/chunk') {
      const turn = number(event.data['turn'])
      const step = number(event.data['step'])
      if (turn === undefined || step === undefined) continue
      const key = stepKey(turn, step)
      const partial = partials.get(key) ?? {
        turn,
        step,
        seq: event.seq,
        time: event.time,
        blocks: [],
      }
      applyChunk(partial, event.data['chunk'])
      partials.set(key, partial)
      continue
    }

    if (event.type === 'assistant/message') {
      const turn = number(event.data['turn'])
      const step = number(event.data['step'])
      const message = record(event.data['message'])
      if (turn === undefined || step === undefined || message === undefined) continue
      finalized.add(stepKey(turn, step))
      messages.push({
        id: string(message['id']) ?? `assistant-${event.seq}`,
        seq: event.seq,
        time: event.time,
        role: 'assistant',
        blocks: contentBlocks(message['content']),
        ...(event.data['usage'] === undefined ? {} : { usage: event.data['usage'] }),
      })
    }
  }

  for (const [key, partial] of partials) {
    if (finalized.has(key)) continue
    const blocks = partial.blocks.filter((block): block is MessageBlock => block !== undefined)
    if (!blocks.some(block => block.kind === 'tool' || (block.kind !== 'other' && 'text' in block && block.text !== ''))) continue
    messages.push({
      id: `partial-${key}`,
      seq: partial.seq,
      time: partial.time,
      role: 'assistant',
      blocks,
      streaming: true,
    })
  }

  return messages.sort((left, right) => left.seq - right.seq)
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
  return content.map(item => string(record(item)?.['text']) ?? '').join('')
}

function queuePreview(content: unknown[]): string {
  const text = content.map(item => {
    const block = record(item)
    if (block?.['type'] === 'text') return string(block['text']) ?? ''
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
