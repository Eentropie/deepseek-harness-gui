import { describe, expect, it } from 'vitest'
import { choiceDraft } from './HarnessSettings.tsx'

describe('HarnessSettings choice draft', () => {
  it('falls back to the first valid enum instead of parsing an empty string', () => {
    expect(choiceDraft('', ['zh', 'en'])).toBe('"zh"')
    expect(choiceDraft('"en"', ['zh', 'en'])).toBe('"en"')
  })
})
