import { describe, expect, it } from 'vitest'
import { permissionOverrideForNewSession } from './session-permission.ts'

describe('new-session permission initialization', () => {
  it('does not replay the Host default as a visible permission prompt', () => {
    expect(permissionOverrideForNewSession('workspace-write', 'workspace-write')).toBeUndefined()
  })

  it('keeps a permission explicitly changed before the first prompt', () => {
    expect(permissionOverrideForNewSession('read-only', 'workspace-write')).toBe('read-only')
    expect(permissionOverrideForNewSession('danger-full-access', 'workspace-write')).toBe('danger-full-access')
  })
})
