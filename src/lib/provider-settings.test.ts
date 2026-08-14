import { describe, expect, it } from 'vitest'
import { apiKeyFailure, deriveCredentialRef } from './provider-settings.ts'

describe('provider settings helpers', () => {
  it('derives stable POSIX credential references', () => {
    expect(deriveCredentialRef('azure-openai-responses')).toBe('AZURE_OPENAI_RESPONSES_API_KEY')
  })

  it('accepts header-safe keys and rejects common pasted wrappers', () => {
    expect(apiKeyFailure('sk-example_123')).toBeUndefined()
    expect(apiKeyFailure('OPENAI_API_KEY=sk-example')).toMatch(/only the key/)
    expect(apiKeyFailure('"sk-example"')).toMatch(/without wrapping/)
    expect(apiKeyFailure('   ')).toMatch(/whitespace/)
  })
})
