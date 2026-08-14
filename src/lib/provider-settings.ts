const LEGAL_API_KEY = /^[\x21-\x7E]+$/
const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/

export function deriveCredentialRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

export function apiKeyFailure(draft: string): string | undefined {
  if (draft.length === 0) return undefined
  const value = draft.trim()
  if (value.length === 0) return 'The API key cannot contain only whitespace.'
  const first = value[0]
  if ((first === '"' || first === '\'' || first === '`') && value.endsWith(first)) {
    return 'Paste the API key without wrapping quotes.'
  }
  if (ENV_LINE.test(value)) return 'Paste only the key value, not NAME=value.'
  if (!LEGAL_API_KEY.test(value)) return 'API keys may contain printable non-space ASCII characters only.'
  return undefined
}
