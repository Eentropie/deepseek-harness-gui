import type { DeepSeekBalanceInfo } from '../src/lib/types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function validateDeepSeekApiKey(value: string): string {
  const key = value.trim()
  if (key.length < 20 || key.length > 512 || /\s|[\u0000-\u001f\u007f]/.test(key)) {
    throw new Error('DeepSeek API key has an invalid format')
  }
  return key
}

export function normalizeDeepSeekBalance(value: unknown): {
  available: boolean
  balances: DeepSeekBalanceInfo[]
} {
  const payload = record(value)
  if (typeof payload?.['is_available'] !== 'boolean' || !Array.isArray(payload['balance_infos'])) {
    throw new Error('DeepSeek returned an invalid balance response')
  }
  const balances = payload['balance_infos'].flatMap(value => {
    const entry = record(value)
    const currency = string(entry?.['currency'])
    const totalBalance = string(entry?.['total_balance'])
    const grantedBalance = string(entry?.['granted_balance'])
    const toppedUpBalance = string(entry?.['topped_up_balance'])
    if (currency === undefined || totalBalance === undefined || grantedBalance === undefined || toppedUpBalance === undefined) return []
    return [{ currency, totalBalance, grantedBalance, toppedUpBalance }]
  })
  return { available: payload['is_available'], balances }
}
