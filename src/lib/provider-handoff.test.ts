import { describe, expect, it } from 'vitest'
import type { ConversationMessage } from './types.ts'
import {
  collectProviderHandoff,
  isProviderHandoffText,
  mergeProviderTranscripts,
  providerHandoffText,
  visibleProviderText,
} from './provider-handoff.ts'

function message(seq: number, role: 'user' | 'assistant', text: string, time = seq): ConversationMessage {
  return { id: String(seq), seq, time, role, blocks: [{ kind: 'text', text }] }
}

describe('provider handoff', () => {
  it('collects only unseen finalized dialogue and advances through the complete slice', () => {
    const batch = collectProviderHandoff([
      message(1, 'user', 'old'),
      message(2, 'assistant', 'new'),
      { ...message(3, 'assistant', 'streaming'), streaming: true },
      { id: 'reasoning', seq: 4, time: 4, role: 'assistant', blocks: [{ kind: 'reasoning', text: 'private' }] },
      message(5, 'user', 'latest'),
    ], 1)
    expect(batch).toEqual({
      messages: [
        { role: 'assistant', text: 'new', seq: 2 },
        { role: 'user', text: 'latest', seq: 5 },
      ],
      throughSeq: 5,
      omitted: 0,
    })
  })

  it('marks handoff context so it can stay hidden in the visible transcript', () => {
    const text = providerHandoffText('Codex', {
      messages: [{ role: 'assistant', text: 'Use the existing parser.', seq: 2 }],
      omitted: 1,
    })
    expect(isProviderHandoffText(text)).toBe(true)
    expect(text).toContain('Context transferred from Codex')
    expect(text).toContain('1 older messages were omitted')
    expect(visibleProviderText(text)).toBeUndefined()
    expect(visibleProviderText(`${text}\n\n<current_user_message>\nContinue here\n</current_user_message>`)).toBe('Continue here')
  })

  it('keeps both providers in one chronological transcript', () => {
    const merged = mergeProviderTranscripts(
      [message(1, 'user', 'DeepSeek turn', 10), message(2, 'assistant', 'DeepSeek answer', 20)],
      [message(1, 'user', 'Codex turn', 30), { ...message(2, 'assistant', 'Codex answer', 40), agent: 'Codex' }],
    )
    expect(merged.map(item => [item.id, item.agent])).toEqual([
      ['deepseek:1', undefined],
      ['deepseek:2', 'DeepSeek'],
      ['codex:1', undefined],
      ['codex:2', 'Codex'],
    ])
  })
})
