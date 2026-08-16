import { describe, expect, it } from 'vitest'
import { antigravityExecutableCandidates } from './antigravity-executable.ts'

describe('Antigravity executable discovery', () => {
  it('discovers the official macOS user-local installation first', () => {
    expect(antigravityExecutableCandidates('darwin', { PATH: '/usr/bin' }, '/Users/ada')[0]?.path)
      .toBe('/Users/ada/.local/bin/agy')
  })

  it('discovers the official Windows installation and PATH binaries', () => {
    const candidates = antigravityExecutableCandidates('win32', {
      LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      PATH: 'C:\\Tools',
    }, 'C:\\Users\\Ada')
    expect(candidates.map(item => item.path)).toContain('C:\\Users\\Ada\\AppData\\Local\\agy\\bin\\agy.exe')
    expect(candidates.map(item => item.path)).toContain('C:\\Tools\\agy.exe')
  })
})
