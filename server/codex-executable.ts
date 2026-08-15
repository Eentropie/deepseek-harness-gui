import { posix, win32 } from 'node:path'

export interface CodexExecutableCandidate {
  path: string
  shell: boolean
}
function unique(values: string[]): string[] {
  return [...new Set(values.filter(value => value !== ''))]
}

export function codexExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): CodexExecutableCandidate[] {
  const pathApi = platform === 'win32' ? win32 : posix
  const configured = environment['DEEPSEEK_WORKBENCH_CODEX_BIN']?.trim()
  const configuredPaths = configured !== undefined && pathApi.isAbsolute(configured) ? [configured] : []

  if (platform === 'win32') {
    const appData = environment['APPDATA']?.trim()
    const localAppData = environment['LOCALAPPDATA']?.trim()
    const pathDirectories = (environment['PATH'] ?? '')
      .split(';')
      .map(value => value.trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
    const extensions = unique([
      '.exe', '.com', '.cmd', '.bat',
      ...(environment['PATHEXT'] ?? '').split(';').map(value => value.trim().toLocaleLowerCase()),
    ])
    const conventional = [
      ...(appData === undefined ? [] : [win32.join(appData, 'npm', 'codex.cmd')]),
      ...(localAppData === undefined ? [] : [
        win32.join(localAppData, 'Programs', 'Codex', 'codex.exe'),
        win32.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'codex.exe'),
      ]),
    ]
    const fromPath = pathDirectories.flatMap(directory => extensions.map(extension => win32.join(directory, `codex${extension}`)))
    return unique([...configuredPaths, ...conventional, ...fromPath]).map(path => ({
      path,
      shell: /\.(?:cmd|bat)$/i.test(path),
    }))
  }

  const pathDirectories = (environment['PATH'] ?? '').split(':').map(value => value.trim()).filter(Boolean)
  const conventional = platform === 'darwin'
    ? ['/opt/homebrew/bin/codex', '/usr/local/bin/codex']
    : ['/usr/local/bin/codex', '/usr/bin/codex']
  return unique([...configuredPaths, ...conventional, ...pathDirectories.map(directory => posix.join(directory, 'codex'))])
    .map(path => ({ path, shell: false }))
}
