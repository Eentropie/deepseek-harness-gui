import type { ModelGroup, NetworkMode, SessionModels } from './types.ts'

export const AGENT_ROOM_STORAGE_PREFIX = 'dsh-workbench-agent-room-v1:'
export const AGENT_ROOM_OWNER_PREFIX = 'agent-room:'
export const AGENT_ROOM_CODEX_PROVIDER = 'codex-cli'

export type AgentRoomRole = 'reviewer' | 'challenger' | 'researcher' | 'judge'
export type AgentRoomPhase = 'idle' | 'independent' | 'rebuttal' | 'judgment' | 'completed' | 'stopped' | 'failed'
export type AgentRoomArtifactPhase = 'independent' | 'rebuttal' | 'judgment'
export type AgentRoomArtifactStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface AgentRoomAgent {
  id: string
  label: string
  provider: string
  model: string
  effort?: string
  permission: string
  network: NetworkMode
  role: AgentRoomRole
  hostSessionId?: string
  codexThreadId?: string
  runtimeCwd?: string
  isolated?: boolean
}

export interface AgentRoomArtifact {
  id: string
  phase: AgentRoomArtifactPhase
  agentId: string
  status: AgentRoomArtifactStatus
  output?: string
  error?: string
  startedAt: number
  completedAt?: number
}

export interface AgentRoomSnapshot {
  agents: AgentRoomAgent[]
  retiredHostSessionIds: string[]
  task: string
  phase: AgentRoomPhase
  running: boolean
  artifacts: AgentRoomArtifact[]
  finalOutput?: string
  updatedAt: number
}

export interface AgentPermissionChoice {
  value: string
  name: string
  description: string
  isolated: boolean
}

export const EMPTY_AGENT_ROOM: AgentRoomSnapshot = {
  agents: [],
  retiredHostSessionIds: [],
  task: '',
  phase: 'idle',
  running: false,
  artifacts: [],
  updatedAt: 0,
}

export const AGENT_ROOM_ROLES: Array<{ value: AgentRoomRole; name: string; description: string }> = [
  { value: 'reviewer', name: 'Reviewer', description: 'Find correctness, safety, and maintainability risks.' },
  { value: 'challenger', name: 'Challenger', description: 'Attack assumptions and construct counterexamples.' },
  { value: 'researcher', name: 'Researcher', description: 'Gather evidence and compare alternative approaches.' },
  { value: 'judge', name: 'Judge', description: 'Resolve disagreements and produce the final verdict.' },
]

const ROLE_VALUES = new Set(AGENT_ROOM_ROLES.map(role => role.value))
const PHASE_VALUES = new Set<AgentRoomPhase>(['idle', 'independent', 'rebuttal', 'judgment', 'completed', 'stopped', 'failed'])
const NETWORK_VALUES = new Set<NetworkMode>(['off', 'auto', 'ask'])
const ID_PATTERN = /^[a-zA-Z0-9-]{1,96}$/

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown, max = 20_000): string | undefined {
  return typeof value === 'string' ? value.slice(0, max) : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeAgent(value: unknown): AgentRoomAgent | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const id = text(row['id'], 96)
  const label = text(row['label'], 64)?.trim()
  const provider = text(row['provider'], 128)
  const model = text(row['model'], 256)
  const permission = text(row['permission'], 64)
  const role = row['role']
  const network = row['network']
  if (id === undefined || !ID_PATTERN.test(id) || label === undefined || label === ''
    || provider === undefined || model === undefined || permission === undefined
    || !ROLE_VALUES.has(role as AgentRoomRole) || !NETWORK_VALUES.has(network as NetworkMode)) return undefined
  return {
    id,
    label,
    provider,
    model,
    permission,
    role: role as AgentRoomRole,
    network: network as NetworkMode,
    ...(typeof row['effort'] === 'string' ? { effort: row['effort'].slice(0, 64) } : {}),
    ...(typeof row['hostSessionId'] === 'string' ? { hostSessionId: row['hostSessionId'].slice(0, 256) } : {}),
    ...(typeof row['codexThreadId'] === 'string' ? { codexThreadId: row['codexThreadId'].slice(0, 256) } : {}),
    ...(typeof row['runtimeCwd'] === 'string' ? { runtimeCwd: row['runtimeCwd'].slice(0, 4_096) } : {}),
    ...(row['isolated'] === true ? { isolated: true } : {}),
  }
}

function normalizeArtifact(value: unknown): AgentRoomArtifact | undefined {
  const row = record(value)
  if (row === undefined) return undefined
  const id = text(row['id'], 128)
  const agentId = text(row['agentId'], 96)
  const phase = row['phase']
  const status = row['status']
  const startedAt = finite(row['startedAt'])
  if (id === undefined || agentId === undefined || startedAt === undefined
    || (phase !== 'independent' && phase !== 'rebuttal' && phase !== 'judgment')
    || (status !== 'running' && status !== 'completed' && status !== 'failed' && status !== 'stopped')) return undefined
  return {
    id,
    agentId,
    phase,
    status: status === 'running' ? 'stopped' : status,
    startedAt,
    ...(text(row['output']) === undefined ? {} : { output: text(row['output']) }),
    ...(text(row['error'], 2_000) === undefined ? {} : { error: text(row['error'], 2_000) }),
    ...(finite(row['completedAt']) === undefined ? {} : { completedAt: finite(row['completedAt']) }),
  }
}

export function normalizeAgentRoom(value: unknown): AgentRoomSnapshot {
  const row = record(value)
  if (row === undefined) return EMPTY_AGENT_ROOM
  const phase = PHASE_VALUES.has(row['phase'] as AgentRoomPhase) ? row['phase'] as AgentRoomPhase : 'idle'
  const agents = Array.isArray(row['agents']) ? row['agents'].flatMap(agent => normalizeAgent(agent) ?? []).slice(0, 8) : []
  const known = new Set(agents.map(agent => agent.id))
  const artifacts = Array.isArray(row['artifacts'])
    ? row['artifacts'].flatMap(item => normalizeArtifact(item) ?? []).filter(item => known.has(item.agentId)).slice(-96)
    : []
  return {
    agents,
    retiredHostSessionIds: Array.isArray(row['retiredHostSessionIds'])
      ? [...new Set(row['retiredHostSessionIds'].flatMap(value => typeof value === 'string' ? [value.slice(0, 256)] : []))].slice(-128)
      : [],
    task: text(row['task']) ?? '',
    phase: row['running'] === true || phase === 'independent' || phase === 'rebuttal' || phase === 'judgment' ? 'stopped' : phase,
    running: false,
    artifacts,
    ...(text(row['finalOutput']) === undefined ? {} : { finalOutput: text(row['finalOutput']) }),
    updatedAt: finite(row['updatedAt']) ?? 0,
  }
}

export function readAgentRoom(parentSessionId: string): AgentRoomSnapshot {
  try {
    return normalizeAgentRoom(JSON.parse(localStorage.getItem(`${AGENT_ROOM_STORAGE_PREFIX}${parentSessionId}`) ?? 'null'))
  } catch {
    return EMPTY_AGENT_ROOM
  }
}

export function writeAgentRoom(parentSessionId: string, room: AgentRoomSnapshot): void {
  localStorage.setItem(`${AGENT_ROOM_STORAGE_PREFIX}${parentSessionId}`, JSON.stringify({ ...room, updatedAt: Date.now() }))
}

export function configuredAgentGroups(models?: SessionModels): ModelGroup[] {
  if (models === undefined) return []
  const failed = new Set(models.failures.map(failure => failure.id))
  return models.groups.filter(group => group.models.length > 0 && !failed.has(group.id))
}

export function agentPermissionChoices(provider: string): AgentPermissionChoice[] {
  if (provider === AGENT_ROOM_CODEX_PROVIDER) {
    return [
      { value: 'read-only', name: 'Read only', description: 'Audit without modifying files.', isolated: false },
      { value: 'ask-for-approval', name: 'Ask for approval', description: 'Use an isolated worktree and ask before escalation.', isolated: true },
      { value: 'approve-for-me', name: 'Approve for me', description: 'Use an isolated worktree with automatic approval review.', isolated: true },
      { value: 'full-access', name: 'Full access', description: 'Use an isolated worktree without approval prompts.', isolated: true },
    ]
  }
  return [
    { value: 'read-only', name: 'Read only', description: 'Audit without modifying files.', isolated: false },
    { value: 'workspace-write', name: 'Write in worktree', description: 'Edit an isolated Git worktree.', isolated: true },
    { value: 'danger-full-access', name: 'Full access in worktree', description: 'Start in an isolated worktree with unrestricted tools.', isolated: true },
  ]
}

export function agentRoomOwnerId(parentSessionId: string, agentId: string): string {
  return `${AGENT_ROOM_OWNER_PREFIX}${parentSessionId}:${agentId}`
}

export function managedAgentHostSessionIds(room: AgentRoomSnapshot): string[] {
  return [...new Set([...room.retiredHostSessionIds, ...room.agents.flatMap(agent => agent.hostSessionId ?? [])])]
}

export function allManagedAgentHostSessionIds(): string[] {
  const ids = new Set<string>()
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key === null || !key.startsWith(AGENT_ROOM_STORAGE_PREFIX)) continue
    try {
      managedAgentHostSessionIds(normalizeAgentRoom(JSON.parse(localStorage.getItem(key) ?? 'null'))).forEach(id => ids.add(id))
    } catch {
      // Ignore damaged room state; normalizeAgentRoom will recover it when opened.
    }
  }
  return [...ids]
}

export function roleInstruction(role: AgentRoomRole): string {
  if (role === 'challenger') return 'Act as an adversarial challenger. Attack assumptions, search for counterexamples, and distinguish proven defects from speculation.'
  if (role === 'researcher') return 'Act as an evidence researcher. Inspect the workspace, compare alternatives, and cite concrete files, commands, or sources.'
  if (role === 'judge') return 'Act as an impartial technical judge. Reconcile conflicts using evidence, rank risks, and state uncertainty explicitly.'
  return 'Act as a rigorous code reviewer. Prioritize correctness, security, regressions, and missing tests with concrete evidence.'
}

export function independentAuditPrompt(task: string, agent: AgentRoomAgent): string {
  return [
    '[Agent Room · Independent audit]',
    roleInstruction(agent.role),
    'Work independently. Do not assume another agent will catch an issue. Return findings ordered by severity, evidence, and a concise recommendation.',
    '',
    '<audit_task>',
    task.trim(),
    '</audit_task>',
  ].join('\n')
}

export function rebuttalPrompt(task: string, agent: AgentRoomAgent, peerArtifacts: Array<{ label: string; output: string }>): string {
  const peers = peerArtifacts.map(peer => `### ${peer.label}\n${compactArtifact(peer.output)}`).join('\n\n')
  return [
    '[Agent Room · Cross rebuttal]',
    roleInstruction(agent.role),
    'Challenge the peer reports below. Confirm valid findings, reject unsupported claims, add missed risks, and identify the strongest remaining disagreement.',
    '',
    '<audit_task>',
    task.trim(),
    '</audit_task>',
    '',
    '<peer_reports>',
    peers || 'No peer report was available.',
    '</peer_reports>',
  ].join('\n')
}

export function judgmentPrompt(task: string, artifacts: Array<{ agent: string; phase: AgentRoomArtifactPhase; output: string }>): string {
  const evidence = artifacts.map(item => `### ${item.agent} · ${item.phase}\n${compactArtifact(item.output)}`).join('\n\n')
  return [
    '[Agent Room · Final judgment]',
    roleInstruction('judge'),
    'Produce one decision-ready audit. Deduplicate findings, resolve disagreements, assign severity and confidence, and separate required fixes from optional improvements. Do not invent consensus.',
    '',
    '<audit_task>',
    task.trim(),
    '</audit_task>',
    '',
    '<agent_evidence>',
    evidence,
    '</agent_evidence>',
  ].join('\n')
}

export function compactArtifact(value: string, limit = 12_000): string {
  const clean = value.trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit)}\n\n[truncated by Agent Room]`
}
