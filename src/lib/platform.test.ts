import { afterEach, describe, expect, it, vi } from 'vitest'
import { platformBasename, shortcutLabel } from './platform.ts'

afterEach(() => vi.unstubAllGlobals())

describe('desktop platform presentation', () => {
  it('reads both Windows and POSIX path basenames', () => {
    expect(platformBasename('C:\\Users\\Ada\\project')).toBe('project')
    expect(platformBasename('/Users/ada/project')).toBe('project')
  })

  it('renders Windows shortcut labels from the desktop bridge', () => {
    vi.stubGlobal('window', { dshDesktop: { platform: 'win32', arch: 'x64' } })
    expect(shortcutLabel('P', true)).toBe('Ctrl+Shift+P')
    expect(shortcutLabel('O')).toBe('Ctrl+O')
  })
})
