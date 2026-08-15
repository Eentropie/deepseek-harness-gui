import { describe, expect, it } from 'vitest'
import { canAlwaysAllow, persistentHostPermission } from './approval.ts'

describe('approval persistence', () => {
  it('maps Host sandbox escalation reasons to session permission presets', () => {
    expect(persistentHostPermission({ reason: 'escalate sandbox to danger-full-access: test' }))
      .toBe('danger-full-access')
    expect(persistentHostPermission({ reason: 'Needs workspace-write for this command.' }))
      .toBe('workspace-write')
  })

  it('only offers persistent approval where the backend can honor it', () => {
    expect(canAlwaysAllow({ source: 'codex' })).toBe(true)
    expect(canAlwaysAllow({ reason: 'escalate sandbox to danger-full-access' })).toBe(true)
    expect(canAlwaysAllow({ reason: 'Approve this unrelated tool' })).toBe(false)
  })
})
