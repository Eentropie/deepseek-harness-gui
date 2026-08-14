import { describe, expect, it } from 'vitest'
import { normalizeCodexModels, projectCodexThread } from './codex-protocol.ts'

describe('Codex App Server protocol projection', () => {
  it('preserves each model-specific reasoning catalog', () => {
    const models = normalizeCodexModels({ data: [{
      id: 'gpt-test',
      displayName: 'GPT Test',
      description: 'Test model',
      hidden: false,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' },
        { reasoningEffort: 'medium', description: 'Balanced' },
        { reasoningEffort: 'xhigh', description: 'Deep' },
      ],
      isDefault: true,
    }] })
    expect(models[0]).toMatchObject({
      id: 'gpt-test',
      defaultEffort: 'medium',
      isDefault: true,
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'xhigh' }],
    })
  })

  it('projects Codex user, reasoning, tool, and assistant items', () => {
    const messages = projectCodexThread({ thread: { turns: [{
      startedAt: 10,
      items: [
        { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Fix it' }] },
        { type: 'reasoning', id: 'r1', summary: ['Checking'], content: [] },
        { type: 'commandExecution', id: 't1', command: 'pnpm test', aggregatedOutput: 'ok' },
        { type: 'agentMessage', id: 'a1', text: 'Done' },
      ],
    }] } })
    expect(messages.map(message => [message.role, message.blocks[0]?.kind])).toEqual([
      ['user', 'text'],
      ['assistant', 'reasoning'],
      ['assistant', 'tool'],
      ['assistant', 'text'],
    ])
    expect(messages.at(-1)?.agent).toBe('Codex')
  })
})
