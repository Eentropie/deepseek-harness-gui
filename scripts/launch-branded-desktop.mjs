import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const packageScript = process.platform === 'darwin' ? 'pack:mac' : process.platform === 'win32' ? 'pack:win' : undefined

if (packageScript === undefined) {
  process.stderr.write('DeepSeek Harness desktop packaging currently supports macOS and Windows.\n')
  process.exit(1)
}

const packaged = spawnSync(corepack, ['pnpm', 'run', packageScript], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
})

if (packaged.status !== 0) process.exit(packaged.status ?? 1)

const executable = process.platform === 'darwin'
  ? resolve(root, 'release', 'mac-arm64', 'DeepSeek Harness.app')
  : resolve(root, 'release', 'win-unpacked', 'DeepSeek Harness.exe')
const command = process.platform === 'darwin' ? 'open' : executable
const args = process.platform === 'darwin' ? [executable] : []

const child = spawn(command, args, {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  shell: false,
})
child.unref()
