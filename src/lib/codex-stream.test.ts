import { describe, expect, it } from 'vitest'
import { applyCodexDeltas, applyCodexToolEvent, type CodexDeltaEvent } from './codex-stream.ts'
import type { ConversationMessage } from './types.ts'

function delta(text: string): CodexDeltaEvent {
  return {
    type: 'assistant-delta',
    threadId: 'thread',
    turnId: 'turn',
    itemId: 'item',
    delta: text,
  }
}

describe('applyCodexDeltas', () => {
  it('combines a visual delta batch into one streaming message', () => {
    const messages = applyCodexDeltas([], [delta('one'), delta(' two')], 123)
    expect(messages).toEqual([expect.objectContaining({
      id: 'codex-turn-turn',
      time: 123,
      streaming: true,
      blocks: [{ kind: 'text', text: 'one two' }],
    })])
  })

  it('moves an earlier assistant item into thought process when the final item starts', () => {
    const messages = applyCodexDeltas([], [
      delta('Checking'),
      { ...delta('Done'), itemId: 'final-item' },
    ], 123)
    expect(messages[0]?.blocks).toEqual([
      { kind: 'thought', blocks: [{ kind: 'text', text: 'Checking' }] },
      { kind: 'text', text: 'Done' },
    ])
  })

  it('preserves untouched settled message references', () => {
    const settled: ConversationMessage = {
      id: 'settled', seq: 1, time: 1, role: 'user', blocks: [{ kind: 'text', text: 'hello' }],
    }
    const messages = applyCodexDeltas([settled], [delta('reply')])
    expect(messages[0]).toBe(settled)
  })
})

describe('applyCodexToolEvent', () => {
  it('keeps a live web item in thought process and settles it in place', () => {
    const started = applyCodexToolEvent([], {
      type: 'tool-item', threadId: 'thread', turnId: 'turn',
      block: { kind: 'tool', name: 'web_search', arguments: 'query', callId: 'web', status: 'running', startedAt: 100,
        view: { card: 'web', kind: 'search', query: 'query', sources: [], truncated: false } },
    }, 100)
    const completed = applyCodexToolEvent(started, {
      type: 'tool-item', threadId: 'thread', turnId: 'turn',
      block: { kind: 'tool', name: 'web_search', arguments: 'query', callId: 'web', status: 'succeeded', finishedAt: 250,
        view: { card: 'web', kind: 'search', query: 'query', sources: [{ url: 'https://example.com' }], truncated: false } },
    }, 250)
    expect(completed[0]?.blocks).toEqual([{ kind: 'thought', blocks: [expect.objectContaining({
      callId: 'web', status: 'succeeded', startedAt: 100, finishedAt: 250,
    })] }])
  })
})
