import type { CodexPermissionMode } from '../src/lib/types.ts'

interface CodexExecutionPolicy {
  approvalPolicy: 'on-request' | 'never'
  approvalsReviewer: 'user' | 'auto_review'
  threadSandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  sandboxPolicy:
    | { type: 'readOnly'; networkAccess: true }
    | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: true; excludeTmpdirEnvVar: false; excludeSlashTmp: false }
    | { type: 'dangerFullAccess' }
}

export function codexExecutionPolicy(mode: string, cwd: string): CodexExecutionPolicy {
  if (mode === 'read-only') {
    return {
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      threadSandbox: 'read-only',
      sandboxPolicy: { type: 'readOnly', networkAccess: true },
    }
  }
  if (mode === 'full-access') {
    return {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      threadSandbox: 'danger-full-access',
      sandboxPolicy: { type: 'dangerFullAccess' },
    }
  }
  if (mode === 'ask-for-approval' || mode === 'approve-for-me') {
    return {
      approvalPolicy: 'on-request',
      approvalsReviewer: mode === 'approve-for-me' ? 'auto_review' : 'user',
      threadSandbox: 'workspace-write',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [cwd],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    }
  }
  throw new Error(`Unsupported Codex permission mode: ${mode}`)
}

export function isCodexPermissionMode(value: string): value is CodexPermissionMode {
  return value === 'ask-for-approval' || value === 'approve-for-me' || value === 'full-access'
}
