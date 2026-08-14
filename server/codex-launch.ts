import { delimiter, dirname } from 'node:path'

/** Supply Homebrew's Node runtime when a packaged macOS app launches a CLI with an env shebang. */
export function codexSpawnEnvironment(
  executable: string,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const existing = environment['PATH']?.split(delimiter).filter(Boolean) ?? []
  const paths = [dirname(executable), '/opt/homebrew/bin', '/usr/local/bin', ...existing, '/usr/bin', '/bin']
  return {
    ...environment,
    PATH: [...new Set(paths)].join(delimiter),
  }
}
