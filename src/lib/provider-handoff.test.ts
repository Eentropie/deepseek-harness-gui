import { describe, expect, it } from 'vitest'
import type { ConversationMessage } from './types.ts'
import {
  collectProviderHandoff,
  isProviderHandoffText,
  mergeAllProviderTranscripts,
  mergeProviderTranscripts,
  ProviderTranscriptMerger,
  providerHandoffText,
  visibleProviderText,
} from './provider-handoff.ts'
import { deepSeekNetworkPolicy } from './network-mode.ts'
import { desktopAgentRoomCapability } from './agent-room-protocol.ts'

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

  it('keeps Antigravity isolated in the unified transcript', () => {
    const merged = mergeAllProviderTranscripts([], [], [{ ...message(1, 'assistant', 'Gemini answer', 15), agent: 'Antigravity' }])
    expect(merged.map(item => [item.id, item.agent])).toEqual([['antigravity:1', 'Antigravity']])
  })

  it('retains settled namespaced messages and the complete result for unchanged inputs', () => {
    const merger = new ProviderTranscriptMerger()
    const deepSeek = [message(1, 'assistant', 'DeepSeek answer', 10)]
    const codex = [message(1, 'assistant', 'Codex answer', 20)]
    const first = merger.merge(deepSeek, codex, [])
    expect(merger.merge(deepSeek, codex, [])).toBe(first)

    const nextCodex = [codex[0]!, message(2, 'assistant', 'Streaming tail', 30)]
    const second = merger.merge(deepSeek, nextCodex, [])
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second.map(item => item.id)).toEqual(['deepseek:1', 'codex:1', 'codex:2'])
  })

  it('keeps renderer-only network policy messages out of visible chat', () => {
    expect(visibleProviderText(deepSeekNetworkPolicy('auto'))).toBeUndefined()
    expect(visibleProviderText(deepSeekNetworkPolicy('off'))).toBeUndefined()
  })

  it('hides the Agent Room broker instruction but keeps its wrapped user message', () => {
    const capability = desktopAgentRoomCapability('Codex')
    expect(visibleProviderText(capability)).toBeUndefined()
    expect(visibleProviderText(`${capability}\n\n<current_user_message>\nRun an Agent Room audit\n</current_user_message>`)).toBe('Run an Agent Room audit')
  })
})
