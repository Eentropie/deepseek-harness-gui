import { describe, expect, it } from 'vitest'
import { copyDraftError, presetDisplay } from './presets.ts'

describe('agent preset presentation', () => {
  it('uses stable English copy for shipped presets', () => {
    expect(presetDisplay({ id: 'code', trust: 'system', name: 'PTC 模式' }).name).toBe('Code mode')
  })

  it('keeps user-authored display metadata', () => {
    expect(presetDisplay({ id: 'reviewer', trust: 'user', name: 'Reviewer' })).toEqual({ name: 'Reviewer' })
  })

  it('rejects unsafe or occupied copy ids', () => {
    expect(copyDraftError('../escape', [])).toContain('lowercase')
    expect(copyDraftError('my-agent', [{ id: 'my-agent' }])).toContain('already exists')
  })

  it('accepts a safe new copy id', () => {
    expect(copyDraftError('my-agent-2', [{ id: 'standard' }])).toBeUndefined()
  })
})
