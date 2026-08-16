import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AntigravityEvent } from '../src/lib/types.ts'
import { AntigravityCli } from './antigravity-cli.ts'

const previousExecutable = process.env['DEEPSEEK_HARNESS_ANTIGRAVITY_BIN']
const temporaryDirectories: string[] = []

afterEach(async () => {
  if (previousExecutable === undefined) delete process.env['DEEPSEEK_HARNESS_ANTIGRAVITY_BIN']
  else process.env['DEEPSEEK_HARNESS_ANTIGRAVITY_BIN'] = previousExecutable
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 20,
  })))
})

describe('Antigravity CLI desktop bridge', () => {
  it('streams one turn and persists a resumable transcript', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-antigravity-cli-'))
    temporaryDirectories.push(fixture)
    const executable = join(fixture, 'agy')
    const stateFile = join(fixture, 'state', 'antigravity-sessions.json')
    await writeFile(executable, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '1.2.3\\n'
  exit 0
fi
if [ "$1" = "models" ]; then
  printf 'gemini-test-low\\tGemini Test (Low)\\ngemini-test-high\\tGemini Test (High)\\n'
  exit 0
fi
printf '%s\\n' '{"event":"init","conversation_id":"conversation-test"}'
printf '%s\\n' '{"event":"step_update","step_update":{"step_type":"analysis","step_index":1,"text_delta":"checking","state":"ACTIVE"}}'
printf '%s\\n' '{"event":"step_update","step_update":{"step_type":"tool","step_index":2,"tool_name":"read_file","state":"DONE","tool_info":{"parameters":{"path":"README.md"},"output":"ok"}}}'
printf '%s\\n' '{"event":"step_update","step_update":{"step_type":"agent_response","step_index":3,"text_delta":"Finished.","state":"DONE"}}'
printf '%s\\n' '{"event":"result","result":{"status":"SUCCESS","response":"Finished."}}'
`, { mode: 0o700 })
    await chmod(executable, 0o700)
    process.env['DEEPSEEK_HARNESS_ANTIGRAVITY_BIN'] = executable

    const events: AntigravityEvent[] = []
    let completeTurn: (() => void) | undefined
    const completed = new Promise<void>(resolve => { completeTurn = resolve })
    const cli = new AntigravityCli(stateFile, event => {
      events.push(event)
      if (event.type === 'turn-completed') completeTurn?.()
    })

    const catalog = await cli.catalog(true)
    expect(catalog).toMatchObject({
      available: true,
      version: '1.2.3',
      models: [{ id: 'gemini-test', name: 'Gemini Test', defaultEffort: 'high' }],
    })
    const started = await cli.prompt({
      sessionId: 'session-test',
      cwd: fixture,
      model: 'gemini-test',
      effort: 'high',
      permission: 'read-only',
      network: 'off',
      prompt: 'Inspect the fixture.',
    })
    expect(started).toMatchObject({ conversationId: 'conversation-test' })
    await completed

    const snapshot = await cli.readThread('conversation-test')
    expect(snapshot.messages).toHaveLength(2)
    expect(snapshot.messages[0]).toMatchObject({ role: 'user', blocks: [{ kind: 'text', text: 'Inspect the fixture.' }] })
    expect(snapshot.messages[1]).toMatchObject({
      role: 'assistant',
      agent: 'Antigravity',
      modelName: 'Gemini Test',
      blocks: [
        { kind: 'thought' },
        { kind: 'text', text: 'Finished.' },
      ],
    })
    expect(events.some(event => event.type === 'reasoning-delta')).toBe(true)
    expect(events.some(event => event.type === 'tool-item')).toBe(true)
    expect(events.some(event => event.type === 'turn-completed' && event.status === 'completed')).toBe(true)

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toMatchObject({
      version: 1,
      conversations: { 'conversation-test': [{ role: 'user' }, { role: 'assistant' }] },
    })
    cli.shutdown()
  })

  it('waits for the previous process to exit before launching another turn', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'dsh-antigravity-serial-'))
    temporaryDirectories.push(fixture)
    const executable = join(fixture, 'agy')
    const stateFile = join(fixture, 'state', 'antigravity-sessions.json')
    const lockDirectory = join(fixture, 'active-turn')
    const countFile = join(fixture, 'count')
    await writeFile(executable, `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '1.2.3\\n'
  exit 0
fi
if [ "$1" = "models" ]; then
  printf 'gemini-test-high\\tGemini Test (High)\\n'
  exit 0
fi
if ! mkdir '${lockDirectory}' 2>/dev/null; then
  printf 'overlapping Antigravity process\\n' >&2
  exit 17
fi
count=0
if [ -f '${countFile}' ]; then count=$(cat '${countFile}'); fi
count=$((count + 1))
printf '%s' "$count" > '${countFile}'
printf '{"event":"init","conversation_id":"conversation-%s"}\\n' "$count"
sleep 0.12
printf '%s\\n' '{"event":"result","result":{"status":"SUCCESS","response":"Finished."}}'
sleep 0.12
rmdir '${lockDirectory}'
`, { mode: 0o700 })
    await chmod(executable, 0o700)
    process.env['DEEPSEEK_HARNESS_ANTIGRAVITY_BIN'] = executable

    const cli = new AntigravityCli(stateFile, () => undefined)
    await cli.catalog(true)
    const input = {
      cwd: fixture,
      model: 'gemini-test',
      effort: 'high',
      permission: 'read-only' as const,
      network: 'off' as const,
      prompt: 'Inspect the fixture.',
    }
    const first = await cli.prompt({ ...input, sessionId: 'session-one' })
    const second = await cli.prompt({ ...input, sessionId: 'session-two' })

    expect(first.conversationId).toBe('conversation-1')
    expect(second.conversationId).toBe('conversation-2')
    expect(await readFile(countFile, 'utf8')).toBe('2')
    cli.shutdown()
  })
})
