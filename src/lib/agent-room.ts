import type { ConversationMessage, ModelGroup, NetworkMode, SessionModels } from './types.ts'

export const AGENT_ROOM_STORAGE_PREFIX = 'dsh-workbench-agent-room-v1:'
export const AGENT_ROOM_OWNER_PREFIX = 'agent-room:'
export const AGENT_ROOM_CODEX_PROVIDER = 'codex-cli'
export const AGENT_ROOM_ANTIGRAVITY_PROVIDER = 'antigravity-cli'

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
  effectivePermission?: string
  network: NetworkMode
  role: AgentRoomRole
  hostSessionId?: string
  codexThreadId?: string
  antigravityConversationId?: string
  runtimeCwd?: string
  isolated?: boolean
}

export interface AgentRoomContextSnapshot {
  workflowId: string
  sourceSessionId: string
  capturedAt: number
  transcript: string
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
  context?: AgentRoomContextSnapshot
  reportStatus?: 'pending' | 'delivered'
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
    ...(typeof row['effectivePermission'] === 'string' ? { effectivePermission: row['effectivePermission'].slice(0, 64) } : {}),
    role: role as AgentRoomRole,
    network: network as NetworkMode,
    ...(typeof row['effort'] === 'string' ? { effort: row['effort'].slice(0, 64) } : {}),
    ...(typeof row['hostSessionId'] === 'string' ? { hostSessionId: row['hostSessionId'].slice(0, 256) } : {}),
    ...(typeof row['codexThreadId'] === 'string' ? { codexThreadId: row['codexThreadId'].slice(0, 256) } : {}),
    ...(typeof row['antigravityConversationId'] === 'string' ? { antigravityConversationId: row['antigravityConversationId'].slice(0, 256) } : {}),
    ...(typeof row['runtimeCwd'] === 'string' ? { runtimeCwd: row['runtimeCwd'].slice(0, 4_096) } : {}),
    ...(row['isolated'] === true ? { isolated: true } : {}),
  }
}

function normalizeContext(value: unknown): AgentRoomContextSnapshot | undefined {
  const row = record(value)
  const workflowId = text(row?.['workflowId'], 128)
  const sourceSessionId = text(row?.['sourceSessionId'], 256)
  const capturedAt = finite(row?.['capturedAt'])
  const transcript = text(row?.['transcript'], 24_000)
  if (workflowId === undefined || sourceSessionId === undefined || capturedAt === undefined || transcript === undefined) return undefined
  return { workflowId, sourceSessionId, capturedAt, transcript }
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
    ...(normalizeContext(row['context']) === undefined ? {} : { context: normalizeContext(row['context']) }),
    ...(row['reportStatus'] === 'pending' || row['reportStatus'] === 'delivered' ? { reportStatus: row['reportStatus'] } : {}),
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

export function agentPermissionChoices(provider: string, hostPermission = 'workspace-write'): AgentPermissionChoice[] {
  if (provider === AGENT_ROOM_ANTIGRAVITY_PROVIDER) {
    return [
      { value: 'read-only', name: 'Read only', description: 'Use Antigravity plan mode inside its sandbox.', isolated: false },
      { value: 'workspace-write', name: 'Write in workspace', description: 'Use Antigravity accept-edits in an isolated worktree.', isolated: true },
      { value: 'full-access', name: 'Full access', description: 'Use Antigravity accept-edits without its sandbox, inside an isolated worktree.', isolated: true },
    ]
  }
  if (provider === AGENT_ROOM_CODEX_PROVIDER) {
    return [
      { value: 'read-only', name: 'Read only', description: 'Audit without modifying files.', isolated: false },
      { value: 'ask-for-approval', name: 'Ask for approval', description: 'Use an isolated worktree and ask before escalation.', isolated: true },
      { value: 'approve-for-me', name: 'Approve for me', description: 'Use an isolated worktree with automatic approval review.', isolated: true },
      { value: 'full-access', name: 'Full access', description: 'Use an isolated worktree without approval prompts.', isolated: true },
    ]
  }
  return [
    {
      value: hostPermission,
      name: `Host effective · ${hostPermission}`,
      description: 'DeepSeek uses the permission currently reported by the unmodified Local Host. This desktop client does not claim a permission change that the Host did not apply.',
      isolated: false,
    },
  ]
}

/** Writable CLI agents need Git worktrees; audits fall back safely outside Git. */
export function nonGitAgentPermissionFallback(provider: string, message: string): 'read-only' | undefined {
  if (provider !== AGENT_ROOM_CODEX_PROVIDER && provider !== AGENT_ROOM_ANTIGRAVITY_PROVIDER) return undefined
  return /Writable Agent Room agents require a Git workspace/i.test(message) ? 'read-only' : undefined
}

export function defaultAgentRoomAgents(groups: ModelGroup[], hostPermission: string): AgentRoomAgent[] {
  const candidates = groups.flatMap(group => group.models.map(model => ({ group, model })))
  if (candidates.length === 0) return []
  const distinct = [
    candidates[0],
    candidates.find(candidate => candidate.group.id !== candidates[0]?.group.id) ?? candidates[1] ?? candidates[0],
  ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
  const judge = candidates.find(candidate => candidate.group.id === AGENT_ROOM_CODEX_PROVIDER)
    ?? candidates.find(candidate => !distinct.includes(candidate))
    ?? distinct[0]
  const specs: Array<{ candidate: NonNullable<typeof candidates[number]>; role: AgentRoomRole; label: string }> = [
    { candidate: distinct[0]!, role: 'reviewer', label: 'Primary reviewer' },
    { candidate: distinct[1]!, role: 'challenger', label: 'Adversarial challenger' },
    { candidate: judge!, role: 'judge', label: 'Evidence judge' },
  ]
  return specs.map(({ candidate, role, label }) => ({
    id: crypto.randomUUID(),
    label,
    provider: candidate.group.id,
    model: candidate.model.id,
    ...(candidate.model.reasoning?.defaultEffort === undefined ? {} : { effort: candidate.model.reasoning.defaultEffort }),
    permission: candidate.group.id === AGENT_ROOM_CODEX_PROVIDER || candidate.group.id === AGENT_ROOM_ANTIGRAVITY_PROVIDER ? 'read-only' : hostPermission,
    effectivePermission: candidate.group.id === AGENT_ROOM_CODEX_PROVIDER || candidate.group.id === AGENT_ROOM_ANTIGRAVITY_PROVIDER ? 'read-only' : hostPermission,
    network: 'auto',
    role,
  }))
}

export function buildAgentRoomContext(sourceSessionId: string, messages: ConversationMessage[]): AgentRoomContextSnapshot {
  const lines = messages.slice(-18).flatMap(message => {
    const body = message.blocks.flatMap(block => block.kind === 'text' ? [block.text.trim()] : []).filter(Boolean).join('\n')
    return body === '' ? [] : [`${message.role === 'user' ? 'User' : 'Assistant'}:\n${body}`]
  })
  return {
    workflowId: `room-${crypto.randomUUID()}`,
    sourceSessionId,
    capturedAt: Date.now(),
    transcript: compactArtifact(lines.join('\n\n'), 20_000),
  }
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

function contextBlock(context?: AgentRoomContextSnapshot): string[] {
  if (context === undefined || context.transcript.trim() === '') return []
  return ['', '<frozen_parent_context>', context.transcript, '</frozen_parent_context>']
}

export function independentAuditPrompt(task: string, agent: AgentRoomAgent, context?: AgentRoomContextSnapshot): string {
  return [
    '[Agent Room · Independent audit]',
    roleInstruction(agent.role),
    'This is an evidence-only audit. Do not modify workspace files or run mutating commands, even if the runtime permission would allow it.',
    'Work independently. Do not assume another agent will catch an issue. Return findings ordered by severity, evidence, and a concise recommendation.',
    '',
    '<audit_task>',
    task.trim(),
    '</audit_task>',
    ...contextBlock(context),
  ].join('\n')
}

export function roomFollowupPrompt(task: string, question: string, agent: AgentRoomAgent, verdict?: string, context?: AgentRoomContextSnapshot): string {
  return [
    '[Agent Room · Follow-up]',
    roleInstruction(agent.role),
    'Keep this follow-up evidence-only. Do not modify workspace files.',
    'Answer the follow-up against the frozen parent context and prior verdict. State whether it changes the audit conclusion.',
    '', '<audit_task>', task.trim(), '</audit_task>',
    '', '<follow_up>', question.trim(), '</follow_up>',
    ...(verdict === undefined ? [] : ['', '<prior_verdict>', compactArtifact(verdict, 8_000), '</prior_verdict>']),
    ...contextBlock(context),
  ].join('\n')
}

export function agentRoomReport(room: AgentRoomSnapshot): string {
  return [
    `[Agent Room report · ${room.context?.workflowId ?? 'manual'}]`,
    'This is a structured result returned by the desktop Agent Room. Treat it as review evidence, not as a user-authored claim.',
    '', 'Task:', room.task.trim(), '', 'Judge verdict:', room.finalOutput?.trim() ?? 'No verdict was produced.',
  ].join('\n')
}

export function rebuttalPrompt(task: string, agent: AgentRoomAgent, peerArtifacts: Array<{ label: string; output: string }>): string {
  const peers = peerArtifacts.map(peer => `### ${peer.label}\n${compactArtifact(peer.output)}`).join('\n\n')
  return [
    '[Agent Room · Cross rebuttal]',
    roleInstruction(agent.role),
    'This is an evidence-only audit. Do not modify workspace files.',
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
