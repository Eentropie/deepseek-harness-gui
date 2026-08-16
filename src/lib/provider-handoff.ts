import type { ConversationMessage, MessageBlock, ProviderHandoffMessage } from './types.ts'
import { isAgentRoomCapabilityText, stripAgentRoomDirective } from './agent-room-protocol.ts'
import { isNetworkPolicyText } from './network-mode.ts'

export const PROVIDER_HANDOFF_MARKER = '[[dsh-provider-handoff:v1]]'

export interface ProviderHandoffBatch {
  messages: ProviderHandoffMessage[]
  throughSeq?: number
  omitted: number
}

function portableBlockText(block: MessageBlock): string | undefined {
  if (block.kind === 'text') {
    const text = stripAgentRoomDirective(block.text).trim()
    return text === '' ? undefined : text
  }
  if (block.kind === 'image') return `[Image attachment: ${block.name ?? block.label}]`
  if (block.kind === 'tool') return `[Tool used: ${block.name}]`
  return undefined
}

function portableMessage(message: ConversationMessage): ProviderHandoffMessage | undefined {
  const text = message.blocks.flatMap(block => portableBlockText(block) ?? []).join('\n\n').trim()
  if (text === '') return undefined
  return { role: message.role, text, seq: message.seq }
}

/** Collect only the newest portable dialogue so provider handoffs stay bounded. */
export function collectProviderHandoff(
  messages: ConversationMessage[],
  afterSeq = 0,
  limits: { maxMessages?: number; maxChars?: number } = {},
): ProviderHandoffBatch {
  const maxMessages = limits.maxMessages ?? 24
  const maxChars = limits.maxChars ?? 24_000
  const candidates = messages
    .filter(message => !message.streaming && message.seq > afterSeq)
    .map(portableMessage)
    .filter((message): message is ProviderHandoffMessage => message !== undefined)
  const throughSeq = candidates.at(-1)?.seq
  const selected: ProviderHandoffMessage[] = []
  let chars = 0
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (candidate === undefined) continue
    if (selected.length >= maxMessages || (selected.length > 0 && chars + candidate.text.length > maxChars)) break
    selected.unshift(candidate)
    chars += candidate.text.length
  }
  return {
    messages: selected,
    ...(throughSeq === undefined ? {} : { throughSeq }),
    omitted: candidates.length - selected.length,
  }
}

export function providerHandoffText(
  source: 'DeepSeek' | 'Codex' | 'Antigravity' | 'DeepSeek Harness',
  batch: Pick<ProviderHandoffBatch, 'messages' | 'omitted'>,
): string {
  const omission = batch.omitted > 0 ? `\n${batch.omitted} older messages were omitted to keep the handoff bounded.` : ''
  const transcript = batch.messages
    .map(message => `<${message.role}>\n${message.text}\n</${message.role}>`)
    .join('\n\n')
  return `${PROVIDER_HANDOFF_MARKER}\nContext transferred from ${source}. Treat it as prior dialogue and continue seamlessly.${omission}\n\n${transcript}`
}

export function isProviderHandoffText(value: string): boolean {
  return value.startsWith(PROVIDER_HANDOFF_MARKER)
}

/** Hide model-only handoff context while preserving a fallback request's real user text. */
export function visibleProviderText(value: string): string | undefined {
  if (isNetworkPolicyText(value)) return undefined
  if (!isProviderHandoffText(value) && !isAgentRoomCapabilityText(value)) return value
  const match = value.match(/<current_user_message>\n([\s\S]*?)\n<\/current_user_message>\s*$/)
  const visible = match?.[1]?.trim()
  return visible === undefined || visible === '' ? undefined : visible
}

export function visibleProviderBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const visible: MessageBlock[] = []
  for (const block of blocks) {
    if (block.kind !== 'text') {
      visible.push(block)
      continue
    }
    const text = visibleProviderText(block.text)
    if (text !== undefined) visible.push({ ...block, text })
  }
  return visible
}

type TranscriptProvider = 'deepseek' | 'codex' | 'antigravity'

function compareMessages(left: ConversationMessage, right: ConversationMessage): number {
  return left.time - right.time || left.seq - right.seq
}

function ordered(messages: readonly ConversationMessage[]): boolean {
  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1]
    const current = messages[index]
    if (previous !== undefined && current !== undefined && compareMessages(previous, current) > 0) return false
  }
  return true
}

function sameSource(left: ConversationMessage[], right: ConversationMessage[]): boolean {
  return left === right || (left.length === 0 && right.length === 0)
}

function mergeChronologically(sources: readonly ConversationMessage[][]): ConversationMessage[] {
  const populated = sources.filter(source => source.length > 0)
  if (populated.length === 0) return []
  if (populated.length === 1) return populated[0] ?? []
  if (!populated.every(ordered)) return populated.flat().sort(compareMessages)
  const indexes = populated.map(() => 0)
  const output: ConversationMessage[] = []
  while (true) {
    let selected = -1
    for (let sourceIndex = 0; sourceIndex < populated.length; sourceIndex += 1) {
      const candidate = populated[sourceIndex]?.[indexes[sourceIndex] ?? 0]
      if (candidate === undefined) continue
      const current = selected < 0 ? undefined : populated[selected]?.[indexes[selected] ?? 0]
      if (current === undefined || compareMessages(candidate, current) < 0) selected = sourceIndex
    }
    if (selected < 0) return output
    const message = populated[selected]?.[indexes[selected] ?? 0]
    if (message !== undefined) output.push(message)
    indexes[selected] = (indexes[selected] ?? 0) + 1
  }
}

/**
 * Retains namespaced message objects and the final merged array across renders.
 * Streaming normally replaces only the active tail message, so settled messages
 * no longer pay for repeated object spreads or an O(N log N) full sort.
 */
export class ProviderTranscriptMerger {
  private readonly arrays: Record<TranscriptProvider, WeakMap<ConversationMessage[], ConversationMessage[]>> = {
    deepseek: new WeakMap(),
    codex: new WeakMap(),
    antigravity: new WeakMap(),
  }
  private readonly messages: Record<TranscriptProvider, WeakMap<ConversationMessage, ConversationMessage>> = {
    deepseek: new WeakMap(),
    codex: new WeakMap(),
    antigravity: new WeakMap(),
  }
  private previous?: {
    deepSeek: ConversationMessage[]
    codex: ConversationMessage[]
    antigravity: ConversationMessage[]
    output: ConversationMessage[]
  }

  private normalize(provider: TranscriptProvider, source: ConversationMessage[]): ConversationMessage[] {
    const cached = this.arrays[provider].get(source)
    if (cached !== undefined) return cached
    const output = source.map(message => {
      const retained = this.messages[provider].get(message)
      if (retained !== undefined) return retained
      const next: ConversationMessage = provider === 'deepseek'
        ? { ...message, id: `deepseek:${message.id}`, ...(message.role === 'assistant' ? { agent: 'DeepSeek' } : {}) }
        : provider === 'antigravity'
          ? { ...message, id: `antigravity:${message.id}`, ...(message.role === 'assistant' ? { agent: 'Antigravity' } : {}) }
          : { ...message, id: `codex:${message.id}` }
      this.messages[provider].set(message, next)
      return next
    })
    this.arrays[provider].set(source, output)
    return output
  }

  merge(deepSeek: ConversationMessage[], codex: ConversationMessage[], antigravity: ConversationMessage[]): ConversationMessage[] {
    const previous = this.previous
    if (previous !== undefined && sameSource(previous.deepSeek, deepSeek) && sameSource(previous.codex, codex)
      && sameSource(previous.antigravity, antigravity)) return previous.output
    const output = mergeChronologically([
      this.normalize('deepseek', deepSeek),
      this.normalize('codex', codex),
      this.normalize('antigravity', antigravity),
    ])
    this.previous = { deepSeek, codex, antigravity, output }
    return output
  }
}

/** Merge both provider transcripts while keeping backend-specific ids isolated. */
export function mergeProviderTranscripts(deepSeek: ConversationMessage[], codex: ConversationMessage[]): ConversationMessage[] {
  return new ProviderTranscriptMerger().merge(deepSeek, codex, [])
}

/** Merge all desktop providers while preserving each backend's id namespace. */
export function mergeAllProviderTranscripts(
  deepSeek: ConversationMessage[],
  codex: ConversationMessage[],
  antigravity: ConversationMessage[],
): ConversationMessage[] {
  return new ProviderTranscriptMerger().merge(deepSeek, codex, antigravity)
}
