import { describe, expect, it, vi } from 'vitest'
import { TrailingTask } from './trailing-task.ts'

describe('TrailingTask', () => {
  it('collapses overlapping refreshes into one active and one trailing run', async () => {
    const coordinator = new TrailingTask<string>()
    const releases: Array<() => void> = []
    const calls: number[] = []
    const task = (value: number) => coordinator.run('session', async () => {
      calls.push(value)
      await new Promise<void>(resolve => releases.push(resolve))
    })

    const first = task(1)
    const second = task(2)
    const third = task(3)
    expect(calls).toEqual([1])

    releases.shift()?.()
    await vi.waitFor(() => { expect(calls).toEqual([1, 3]) })

    releases.shift()?.()
    await Promise.all([first, second, third])
    expect(calls).toEqual([1, 3])
  })

  it('does not combine independent keys', async () => {
    const coordinator = new TrailingTask<string>()
    const calls: string[] = []
    await Promise.all([
      coordinator.run('a', async () => { calls.push('a') }),
      coordinator.run('b', async () => { calls.push('b') }),
    ])
    expect(calls.sort()).toEqual(['a', 'b'])
  })
})
