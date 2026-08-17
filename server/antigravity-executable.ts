import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export interface AntigravityExecutableCandidate {
  path: string
  shell: boolean
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function antigravityExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): AntigravityExecutableCandidate[] {
  const pathApi = platform === 'win32' ? win32 : posix
  const configured = environment['DEEPSEEK_HARNESS_ANTIGRAVITY_BIN']?.trim()
  const configuredPaths = configured !== undefined && pathApi.isAbsolute(configured) ? [configured] : []
  if (platform === 'win32') {
    const localAppData = environment['LOCALAPPDATA']?.trim()
    const programFiles = environment['ProgramFiles']?.trim()
    const pathDirectories = (environment['PATH'] ?? '').split(';').map(value => value.trim().replace(/^"|"$/g, '')).filter(Boolean)
    const conventional = [
      win32.join(home, '.local', 'bin', 'agy.exe'),
      ...(localAppData === undefined ? [] : [win32.join(localAppData, 'agy', 'bin', 'agy.exe')]),
      ...(programFiles === undefined ? [] : [win32.join(programFiles, 'Google', 'antigravity-cli', 'agy.exe')]),
    ]
    return unique([...configuredPaths, ...conventional, ...pathDirectories.map(directory => win32.join(directory, 'agy.exe'))])
      .map(path => ({ path, shell: /\.(?:cmd|bat)$/i.test(path) }))
  }
  const pathDirectories = (environment['PATH'] ?? '').split(':').map(value => value.trim()).filter(Boolean)
  return unique([
    ...configuredPaths,
    posix.join(home, '.local', 'bin', 'agy'),
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
    ...pathDirectories.map(directory => posix.join(directory, 'agy')),
  ]).map(path => ({ path, shell: false }))
}
