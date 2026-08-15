import { describe, expect, it } from 'vitest'
import { codexWebSearchMode, deepSeekNetworkPolicy, isNetworkMode } from './network-mode.ts'

describe('network mode', () => {
  it('maps the visible mode to authoritative Codex App Server values', () => {
    expect(codexWebSearchMode('off')).toBe('disabled')
    expect(codexWebSearchMode('auto')).toBe('live')
  })

  it('emits bounded Host policies without claiming to change Host tools', () => {
    expect(deepSeekNetworkPolicy('off')).toContain('do not call web_search')
    expect(deepSeekNetworkPolicy('auto')).toContain('Cite the source URLs')
  })

  it('accepts only supported persisted values', () => {
    expect(['off', 'auto', 'ask'].every(isNetworkMode)).toBe(true)
    expect(isNetworkMode('live')).toBe(false)
  })
})
