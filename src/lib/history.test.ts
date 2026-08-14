import { describe, expect, it } from 'vitest'
import { projectConversation, projectQueue } from './history.ts'
import type { HistoryEntry } from './types.ts'

function entry(seq: number, type: string, data: Record<string, unknown>): HistoryEntry {
  return { event: { seq, type, data, time: 1_000 + seq } }
}

describe('projectConversation', () => {
  it('keeps human messages and hides injected user-role context', () => {
    const projected = projectConversation([
      entry(1, 'user/message', {
        id: 'human', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' },
      }),
      entry(2, 'user/message', {
        id: 'context', content: [{ type: 'text', text: 'system context' }], source: { kind: 'plugin' },
      }),
    ])
    expect(projected).toHaveLength(1)
    expect(projected[0]?.id).toBe('human')
  })

  it('assembles an in-flight assistant response from deltas', () => {
    const projected = projectConversation([
      entry(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hel' } }),
      entry(2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } }),
    ])
    expect(projected[0]).toMatchObject({ role: 'assistant', streaming: true })
    expect(projected[0]?.blocks).toEqual([{ kind: 'text', text: 'hello' }])
  })

  it('uses the finalized assistant message without duplicating its chunks', () => {
    const projected = projectConversation([
      entry(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'draft' } }),
      entry(2, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { id: 'final', content: [{ type: 'text', text: 'settled' }] },
      }),
    ])
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({ id: 'final' })
    expect(projected[0]?.streaming).toBeUndefined()
    expect(projected[0]?.blocks).toEqual([{ kind: 'text', text: 'settled' }])
  })
})

describe('projectQueue', () => {
  it('keeps editable text and marks non-text content as non-editable', () => {
    const queue = projectQueue({
      type: 'session/queue',
      items: [
        { id: 'text', placement: 'queued', message: { content: [{ type: 'text', text: 'queued prompt' }] } },
        { id: 'image', placement: 'steering', message: { content: [{ type: 'image' }] } },
      ],
    })
    expect(queue).toEqual([
      { id: 'text', placement: 'queued', content: [{ type: 'text', text: 'queued prompt' }], preview: 'queued prompt', text: 'queued prompt' },
      { id: 'image', placement: 'steering', content: [{ type: 'image' }], preview: '[image]', text: null },
    ])
  })
})
