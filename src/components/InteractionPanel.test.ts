import { describe, expect, it } from 'vitest'
import { normalizeQuestionAnswers } from './InteractionPanel.tsx'

describe('question response encoding', () => {
  it('omits an empty custom answer when a single option is selected', () => {
    expect(normalizeQuestionAnswers([{ id: 'model', selected: ['Built-in model'], custom: '' }])).toEqual([
      { id: 'model', selected: ['Built-in model'] },
    ])
  })

  it('trims and keeps a real custom answer', () => {
    expect(normalizeQuestionAnswers([{ id: 'model', selected: [], custom: '  Local API  ' }])).toEqual([
      { id: 'model', selected: [], custom: 'Local API' },
    ])
  })
})
