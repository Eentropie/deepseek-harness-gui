import { describe, expect, it } from 'vitest'
import { assertPresetRpcPayload } from './rpc-policy.ts'

describe('desktop preset RPC policy', () => {
  it('allows the one supported settings write', () => {
    expect(() => assertPresetRpcPayload('settings.update', {
      ns: 'agent-presets', patch: { default: 'code' }, expectedRevision: 2,
    })).not.toThrow()
  })

  it('refuses updates to unrelated settings namespaces', () => {
    expect(() => assertPresetRpcPayload('settings.update', {
      ns: 'llm-deepseek', patch: { baseURL: 'https://example.invalid' },
    })).toThrow(/restricted/)
  })

  it('refuses path-like preset identifiers', () => {
    expect(() => assertPresetRpcPayload('agentPreset.openDocument', {
      agentPreset: '../outside',
    })).toThrow(/safe/)
  })

  it('accepts copy-only authoring metadata', () => {
    expect(() => assertPresetRpcPayload('agentPreset.copy', {
      from: 'minimal', agentPreset: 'my-minimal', name: 'My minimal mode',
    })).not.toThrow()
  })
})
