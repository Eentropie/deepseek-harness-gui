import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodexEvent } from '../src/lib/types.ts'
import { CodexAppServer } from './codex-app-server.ts'

const previousExecutable = process.env['DEEPSEEK_WORKBENCH_CODEX_BIN']
const temporaryDirectories: string[] = []

afterEach(async () => {
  if (previousExecutable === undefined) delete process.env['DEEPSEEK_WORKBENCH_CODEX_BIN']
  else process.env['DEEPSEEK_WORKBENCH_CODEX_BIN'] = previousExecutable
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 20,
  })))
})

describe('Codex App Server lifecycle', () => {
  it('publishes a failed completion when the process exits during an active turn', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-codex-app-server-'))
    temporaryDirectories.push(fixture)
    const executable = join(fixture, 'codex-fixture')
    await writeFile(executable, `#!/usr/bin/env node
const readline = require('node:readline')
const input = readline.createInterface({ input: process.stdin })
const send = value => process.stdout.write(JSON.stringify(value) + '\\n')
input.on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ id: message.id, result: {} })
  else if (message.method === 'model/list') send({ id: message.id, result: { data: [{
    id: 'gpt-test', displayName: 'GPT Test', description: 'Fixture model', hidden: false,
    defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }], isDefault: true
  }] } })
  else if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread-test' } } })
  else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-test' } } })
    send({ method: 'turn/started', params: { threadId: 'thread-test', turn: { id: 'turn-test' } } })
    setTimeout(() => process.exit(17), 30)
  }
})
`, { mode: 0o700 })
    await chmod(executable, 0o700)
    process.env['DEEPSEEK_WORKBENCH_CODEX_BIN'] = executable

    const events: CodexEvent[] = []
    let completeTurn: ((event: Extract<CodexEvent, { type: 'turn-completed' }>) => void) | undefined
    const completed = new Promise<Extract<CodexEvent, { type: 'turn-completed' }>>(resolve => { completeTurn = resolve })
    const server = new CodexAppServer(event => {
      events.push(event)
      if (event.type === 'turn-completed') completeTurn?.(event)
    })

    const started = await server.prompt({
      sessionId: 'session-test',
      cwd: fixture,
      model: 'gpt-test',
      effort: 'medium',
      permission: 'ask-for-approval',
      network: 'off',
      prompt: 'Inspect the fixture.',
    })
    expect(started).toEqual({ threadId: 'thread-test', turnId: 'turn-test' })

    const failed = await Promise.race([
      completed,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Timed out waiting for failed turn')), 2_000)),
    ])
    expect(failed).toMatchObject({
      type: 'turn-completed',
      sessionId: 'session-test',
      threadId: 'thread-test',
      turnId: 'turn-test',
      status: 'failed',
    })
    expect(events.some(event => event.type === 'error')).toBe(true)
    server.shutdown()
  })
})
