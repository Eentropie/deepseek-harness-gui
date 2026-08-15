import type { CodexEvent, ConversationMessage, ProcessBlock } from './types.ts'
import { joinTurnBlocks, splitTurnBlocks } from './thought-process.ts'

export type CodexDeltaEvent = Extract<CodexEvent, { type: 'assistant-delta' | 'reasoning-delta' }>
export type CodexToolEvent = Extract<CodexEvent, { type: 'tool-item' }>

function ensureTurn(current: ConversationMessage[], turnId: string, now: number): { next: ConversationMessage[]; index: number } {
  const id = `codex-turn-${turnId}`
  const index = current.findIndex(message => message.id === id)
  if (index >= 0) return { next: [...current], index }
  return {
    next: [...current, {
      id,
      seq: (current.at(-1)?.seq ?? 0) + 1,
      time: now,
      role: 'assistant',
      agent: 'Codex',
      blocks: [],
      streaming: true,
    }],
    index: current.length,
  }
}

export function applyCodexToolEvent(
  current: ConversationMessage[],
  event: CodexToolEvent,
  now = Date.now(),
): ConversationMessage[] {
  const { next, index } = ensureTurn(current, event.turnId, now)
  const existing = next[index]
  if (existing === undefined) return current
  const { thought, answer } = splitTurnBlocks(existing.blocks)
  const toolIndex = thought.findIndex(block => block.kind === 'tool' && block.callId === event.block.callId)
  const nextThought = [...thought]
  if (toolIndex < 0) nextThought.push(event.block)
  else {
    const previous = nextThought[toolIndex]
    nextThought[toolIndex] = previous?.kind === 'tool'
      ? {
          ...previous,
          ...event.block,
          ...(event.block.startedAt === undefined && previous.startedAt !== undefined ? { startedAt: previous.startedAt } : {}),
        }
      : event.block
  }
  next[index] = { ...existing, blocks: joinTurnBlocks(nextThought, answer), streaming: true }
  return next
}

/** Apply a visual batch while retaining every untouched message reference. */
export function applyCodexDeltas(
  current: ConversationMessage[],
  events: readonly CodexDeltaEvent[],
  now = Date.now(),
): ConversationMessage[] {
  if (events.length === 0) return current
  const next = [...current]
  const indexes = new Map(next.map((message, index) => [message.id, index]))

  for (const event of events) {
    const id = `codex-turn-${event.turnId}`
    let index = indexes.get(id)
    if (index === undefined) {
      indexes.set(id, next.length)
      next.push({
        id,
        seq: (next.at(-1)?.seq ?? 0) + 1,
        time: now,
        role: 'assistant',
        agent: 'Codex',
        blocks: [],
        streaming: true,
      })
      index = next.length - 1
    }
    const existing = next[index]
    if (existing === undefined) continue
    const { thought, answer } = splitTurnBlocks(existing.blocks)
    let nextThought: ProcessBlock[] = thought
    let nextAnswer: ProcessBlock[] = answer
    let streamAssistantItemId = existing.streamAssistantItemId
    let streamReasoningItemId = existing.streamReasoningItemId

    if (event.type === 'reasoning-delta') {
      nextThought = [...thought]
      const last = nextThought.at(-1)
      if (streamReasoningItemId === event.itemId && last?.kind === 'reasoning') {
        nextThought[nextThought.length - 1] = { ...last, text: last.text + event.delta }
      } else {
        nextThought.push({ kind: 'reasoning', text: event.delta })
      }
      streamReasoningItemId = event.itemId
    } else {
      if (streamAssistantItemId !== undefined && streamAssistantItemId !== event.itemId && answer.length > 0) {
        nextThought = [...thought, ...answer]
        nextAnswer = []
      } else {
        nextAnswer = [...answer]
      }
      const last = nextAnswer.at(-1)
      if (streamAssistantItemId === event.itemId && last?.kind === 'text') {
        nextAnswer[nextAnswer.length - 1] = { ...last, text: last.text + event.delta }
      } else {
        nextAnswer.push({ kind: 'text', text: event.delta })
      }
      streamAssistantItemId = event.itemId
    }
    next[index] = {
      ...existing,
      blocks: joinTurnBlocks(nextThought, nextAnswer),
      streaming: true,
      ...(streamAssistantItemId === undefined ? {} : { streamAssistantItemId }),
      ...(streamReasoningItemId === undefined ? {} : { streamReasoningItemId }),
    }
  }
  return next
}
