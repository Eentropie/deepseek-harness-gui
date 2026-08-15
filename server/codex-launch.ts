import { posix, win32 } from 'node:path'

/** Supply the packaged desktop process with the platform-correct CLI launch path. */
export function codexSpawnEnvironment(
  executable: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const pathApi = platform === 'win32' ? win32 : posix
  const delimiter = platform === 'win32' ? ';' : ':'
  const existing = environment['PATH']?.split(delimiter).filter(Boolean) ?? []
  const systemPaths = platform === 'win32'
    ? []
    : platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
      : ['/usr/local/bin', '/usr/bin', '/bin']
  const paths = [pathApi.dirname(executable), ...systemPaths, ...existing]
  return {
    ...environment,
    PATH: [...new Set(paths)].join(delimiter),
  }
}
