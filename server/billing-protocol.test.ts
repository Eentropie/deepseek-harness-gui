import { describe, expect, it } from 'vitest'
import { normalizeDeepSeekBalance, validateDeepSeekApiKey } from './billing-protocol.ts'

describe('DeepSeek billing projection', () => {
  it('projects official balance fields', () => {
    expect(normalizeDeepSeekBalance({
      is_available: true,
      balance_infos: [{
        currency: 'CNY',
        total_balance: '110.00',
        granted_balance: '10.00',
        topped_up_balance: '100.00',
      }],
    })).toEqual({
      available: true,
      balances: [{
        currency: 'CNY',
        totalBalance: '110.00',
        grantedBalance: '10.00',
        toppedUpBalance: '100.00',
      }],
    })
  })

  it('rejects accidental whitespace in keys', () => {
    expect(() => validateDeepSeekApiKey('sk-this key must not pass validation')).toThrow('invalid format')
  })
})
