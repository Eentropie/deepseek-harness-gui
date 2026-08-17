import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Create a small CLI fixture that can be spawned on both POSIX and Windows runners. */
export async function writeNodeCliFixture(directory: string, name: string, source: string): Promise<string> {
  const scriptName = `${name}-fixture.cjs`
  await writeFile(join(directory, scriptName), source, { mode: 0o700 })

  if (process.platform === 'win32') {
    const commandPath = join(directory, `${name}.cmd`)
    await writeFile(commandPath, `@echo off\r\nnode "%~dp0${scriptName}" %*\r\n`, { mode: 0o700 })
    return commandPath
  }

  const executablePath = join(directory, name)
  await writeFile(executablePath, `#!/usr/bin/env node\n${source}`, { mode: 0o700 })
  await chmod(executablePath, 0o700)
  return executablePath
}
