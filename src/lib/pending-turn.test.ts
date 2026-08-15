import { describe, expect, it } from 'vitest'
import { createPendingTurn, pendingTurnMessages, pendingTurnReconciled } from './pending-turn.ts'
import type { ConversationMessage } from './types.ts'

function message(seq: number, role: ConversationMessage['role'], text: string = role): ConversationMessage {
  return { id: `${role}-${seq}`, seq, time: 1_000 + seq, role, blocks: [{ kind: 'text', text }] }
}

describe('pending turn transition', () => {
  it('shows the submitted prompt and an agent-starting bridge immediately', () => {
    const pending = createPendingTurn('session-1', 'Inspect this repo', [], 10, 2_000, 'turn-1')
    const projected = pendingTurnMessages(pending, [])
    expect(projected.map(item => item.role)).toEqual(['user', 'assistant'])
    expect(projected[1]).toMatchObject({ streaming: true, transient: 'agent-starting' })
  })

  it('creates a production-safe fallback id without crypto transforms', () => {
    expect(createPendingTurn('session-1', 'hello', [], 0, 2_000).id).toMatch(/^turn-2000-/)
  })

  it('replaces each optimistic row only after its matching Host event arrives', () => {
    const pending = createPendingTurn('session-1', 'Inspect this repo', [], 10, 2_000, 'turn-1')
    expect(pendingTurnMessages(pending, [message(11, 'user', 'Inspect this repo')])).toEqual([pending.assistant])
    expect(pendingTurnMessages(pending, [message(12, 'assistant')])).toEqual([pending.user])
  })

  it('settles only when both sides of the turn are present', () => {
    const pending = createPendingTurn('session-1', 'Inspect this repo', [], 10, 2_000, 'turn-1')
    const user = message(11, 'user', 'Inspect this repo')
    expect(pendingTurnReconciled(pending, [user])).toBe(false)
    expect(pendingTurnReconciled(pending, [user, message(12, 'assistant')])).toBe(true)
    expect(pendingTurnMessages(pending, [user, message(12, 'assistant')])).toEqual([])
  })
})
