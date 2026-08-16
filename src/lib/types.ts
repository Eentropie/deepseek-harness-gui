export interface RpcFailure {
  code: string
  message: string
  details?: unknown
}

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RpcFailure }

export interface RpcEnvelope<T> {
  type: 'server-response'
  rpcId: string
  result: RpcResult<T>
}

export interface HostDescription {
  version: string
  cwd: string
  provider?: string
  model?: string
  attachedSessions: number
  canOpenPath?: boolean
}

export interface PermissionOption {
  value: string
  name: string
  description?: string
}

export interface SessionStats {
  turns?: number
  steps?: number
  llmMs?: number
  toolMs?: number
  ttftMs?: number
  decodeTokens?: number
}

export interface TokenUsage {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface ContextPressure {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

export interface SessionProjectionValues {
  title?: string | null
  sessionStats?: SessionStats
  tokenUsage?: TokenUsage
  contextPressure?: ContextPressure
  permissions?: {
    options: PermissionOption[]
    currentValue: string
  }
  plan?: { active?: boolean; pending?: boolean }
  todos?: Array<{ content: string; status: string }> | null
  goal?: GoalProjection | null
  imageLimits?: ImageLimits
  [key: string]: unknown
}

export interface ImageLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: string[]
}

export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  agentPreset?: string
  parentSessionId?: string
  origin?: 'subagent'
  projections?: {
    asOfSeq: number
    values: SessionProjectionValues
  }
}

export interface WorkspaceSummary {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkspaceCreateResult {
  workspace: WorkspaceSummary
  created: boolean
}

export interface DshEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  surfaceOp?: string
  sourceEventSeqs?: number[]
}

export interface HistoryEntry {
  event: DshEvent
  view?: unknown
}

export interface HistoryPage {
  events: HistoryEntry[]
  hasMore: boolean
  projections?: {
    asOfSeq: number
    values: SessionProjectionValues
  }
}

export interface SessionExportResult {
  canceled: boolean
  path?: string
  filename?: string
}

export interface JobView {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}

export interface ModelEffort {
  id: string
  name: string
  description?: string
}

export interface ModelEntry {
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: ModelEffort[]
    defaultEffort?: string
  }
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: ImageMediaType
  bytes?: number
  width?: number
  height?: number
  name?: string
}

export type PromptContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: ImageMediaType; data: string; name?: string }

export type PendingAttachment = Extract<PromptContentPart, { type: 'image' }> & {
  id: string
  previewUrl: string
  bytes: number
}

export interface QueueItem {
  id: string
  placement: 'queued' | 'steering' | 'context'
  content: unknown[]
  preview: string
  text: string | null
  source?: 'host' | 'codex'
}

export interface SessionSearchHit {
  sessionId: string
  snippet: string
}

export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  modelInvocable: boolean
}

export interface GoalRef {
  id: string
  revision: number
}

export interface GoalProjection {
  goal: {
    id: string
    revision: number
    objective: string
    phase: 'active' | 'paused' | 'blocked' | 'complete'
    blockedReason?: { code: string; message: string }
    maxGoalRounds: number
  }
  roundsStarted: number
  createdAt: number
  updatedAt: number
}

export type SubagentEntry =
  | {
    kind: 'child'
    id: string
    mode: 'one-shot' | 'continuable'
    activity: 'running' | 'inactive'
    hasChildren: boolean
    label?: string
  }
  | { kind: 'diagnostic'; id: string; reason: 'corrupt' | 'unsupported' | 'unavailable' }

export interface SubagentCatalog {
  entries: SubagentEntry[]
  parentAvailable: boolean
}

export interface ApprovalRequest {
  rpcId: string
  sessionId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
  source?: 'host' | 'codex'
  codexRequestId?: string | number
}

export type TerminalEvent =
  | { id: string; type: 'data'; stream: 'stdout' | 'stderr'; data: string }
  | { id: string; type: 'exit'; code: number | null; signal: string | null }
  | { id: string; type: 'error'; message: string }

export interface SetupSnapshot {
  platform: 'macOS' | 'Windows' | 'Linux'
  host: {
    online: boolean
    managed: boolean
    version?: string
    candidate?: 'checkout' | 'installed' | 'npx'
    candidateLabel?: string
    error?: string
  }
  node: {
    available: boolean
    compatible: boolean
    version?: string
  }
}

export type SetupEvent =
  | { type: 'host-log'; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'host-state'; running: boolean; message: string }

export interface ReviewFileEntry {
  path: string
  indexStatus: string
  worktreeStatus: string
  untracked: boolean
}

export interface ReviewSnapshot {
  git: boolean
  files: ReviewFileEntry[]
  error?: string
}

export interface ReviewTreeEntry {
  name: string
  path: string
  kind: 'directory' | 'file'
  hidden: boolean
  symlink?: boolean
}

export interface ReviewDirectorySnapshot {
  path: string
  entries: ReviewTreeEntry[]
  truncated: boolean
}

export interface AgentWorkspaceResult {
  cwd: string
  isolated: boolean
  reused: boolean
}

export interface ReviewDocument {
  path: string
  content: string
  diff: string
  hash: string
}

export interface SidechatThreadSummary {
  id: string
  title: string
  materialized?: boolean
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionItem {
  id: string
  question: string
  header?: string
  detail?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

export interface QuestionRequest {
  rpcId: string
  sessionId: string
  questions: QuestionItem[]
}

export interface ModelGroup {
  id: string
  name: string
  models: ModelEntry[]
}

export interface SessionModels {
  current: {
    provider: string
    model: string
    reasoningEffort?: string
  }
  routable: boolean
  groups: ModelGroup[]
  failures: Array<{ id: string; name: string; message: string }>
}

export type ToolStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface WebSource {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

export type WebToolView =
  | {
    card: 'web'
    kind: 'search'
    title?: string
    query?: string
    sources: WebSource[]
    answer?: string
    truncated: boolean
  }
  | {
    card: 'web'
    kind: 'fetch'
    title?: string
    url?: string
    statusCode?: number
    truncated: boolean
  }

export type ProcessBlock =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | {
    kind: 'tool'
    name: string
    arguments: string
    callId?: string
    status?: ToolStatus
    result?: string
    startedAt?: number
    finishedAt?: number
    view?: WebToolView
  }
  | { kind: 'image'; label: string; attachmentId?: string; mediaType?: ImageMediaType; src?: string; name?: string }
  | { kind: 'other'; value: unknown }

export type MessageBlock =
  | ProcessBlock
  | { kind: 'thought'; blocks: ProcessBlock[] }

export interface ConversationMessage {
  id: string
  seq: number
  time: number
  role: 'user' | 'assistant'
  blocks: MessageBlock[]
  agent?: 'DeepSeek' | 'Codex'
  streaming?: boolean
  transient?: 'agent-starting'
  streamAssistantItemId?: string
  streamReasoningItemId?: string
  usage?: unknown
}

export interface CodexCatalogModel {
  id: string
  name: string
  description?: string
  defaultEffort: string
  efforts: ModelEffort[]
  isDefault: boolean
}

export interface CodexCatalog {
  available: boolean
  authenticatedWith: 'ChatGPT'
  version?: string
  models: CodexCatalogModel[]
  error?: string
}

export interface CodexPromptResult {
  threadId: string
  turnId: string
}

export interface CodexSteerResult {
  turnId: string
}

export interface ProviderHandoffMessage {
  role: 'user' | 'assistant'
  text: string
  seq: number
}

export type CodexPermissionMode = 'read-only' | 'ask-for-approval' | 'approve-for-me' | 'full-access'
export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline'

export type NetworkMode = 'off' | 'auto' | 'ask'
export type EffectiveNetworkMode = Exclude<NetworkMode, 'ask'>

export interface CodexThreadSnapshot {
  threadId: string
  messages: ConversationMessage[]
}

export interface CodexRateLimitWindow {
  usedPercent: number
  remainingPercent: number
  windowDurationMins?: number
  resetsAt?: number
}

export interface CodexRateLimitBucket {
  id: string
  name: string
  planType?: string
  primary?: CodexRateLimitWindow
  secondary?: CodexRateLimitWindow
  credits?: {
    balance?: string
    hasCredits: boolean
    unlimited: boolean
  }
  individualLimit?: {
    limit: string
    used: string
    remainingPercent: number
    resetsAt: number
  }
  spendControlReached?: boolean
  reachedType?: string
}

export interface CodexUsageSnapshot {
  available: boolean
  accountType?: 'chatgpt' | 'apiKey' | 'amazonBedrock'
  planType?: string
  rateLimits: CodexRateLimitBucket[]
  dailyUsageBuckets: Array<{ startDate: string; tokens: number }>
  summary?: {
    lifetimeTokens?: number
    currentStreakDays?: number
    longestStreakDays?: number
    peakDailyTokens?: number
    longestRunningTurnSec?: number
  }
  updatedAt: number
  stale?: boolean
  warnings?: string[]
  error?: string
}

export interface DeepSeekBalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export interface DeepSeekBillingSnapshot {
  configured: boolean
  source?: 'environment' | 'secure-storage'
  writable: boolean
  balanceAvailable?: boolean
  balances: DeepSeekBalanceInfo[]
  updatedAt: number
  error?: string
}

export type CodexEvent =
  | {
    type: 'usage-updated'
  }
  | {
    type: 'approval-requested'
    requestId: string | number
    sessionId?: string
    threadId?: string
    turnId?: string
    toolName: string
    reason?: string
  }
  | {
    type: 'turn-started'
    sessionId?: string
    threadId: string
    turnId: string
  }
  | {
    type: 'assistant-delta' | 'reasoning-delta'
    sessionId?: string
    threadId: string
    turnId: string
    itemId: string
    delta: string
  }
  | {
    type: 'tool-item'
    sessionId?: string
    threadId: string
    turnId: string
    block: Extract<ProcessBlock, { kind: 'tool' }>
  }
  | {
    type: 'turn-completed'
    sessionId?: string
    threadId: string
    turnId: string
    status: 'completed' | 'interrupted' | 'failed'
    error?: string
  }
  | {
    type: 'error'
    sessionId?: string
    threadId?: string
    turnId?: string
    message: string
  }

export interface DownlinkFrame {
  type: string
  __rpcId?: string
  [key: string]: unknown
}

export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

export interface PluginEntry {
  entryId: string
  moduleName: string
  enabled: boolean
  fiberPhase: PluginFiberPhase
  controllable: boolean
  protectedReason?: string
}

export interface PluginControlSnapshot {
  profile: string
  configFile: string
  entries: PluginEntry[]
}

export interface PluginToggleResult {
  changed: boolean
  backupFile?: string
  snapshot: PluginControlSnapshot
}

export interface AgentPresetEntry {
  id: string
  trust: 'system' | 'user'
  isDefault: boolean
  name?: string
  description?: string
  broken?: string
}

export interface AgentPresetRoster {
  presets: AgentPresetEntry[]
  authorable: boolean
  hasDocument: boolean
}

export interface AgentPresetDocument {
  agentPreset: string
  trust: 'system' | 'user'
  content: string
  name?: string
  description?: string
}

export interface AgentPresetOpenResult {
  opened: boolean
  path?: string
}

export interface SettingsNamespaceView {
  ns: string
  schema: unknown
  value: unknown
  base?: unknown
  user?: unknown
  applies: 'live' | 'restart'
  secrets: SettingsSecretView[]
  revision: number
}

export interface SettingsSecretView {
  path: string[]
  set: boolean
}

export type SettingsPathOpView =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

export interface SettingsDescription {
  writable: boolean
  hasDocument: boolean
  namespaces: SettingsNamespaceView[]
}

export interface CredentialView {
  configured: boolean
  source?: string
  writable: boolean
}

export interface ConfigurableProviderView {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  active: boolean
  declared?: boolean
}

export interface HostModelCatalog {
  groups: ModelGroup[]
  failures: Array<{ id: string; name: string; message: string }>
}

export interface DiscoveredModelView {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}
