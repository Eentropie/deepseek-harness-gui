import { describe, expect, it } from 'vitest'
import { assertDesktopRpcPayload } from './rpc-policy.ts'

describe('desktop privileged RPC policy', () => {
  it('allows the one supported settings write', () => {
    expect(() => assertDesktopRpcPayload('settings.update', {
      ns: 'agent-presets', patch: { default: 'code' }, expectedRevision: 2,
    })).not.toThrow()
  })

  it('allows schema-validated writes to other exposed settings namespaces', () => {
    expect(() => assertDesktopRpcPayload('settings.update', {
      ns: 'llm-deepseek', patch: { baseURL: 'https://example.invalid' },
    })).not.toThrow()
  })

  it('refuses path-like preset identifiers', () => {
    expect(() => assertDesktopRpcPayload('agentPreset.openDocument', {
      agentPreset: '../outside',
    })).toThrow(/safe/)
  })

  it('accepts copy-only authoring metadata', () => {
    expect(() => assertDesktopRpcPayload('agentPreset.copy', {
      from: 'minimal', agentPreset: 'my-minimal', name: 'My minimal mode',
    })).not.toThrow()
  })

  it('allows bounded settings path operations and refuses unsafe paths', () => {
    expect(() => assertDesktopRpcPayload('settings.mutate', {
      ns: 'shell', ops: [{ op: 'set', path: ['timeoutMs'], value: 120000 }], expectedRevision: 0,
    })).not.toThrow()
    expect(() => assertDesktopRpcPayload('settings.mutate', {
      ns: 'shell', ops: [{ op: 'unset', path: ['bad\u0000path'] }],
    })).toThrow(/path operations/)
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
})
