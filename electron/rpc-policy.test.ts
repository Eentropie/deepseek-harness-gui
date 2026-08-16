import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { assertDesktopRpcPayload, DESKTOP_RPC_METHODS } from './rpc-policy.ts'

const absoluteFixture = resolve('fixture')

const validPayloads: Record<(typeof DESKTOP_RPC_METHODS)[number], unknown> = {
  'host.describe': {},
  'host.openPath': { path: absoluteFixture },
  'session.list': {},
  'session.search': { query: 'audit' },
  'workspace.list': {},
  'workspace.create': { path: absoluteFixture },
  'workspace.rename': { workspaceId: 'workspace-1', title: 'Workspace' },
  'workspace.insertBefore': { workspaceId: 'workspace-1' },
  'workspace.insertSessionBefore': { workspaceId: 'workspace-1', sessionId: 'session-1' },
  'workspace.delete': { workspaceId: 'workspace-1' },
  'workspace.archiveSession': { sessionId: 'session-1' },
  'session.history': { sessionId: 'session-1', maxMessages: 100 },
  'session.attachment': { sessionId: 'session-1', attachmentId: 'attachment-1' },
  'session.updateQueue': { sessionId: 'session-1', itemId: 'item-1', action: { kind: 'remove' } },
  'session.rename': { sessionId: 'session-1', title: 'Session' },
  'session.fork': { sessionId: 'session-1' },
  'session.models': { sessionId: 'session-1' },
  'session.create': {},
  'session.prompt': { sessionId: 'session-1', mode: 'queue', content: [{ type: 'text', text: 'Hello' }], clientTimeZone: 'Asia/Taipei' },
  'session.cancel': { sessionId: 'session-1' },
  'session.selectModel': { sessionId: 'session-1', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  'subagent.list': { parentSessionId: 'session-1' },
  'subagent.history': { parentSessionId: 'session-1', childSessionId: 'child-1', mode: 'continuable', maxMessages: 100 },
  'subagent.prompt': { parentSessionId: 'session-1', childSessionId: 'child-1', mode: 'continuable', content: [{ type: 'text', text: 'Continue' }], clientTimeZone: 'Asia/Taipei' },
  'subagent.interrupt': { parentSessionId: 'session-1', childSessionId: 'child-1', mode: 'continuable' },
  'skill.list': { sessionId: 'session-1' },
  'goal.create': { sessionId: 'session-1', objective: 'Finish the audit' },
  'goal.edit': { sessionId: 'session-1', ref: { id: 'goal-1', revision: 1 }, objective: 'Finish safely' },
  'goal.pause': { sessionId: 'session-1', ref: { id: 'goal-1', revision: 1 } },
  'goal.resume': { sessionId: 'session-1', ref: { id: 'goal-1', revision: 1 } },
  'goal.complete': { sessionId: 'session-1', ref: { id: 'goal-1', revision: 1 } },
  'goal.clear': { sessionId: 'session-1', ref: { id: 'goal-1', revision: 1 } },
  'agentPreset.list': {},
  'agentPreset.select': { sessionId: 'session-1', agentPreset: 'code' },
  'agentPreset.read': { agentPreset: 'code' },
  'agentPreset.copy': { from: 'code', agentPreset: 'my-code' },
  'agentPreset.openDocument': { agentPreset: 'code' },
  'agentPreset.remove': { agentPreset: 'my-code' },
  'settings.describe': {},
  'settings.update': { ns: 'agent-presets', patch: { default: 'code' }, expectedRevision: 2 },
  'settings.replace': { ns: 'shell', section: { timeoutMs: 120_000 } },
  'settings.mutate': { ns: 'shell', ops: [{ op: 'set', path: ['timeoutMs'], value: 120_000 }] },
  'settings.openDocument': {},
  'credentials.describe': { refs: ['DEEPSEEK_API_KEY'] },
  'credentials.set': { ref: 'DEEPSEEK_API_KEY', value: 'secret' },
  'credentials.unset': { ref: 'DEEPSEEK_API_KEY' },
  'llm.providers': {},
  'llm.models': {},
  'llm.discoverModels': { settingsNs: 'llm-pi-ai', provider: 'openai', baseURL: 'https://api.openai.com/v1' },
}

describe('desktop privileged RPC policy', () => {
  it('has a strict valid fixture for every allowlisted RPC method', () => {
    expect(Object.keys(validPayloads).sort()).toEqual([...DESKTOP_RPC_METHODS].sort())
    for (const method of DESKTOP_RPC_METHODS) {
      expect(() => assertDesktopRpcPayload(method, validPayloads[method]), method).not.toThrow()
    }
  })

  it('keeps settings.update limited to the preset default while generated settings use mutate', () => {
    expect(() => assertDesktopRpcPayload('settings.update', {
      ns: 'llm-deepseek', patch: { baseURL: 'https://example.invalid' },
    })).toThrow(/only supports/)
    expect(() => assertDesktopRpcPayload('settings.mutate', {
      ns: 'llm-deepseek', ops: [{ op: 'set', path: ['baseURL'], value: 'https://example.invalid' }],
    })).not.toThrow()
  })

  it('refuses path-like preset identifiers', () => {
    expect(() => assertDesktopRpcPayload('agentPreset.openDocument', {
      agentPreset: '../outside',
    })).toThrow(/safe/)
  })

  it('allows bounded settings path operations and refuses unsafe paths', () => {
    expect(() => assertDesktopRpcPayload('settings.mutate', {
      ns: 'shell', ops: [{ op: 'unset', path: ['bad\u0000path'] }],
    })).toThrow(/safe operations/)
    expect(() => assertDesktopRpcPayload('settings.mutate', {
      ns: 'shell', ops: [{ op: 'set', path: ['__proto__', 'polluted'], value: true }],
    })).toThrow(/safe operations/)
  })

  it('allows multiline goal objectives while refusing NUL bytes', () => {
    expect(() => assertDesktopRpcPayload('goal.create', {
      sessionId: 'session-1', objective: 'Inspect behavior\nThen write a report', maxGoalRounds: 8,
    })).not.toThrow()
    expect(() => assertDesktopRpcPayload('goal.create', {
      sessionId: 'session-1', objective: 'unsafe\u0000objective', maxGoalRounds: 8,
    })).toThrow(/goal\.create/)
  })

  it('keeps credential reads value-free and validates secret writes', () => {
    expect(() => assertDesktopRpcPayload('credentials.describe', {
      refs: ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY'],
    })).not.toThrow()
    expect(() => assertDesktopRpcPayload('credentials.set', {
      ref: '../key', value: 'secret',
    })).toThrow(/safe reference/)
  })

  it('accepts http model discovery and refuses non-http endpoints', () => {
    expect(() => assertDesktopRpcPayload('llm.discoverModels', {
      settingsNs: 'llm-pi-ai', provider: 'openai', baseURL: 'https://api.openai.com/v1',
    })).not.toThrow()
    expect(() => assertDesktopRpcPayload('llm.discoverModels', {
      settingsNs: 'llm-pi-ai', baseURL: 'file:///etc/passwd',
    })).toThrow(/provider draft/)
  })

  it('rejects methods without an explicit policy and unknown payload keys', () => {
    expect(() => assertDesktopRpcPayload('future.method', {})).toThrow(/no payload schema/)
    expect(() => assertDesktopRpcPayload('session.cancel', { sessionId: 'session-1', extra: true })).toThrow(/session id/)
  })
})
