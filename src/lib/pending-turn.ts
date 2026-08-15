import type { ConversationMessage, PendingAttachment } from './types.ts'

export interface PendingTurnTransition {
  id: string
  owner: string
  prompt: string
  baselineSeq: number
  user: ConversationMessage
  assistant: ConversationMessage
}

export function createPendingTurn(
  owner: string,
  prompt: string,
  attachments: PendingAttachment[],
  baselineSeq: number,
  now = Date.now(),
  id: string = `turn-${now}-${Math.random().toString(36).slice(2)}`,
): PendingTurnTransition {
  const blocks: ConversationMessage['blocks'] = [
    ...(prompt === '' ? [] : [{ kind: 'text' as const, text: prompt }]),
    ...attachments.map(attachment => ({
      kind: 'image' as const,
      label: attachment.name ?? 'Image',
      mediaType: attachment.mediaType,
      src: attachment.previewUrl,
      ...(attachment.name === undefined ? {} : { name: attachment.name }),
    })),
  ]
  return {
    id,
    owner,
    prompt,
    baselineSeq,
    user: {
      id: `optimistic-user-${id}`,
      seq: baselineSeq + 0.25,
      time: now,
      role: 'user',
      blocks,
    },
    assistant: {
      id: `optimistic-assistant-${id}`,
      seq: baselineSeq + 0.5,
      time: now + 1,
      role: 'assistant',
      agent: 'DeepSeek',
      blocks: [],
      streaming: true,
      transient: 'agent-starting',
    },
  }
}

function arrived(messages: ConversationMessage[], pending: PendingTurnTransition, role: ConversationMessage['role']): boolean {
  return messages.some(message => {
    if (message.role !== role || message.seq <= pending.baselineSeq) return false
    if (role !== 'user' || pending.prompt === '') return true
    return message.blocks.some(block => block.kind === 'text' && block.text.trim() === pending.prompt)
  })
}

/** Keep only optimistic rows that the Host has not echoed yet. */
export function pendingTurnMessages(
  pending: PendingTurnTransition,
  actual: ConversationMessage[],
): ConversationMessage[] {
  return [
    ...(arrived(actual, pending, 'user') ? [] : [pending.user]),
    ...(arrived(actual, pending, 'assistant') ? [] : [pending.assistant]),
  ]
}

export function pendingTurnReconciled(
  pending: PendingTurnTransition,
  actual: ConversationMessage[],
): boolean {
  return arrived(actual, pending, 'user') && arrived(actual, pending, 'assistant')
}
