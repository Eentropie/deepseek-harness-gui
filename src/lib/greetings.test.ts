import { describe, expect, it } from 'vitest'
import { chooseGreeting, greetingPeriod, greetingsFor } from './greetings.ts'

describe('time-aware DeepSeek greetings', () => {
  it('maps local hours to the intended periods', () => {
    expect(greetingPeriod(new Date(2026, 7, 15, 5))).toBe('early')
    expect(greetingPeriod(new Date(2026, 7, 15, 9))).toBe('morning')
    expect(greetingPeriod(new Date(2026, 7, 15, 12))).toBe('afternoon')
    expect(greetingPeriod(new Date(2026, 7, 15, 17))).toBe('evening')
    expect(greetingPeriod(new Date(2026, 7, 15, 23))).toBe('late')
    expect(greetingPeriod(new Date(2026, 7, 15, 3))).toBe('late')
  })

  it('chooses from the current period and avoids the previous launch text', () => {
    const date = new Date(2026, 7, 15, 20)
    const previous = greetingsFor('evening')[0]
    const next = chooseGreeting(date, previous, () => 0)
    expect(greetingsFor('evening')).toContain(next)
    expect(next).not.toBe(previous)
  })
})
