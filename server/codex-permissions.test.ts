import { describe, expect, it } from 'vitest'
import { codexExecutionPolicy } from './codex-permissions.ts'

describe('codexExecutionPolicy', () => {
  it('provides a real read-only policy for review agents', () => {
    expect(codexExecutionPolicy('read-only', '/workspace')).toEqual({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      threadSandbox: 'read-only',
      sandboxPolicy: { type: 'readOnly', networkAccess: true },
    })
  })
})
