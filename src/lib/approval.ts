import type { ApprovalRequest } from './types.ts'

export type ApprovalChoice = 'allowed-once' | 'allowed-session' | 'rejected'
export type PersistentHostPermission = 'workspace-write' | 'danger-full-access'

/** Resolve the session permission implied by a Host sandbox-escalation request. */
export function persistentHostPermission(
  request: Pick<ApprovalRequest, 'source' | 'reason'>,
): PersistentHostPermission | undefined {
  if (request.source === 'codex') return undefined
  const match = request.reason?.match(/\b(workspace-write|danger-full-access)\b/i)
  const value = match?.[1]?.toLowerCase()
  return value === 'workspace-write' || value === 'danger-full-access' ? value : undefined
}

/** Codex has a session approval cache; Host can persist explicit sandbox escalations via its permission preset. */
export function canAlwaysAllow(request: Pick<ApprovalRequest, 'source' | 'reason'>): boolean {
  return request.source === 'codex' || persistentHostPermission(request) !== undefined
}
