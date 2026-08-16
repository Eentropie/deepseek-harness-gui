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

/** Merge both provider transcripts while keeping backend-specific ids isolated. */
export function mergeProviderTranscripts(
  deepSeek: ConversationMessage[],
  codex: ConversationMessage[],
): ConversationMessage[] {
  return [
    ...deepSeek.map(message => ({
      ...message,
      id: `deepseek:${message.id}`,
      ...(message.role === 'assistant' ? { agent: 'DeepSeek' as const } : {}),
    })),
    ...codex.map(message => ({ ...message, id: `codex:${message.id}` })),
  ].sort((left, right) => left.time - right.time || left.seq - right.seq)
}

/** Merge all desktop providers while preserving each backend's id namespace. */
export function mergeAllProviderTranscripts(
  deepSeek: ConversationMessage[],
  codex: ConversationMessage[],
  antigravity: ConversationMessage[],
): ConversationMessage[] {
  return [
    ...deepSeek.map(message => ({
      ...message,
      id: `deepseek:${message.id}`,
      ...(message.role === 'assistant' ? { agent: 'DeepSeek' as const } : {}),
    })),
    ...codex.map(message => ({ ...message, id: `codex:${message.id}` })),
    ...antigravity.map(message => ({
      ...message,
      id: `antigravity:${message.id}`,
      ...(message.role === 'assistant' ? { agent: 'Antigravity' as const } : {}),
    })),
  ].sort((left, right) => left.time - right.time || left.seq - right.seq)
}
