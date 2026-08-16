import { describe, expect, it } from 'vitest'
import { antigravityNetworkInstruction, antigravityUsesEffortFlag, antigravityVariant, parseAntigravityModels } from './antigravity-protocol.ts'

describe('Antigravity CLI protocol projection', () => {
  it('groups effort-specific model IDs into one hot-swappable model', () => {
    const models = parseAntigravityModels([
      'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
      'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
      'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
      'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
    ].join('\n'))
    expect(models[0]).toMatchObject({
      id: 'gemini-3.7-flash',
      name: 'Gemini 3.7 Flash',
      defaultEffort: 'medium',
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
    })
    expect(antigravityVariant(models[0]!, 'high')).toBe('gemini-3.7-flash-high')
    expect(models[1]).toMatchObject({
      id: 'claude-sonnet-4-6',
      defaultEffort: 'thinking',
      efforts: [{ id: 'thinking', name: 'Thinking' }],
    })
    expect(antigravityVariant(models[1]!, 'thinking')).toBe('claude-sonnet-4-6')
    expect(antigravityUsesEffortFlag(models[1]!, 'thinking')).toBe(false)
    expect(antigravityUsesEffortFlag(models[0]!, 'high')).toBe(true)
  })

  it('projects network policy without changing global AGY settings', () => {
    expect(antigravityNetworkInstruction('off')).toContain('Do not use search_web')
    expect(antigravityNetworkInstruction('auto')).toContain('Cite source URLs')
  })
})
