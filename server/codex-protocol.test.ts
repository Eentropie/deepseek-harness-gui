import { describe, expect, it } from 'vitest'
import { codexSpawnEnvironment } from './codex-launch.ts'
import { codexExecutionPolicy } from './codex-permissions.ts'
import { normalizeCodexModels, normalizeCodexUsage, projectCodexThread } from './codex-protocol.ts'
import { providerHandoffText } from '../src/lib/provider-handoff.ts'

describe('Codex App Server protocol projection', () => {
  it('preserves each model-specific reasoning catalog', () => {
    const models = normalizeCodexModels({ data: [{
      id: 'gpt-test',
      displayName: 'GPT Test',
      description: 'Test model',
      hidden: false,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' },
        { reasoningEffort: 'medium', description: 'Balanced' },
        { reasoningEffort: 'xhigh', description: 'Deep' },
      ],
      isDefault: true,
    }] })
    expect(models[0]).toMatchObject({
      id: 'gpt-test',
      defaultEffort: 'medium',
      isDefault: true,
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'xhigh' }],
    })
  })

  it('projects Codex user, reasoning, tool, and assistant items', () => {
    const messages = projectCodexThread({ thread: { turns: [{
      startedAt: 10,
      items: [
        { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Fix it' }] },
        { type: 'reasoning', id: 'r1', summary: ['Checking'], content: [] },
        { type: 'commandExecution', id: 't1', command: 'pnpm test', aggregatedOutput: 'ok' },
        { type: 'agentMessage', id: 'a1', text: 'Done' },
      ],
    }] } })
    expect(messages.map(message => [message.role, message.blocks[0]?.kind])).toEqual([
      ['user', 'text'],
      ['assistant', 'thought'],
    ])
    expect(messages[1]?.blocks).toEqual([
      { kind: 'thought', blocks: [
        { kind: 'reasoning', text: 'Checking' },
        { kind: 'tool', name: 'Terminal', arguments: 'pnpm test\n\nok' },
      ] },
      { kind: 'text', text: 'Done' },
    ])
    expect(messages.at(-1)?.agent).toBe('Codex')
  })

  it('does not render injected provider context as duplicate chat messages', () => {
    const context = providerHandoffText('DeepSeek', {
      messages: [{ role: 'assistant', text: 'Prior answer', seq: 2 }],
      omitted: 0,
    })
    const messages = projectCodexThread({ thread: { turns: [{
      startedAt: 10,
      items: [
        { type: 'userMessage', id: 'injected-user', content: [{ type: 'text', text: context }] },
        { type: 'agentMessage', id: 'injected-assistant', text: context },
        {
          type: 'userMessage',
          id: 'fallback-user',
          content: [{ type: 'text', text: `${context}\n\n<current_user_message>\nCurrent request\n</current_user_message>` }],
        },
      ],
    }] } })
    expect(messages).toHaveLength(1)
    expect(messages[0]?.blocks).toEqual([{ kind: 'text', text: 'Current request' }])
  })

  it('projects persisted Codex web activity into the shared web card model', () => {
    const messages = projectCodexThread({ thread: { turns: [{
      id: 'turn-web', startedAt: 10,
      items: [
        { type: 'webSearch', id: 'web-1', query: 'current release', action: { type: 'search', query: 'current release' }, results: [
          { url: 'https://example.com/release', title: 'Release' },
        ] },
        { type: 'agentMessage', id: 'answer', text: 'Current release found.' },
      ],
    }] } })
    expect(messages[0]?.blocks[0]).toMatchObject({ kind: 'thought', blocks: [{
      kind: 'tool', name: 'web_search', status: 'succeeded',
      view: { card: 'web', kind: 'search', sources: [{ url: 'https://example.com/release' }] },
    }] })
  })

  it('projects account quota without exposing the account email', () => {
    const usage = normalizeCodexUsage(
      { account: { type: 'chatgpt', email: 'private@example.com', planType: 'plus' } },
      { rateLimitsByLimitId: { codex: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 2_000_000_000 },
        secondary: { usedPercent: 61, windowDurationMins: 10_080 },
        credits: { balance: '7.50', hasCredits: true, unlimited: false },
      } } },
      { dailyUsageBuckets: [{ startDate: '2026-08-15', tokens: 1234 }], summary: { lifetimeTokens: 9999 } },
      42,
    )
    expect(usage).toMatchObject({
      available: true,
      accountType: 'chatgpt',
      planType: 'plus',
      updatedAt: 42,
      rateLimits: [{ primary: { usedPercent: 23, remainingPercent: 77 } }],
      summary: { lifetimeTokens: 9999 },
    })
    expect(JSON.stringify(usage)).not.toContain('private@example.com')
  })

  it('keeps the signed-in account available when one usage source is temporarily missing', () => {
    const usage = normalizeCodexUsage(
      { account: { type: 'chatgpt', planType: 'pro' } },
      {},
      { dailyUsageBuckets: [{ startDate: '2026-08-16', tokens: 321 }] },
      84,
    )
    expect(usage).toMatchObject({
      available: true,
      accountType: 'chatgpt',
      planType: 'pro',
      rateLimits: [],
      dailyUsageBuckets: [{ startDate: '2026-08-16', tokens: 321 }],
      updatedAt: 84,
    })
  })

  it('adds Homebrew to the packaged CLI launch path', () => {
    const environment = codexSpawnEnvironment('/opt/homebrew/bin/codex', { PATH: '/usr/bin:/bin' }, 'darwin')
    expect(environment['PATH']?.split(':').slice(0, 3)).toEqual([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
    ])
  })

  it('uses Windows PATH delimiters without adding Unix-only directories', () => {
    const environment = codexSpawnEnvironment('C:\\Users\\Ada\\AppData\\Roaming\\npm\\codex.cmd', {
      PATH: 'C:\\Windows\\System32;C:\\Tools',
    }, 'win32')
    expect(environment['PATH']?.split(';')).toEqual([
      'C:\\Users\\Ada\\AppData\\Roaming\\npm',
      'C:\\Windows\\System32',
      'C:\\Tools',
    ])
  })

  it('maps all three visible Codex permission modes to protocol policies', () => {
    expect(codexExecutionPolicy('ask-for-approval', '/work')).toMatchObject({
      approvalPolicy: 'on-request', approvalsReviewer: 'user', threadSandbox: 'workspace-write',
    })
    expect(codexExecutionPolicy('approve-for-me', '/work')).toMatchObject({
      approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', threadSandbox: 'workspace-write',
    })
    expect(codexExecutionPolicy('full-access', '/work')).toEqual({
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      threadSandbox: 'danger-full-access',
      sandboxPolicy: { type: 'dangerFullAccess' },
    })
  })
})
