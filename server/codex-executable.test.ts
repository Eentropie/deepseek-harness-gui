import { describe, expect, it } from 'vitest'
import { codexExecutableCandidates } from './codex-executable.ts'

describe('Codex executable discovery', () => {
  it('discovers Windows executables and npm command wrappers', () => {
    const candidates = codexExecutableCandidates('win32', {
      APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local',
      PATH: 'C:\\Tools;C:\\Program Files\\Codex',
      PATHEXT: '.EXE;.CMD',
    })

    expect(candidates).toContainEqual({
      path: 'C:\\Users\\Ada\\AppData\\Roaming\\npm\\codex.cmd',
      shell: true,
    })
    expect(candidates).toContainEqual({ path: 'C:\\Tools\\codex.exe', shell: false })
    expect(candidates).toContainEqual({ path: 'C:\\Tools\\codex.cmd', shell: true })
  })

  it('keeps an absolute configured Windows executable first', () => {
    const candidates = codexExecutableCandidates('win32', {
      DEEPSEEK_WORKBENCH_CODEX_BIN: 'D:\\Codex\\codex.exe',
      PATH: 'C:\\Tools',
    })
    expect(candidates[0]).toEqual({ path: 'D:\\Codex\\codex.exe', shell: false })
  })
})
