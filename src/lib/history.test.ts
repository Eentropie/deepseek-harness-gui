import { describe, expect, it } from 'vitest'
import {
  appendLiveHistory,
  applyLiveProjection,
  ConversationProjector,
  liveHistoryEntry,
  mergeHistoryTail,
  projectConversation,
  projectQueue,
} from './history.ts'
import { providerHandoffText } from './provider-handoff.ts'
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
    expect(projected[0]).toMatchObject({ id: 'assistant-turn-1' })
    expect(projected[0]?.streaming).toBeUndefined()
    expect(projected[0]?.blocks).toEqual([{ kind: 'text', text: 'settled' }])
  })

  it('folds every intermediate step into one thought process before the final answer', () => {
    const projected = projectConversation([
      entry(1, 'assistant/message', {
        turn: 2,
        step: 0,
        message: { id: 'thinking', content: [{ type: 'text', text: 'I will inspect it.' }, { type: 'tool-call', name: 'terminal', arguments: 'pwd' }] },
      }),
      entry(2, 'assistant/message', {
        turn: 2,
        step: 1,
        message: { id: 'answer', content: [{ type: 'reasoning', text: 'Result checked.' }, { type: 'text', text: 'Done.' }] },
      }),
    ])
    expect(projected).toHaveLength(1)
    expect(projected[0]?.blocks).toEqual([
      { kind: 'thought', blocks: [
        { kind: 'text', text: 'I will inspect it.' },
        { kind: 'tool', name: 'terminal', arguments: 'pwd' },
        { kind: 'reasoning', text: 'Result checked.' },
      ] },
      { kind: 'text', text: 'Done.' },
    ])
  })

  it('hides model-only handoff blocks but keeps the current Host prompt', () => {
    const context = providerHandoffText('Codex', {
      messages: [{ role: 'assistant', text: 'Prior answer', seq: 1 }],
      omitted: 0,
    })
    const projected = projectConversation([entry(1, 'user/message', {
      id: 'handoff',
      source: { kind: 'user' },
      content: [
        { type: 'text', text: context },
        { type: 'text', text: 'Continue with DeepSeek' },
      ],
    })])
    expect(projected[0]?.blocks).toEqual([{ kind: 'text', text: 'Continue with DeepSeek' }])
  })

  it('incrementally appends stream events while retaining settled message references', () => {
    const projector = new ConversationProjector()
    const firstPage = [entry(0, 'user/message', {
      id: 'human', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' },
    })]
    const first = projector.sync(firstPage)
    const second = projector.sync([
      ...firstPage,
      entry(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'reply' } }),
    ])

    expect(second[0]).toBe(first[0])
    expect(second[1]?.blocks).toEqual([{ kind: 'text', text: 'reply' }])
  })

  it('joins Host web call and result events into a structured source card', () => {
    const call = entry(2, 'tool/call', { callId: 'web-1', name: 'web_search', arguments: { query: 'DeepSeek Harness' } })
    const result = entry(3, 'tool/result', {
      message: {
        source: { kind: 'tool', callId: 'web-1' },
        content: [{ type: 'tool-result', toolCallId: 'web-1', content: [{ type: 'text', text: 'Search result text' }], isError: false }],
      },
    })
    result.view = { for: 'result', view: {
      card: 'web', kind: 'search', title: 'DeepSeek Harness', truncated: false,
      sources: [{ url: 'https://example.com/harness', title: 'Harness', snippet: 'Current source' }],
    } }
    const projected = projectConversation([
      entry(1, 'assistant/message', {
        turn: 1, step: 0,
        message: { content: [{ type: 'tool-call', id: 'web-1', name: 'web_search', arguments: '{"query":"DeepSeek Harness"}' }] },
      }),
      call,
      result,
      entry(4, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Found it.' }] } }),
    ])
    expect(projected[0]?.blocks[0]).toMatchObject({
      kind: 'thought',
      blocks: [{
        kind: 'tool', callId: 'web-1', status: 'succeeded', result: 'Search result text',
        view: { card: 'web', kind: 'search', sources: [{ url: 'https://example.com/harness' }] },
      }],
    })
  })

  it('shows cancelled web calls as cancelled rather than failed', () => {
    const projected = projectConversation([
      entry(1, 'assistant/message', { turn: 1, step: 0, message: { content: [{ type: 'tool-call', id: 'web-2', name: 'web_fetch', arguments: 'https://example.com' }] } }),
      entry(2, 'tool/call', { callId: 'web-2', name: 'web_fetch', arguments: { url: 'https://example.com' } }),
      entry(3, 'tool/result', { callId: 'web-2', content: [{ type: 'text', text: 'AbortError: cancelled' }], isError: true }),
      entry(4, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Cancelled.' }] } }),
    ])
    expect(projected[0]?.blocks[0]).toMatchObject({ kind: 'thought', blocks: [{ status: 'cancelled' }] })
  })
})

describe('live history updates', () => {
  it('appends contiguous mux events and ignores replay overlap', () => {
    const current = { events: [entry(0, 'turn/start', {})], hasMore: false }
    const result = appendLiveHistory(current, [
      entry(0, 'turn/start', {}),
      entry(1, 'user/message', {}),
      entry(2, 'assistant/chunk', {}),
    ])
    expect(result.gap).toBe(false)
    expect(result.appended).toBe(2)
    expect(result.page.events.map(item => item.event.seq)).toEqual([0, 1, 2])
  })

  it('requests a repair rather than appending across a seq gap', () => {
    const current = { events: [entry(0, 'turn/start', {})], hasMore: false }
    const result = appendLiveHistory(current, [entry(2, 'assistant/chunk', {})])
    expect(result).toMatchObject({ page: current, appended: 0, gap: true })
  })

  it('keeps an already-loaded older window when a fresh tail lands', () => {
    const current = { events: [entry(0, 'turn/start', {}), entry(1, 'user/message', {})], hasMore: false }
    const tail = { events: [entry(1, 'user/message', {}), entry(2, 'turn/end', {})], hasMore: true }
    const merged = mergeHistoryTail(current, tail)
    expect(merged.events.map(item => item.event.seq)).toEqual([0, 1, 2])
    expect(merged.hasMore).toBe(false)
  })

  it('parses durable mux events and applies projections above the baseline watermark', () => {
    const parsed = liveHistoryEntry({
      type: 'session/event',
      sessionId: 'session',
      event: { type: 'turn/end', seq: 3, time: 1003, data: { turn: 1 } },
    })
    expect(parsed).toEqual(entry(3, 'turn/end', { turn: 1 }))

    const page = { events: [], hasMore: false, projections: { asOfSeq: 2, values: { title: 'Old' } } }
    expect(applyLiveProjection(page, 'title', 'New', 3).projections).toEqual({
      asOfSeq: 3,
      values: { title: 'New' },
    })
    expect(applyLiveProjection(page, 'title', 'Stale', 1)).toBe(page)
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
