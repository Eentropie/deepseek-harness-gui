import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Composer } from './components/Composer.tsx'
import { CommandPalette } from './components/CommandPalette.tsx'
import { Conversation } from './components/Conversation.tsx'
import { GoalDialog } from './components/GoalDialog.tsx'
import { Icon } from './components/Icon.tsx'
import { Inspector } from './components/Inspector.tsx'
import type { QuestionAnswer } from './components/InteractionPanel.tsx'
import { JobDock } from './components/JobDock.tsx'
import { OnboardingWizard } from './components/OnboardingWizard.tsx'
import { PluginManager } from './components/PluginManager.tsx'
import {
  SettingsPanel,
  type InterfaceDensity,
  type LocalFontStatus,
  type ThemeMode,
} from './components/SettingsPanel.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { TerminalDock } from './components/TerminalDock.tsx'
import { codexApi, harnessApi, subscribeCodex, subscribeDownlinks } from './lib/api.ts'
import { applyCodexDeltas, type CodexDeltaEvent } from './lib/codex-stream.ts'
import {
  appendLiveHistory,
  applyLiveProjection,
  ConversationProjector,
  frameSessionId,
  liveHistoryEntry,
  mergeHistoryTail,
  projectActivity,
  projectConversation,
  projectQueue,
} from './lib/history.ts'
import { chooseGreeting } from './lib/greetings.ts'
import {
  collectProviderHandoff,
  mergeProviderTranscripts,
  providerHandoffText,
} from './lib/provider-handoff.ts'
import {
  createPendingTurn,
  pendingTurnMessages,
  pendingTurnReconciled,
  type PendingTurnTransition,
} from './lib/pending-turn.ts'
import { TrailingTask } from './lib/trailing-task.ts'
import { platformBasename as basename, shortcutLabel } from './lib/platform.ts'
import type {
  GoalProjection,
  HistoryPage,
  CodexCatalog,
  CodexEvent,
  CodexPermissionMode,
  ConversationMessage,
  HostDescription,
  HistoryEntry,
  JobView,
  ImageMediaType,
  PendingAttachment,
  PermissionOption,
  PluginControlSnapshot,
  PluginEntry,
  PromptContentPart,
  ApprovalRequest,
  QuestionRequest,
  QueueItem,
  SessionSearchHit,
  SessionModels,
  SessionSummary,
  SidechatThreadSummary,
  SkillEntry,
  SubagentCatalog,
  SubagentEntry,
  WorkspaceSummary,
} from './lib/types.ts'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting'

const EMPTY_HISTORY: HistoryPage = { events: [], hasMore: false }
const CODEX_PROVIDER = 'codex-cli'
const DEFAULT_CODEX_PERMISSION: CodexPermissionMode = 'ask-for-approval'
const CODEX_PERMISSION_OPTIONS: PermissionOption[] = [
  { value: 'ask-for-approval', name: 'Ask for approval', description: 'Ask you before privileged commands or sandbox escapes.' },
  { value: 'approve-for-me', name: 'Approve for me', description: 'Route approval requests to the Codex automatic reviewer.' },
  { value: 'full-access', name: 'Full access', description: 'Run without approval prompts or filesystem sandboxing.' },
]
const HOST_PERMISSION_OPTIONS: PermissionOption[] = [
  { value: 'read-only', name: 'Read only', description: 'Allow inspection without writing workspace files.' },
  { value: 'workspace-write', name: 'Write in workspace', description: 'Allow changes inside the selected workspace.' },
  { value: 'danger-full-access', name: 'Full access', description: 'Run without the workspace filesystem sandbox.' },
]
const DEFAULT_HOST_PERMISSION = 'workspace-write'
const STARTUP_SESSION_ID = new URLSearchParams(window.location.search).get('sessionId') ?? undefined
const GREETING_STORAGE_KEY = 'dsh-workbench-last-greeting'
const DRAFT_STORAGE_KEY = 'dsh-workbench-session-drafts'
const SIDECHAT_HOST_STORAGE_KEY = 'dsh-workbench-sidechat-host-sessions'
const SIDECHAT_SELECTION_STORAGE_PREFIX = 'dsh-workbench-sidechat-selection:'
const SIDECHAT_THREADS_STORAGE_KEY = 'dsh-workbench-sidechat-threads-v1'
const SIDECHAT_ACTIVE_STORAGE_KEY = 'dsh-workbench-sidechat-active-v1'
const TERMINAL_OPEN_STORAGE_KEY = 'dsh-workbench-terminal-open'
const ONBOARDING_STORAGE_KEY = 'dsh-workbench-onboarding-v1'
const STARTUP_GREETING = (() => {
  const greeting = chooseGreeting(new Date(), localStorage.getItem(GREETING_STORAGE_KEY) ?? undefined)
  localStorage.setItem(GREETING_STORAGE_KEY, greeting)
  return greeting
})()

interface CodexSessionState {
  active: boolean
  threadId?: string
  model?: string
  effort?: string
  permission?: CodexPermissionMode
  codexImportedHostSeq?: number
  deepSeekImportedCodexSeq?: number
}

interface PendingSession {
  key: string
  workspaceId?: string
  cwd?: string
  agentPreset?: string
}

interface SidechatSelection {
  provider: string
  model: string
  effort?: string
  permission: string
}

const DEFAULT_SIDECHAT_THREAD: SidechatThreadSummary = { id: 'main', title: 'Sidechat 1' }

const EMPTY_CODEX_SESSION: CodexSessionState = { active: false, permission: DEFAULT_CODEX_PERMISSION }

function codexSessionKey(sessionId: string): string {
  return `dsh-workbench-codex-session:${sessionId}`
}

function readCodexSession(sessionId: string): CodexSessionState {
  try {
    const value = JSON.parse(localStorage.getItem(codexSessionKey(sessionId)) ?? 'null') as unknown
    if (typeof value !== 'object' || value === null) return EMPTY_CODEX_SESSION
    const record = value as Record<string, unknown>
    const rawPermission = record['permission']
    const permission = rawPermission === 'ask-for-approval' || rawPermission === 'approve-for-me' || rawPermission === 'full-access'
      ? rawPermission
      : DEFAULT_CODEX_PERMISSION
    return {
      active: record['active'] === true,
      ...(typeof record['threadId'] === 'string' ? { threadId: record['threadId'] } : {}),
      ...(typeof record['model'] === 'string' ? { model: record['model'] } : {}),
      ...(typeof record['effort'] === 'string' ? { effort: record['effort'] } : {}),
      ...(typeof record['codexImportedHostSeq'] === 'number' && Number.isSafeInteger(record['codexImportedHostSeq'])
        ? { codexImportedHostSeq: record['codexImportedHostSeq'] }
        : {}),
      ...(typeof record['deepSeekImportedCodexSeq'] === 'number' && Number.isSafeInteger(record['deepSeekImportedCodexSeq'])
        ? { deepSeekImportedCodexSeq: record['deepSeekImportedCodexSeq'] }
        : {}),
      permission,
    }
  } catch {
    return EMPTY_CODEX_SESSION
  }
}

function writeCodexSession(sessionId: string, state: CodexSessionState): void {
  localStorage.setItem(codexSessionKey(sessionId), JSON.stringify(state))
}

function readSidechatSelection(sessionId: string): SidechatSelection | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(`${SIDECHAT_SELECTION_STORAGE_PREFIX}${sessionId}`) ?? 'null') as unknown
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (typeof record['provider'] !== 'string' || typeof record['model'] !== 'string' || typeof record['permission'] !== 'string') return undefined
    return {
      provider: record['provider'],
      model: record['model'],
      ...(typeof record['effort'] === 'string' ? { effort: record['effort'] } : {}),
      permission: record['permission'],
    }
  } catch {
    return undefined
  }
}

function writeSidechatSelection(sessionId: string, value: SidechatSelection): void {
  localStorage.setItem(`${SIDECHAT_SELECTION_STORAGE_PREFIX}${sessionId}`, JSON.stringify(value))
}

function readSidechatThreads(): Record<string, SidechatThreadSummary[]> {
  try {
    const value = JSON.parse(localStorage.getItem(SIDECHAT_THREADS_STORAGE_KEY) ?? '{}') as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const result: Record<string, SidechatThreadSummary[]> = {}
    for (const [parentId, candidate] of Object.entries(value as Record<string, unknown>)) {
      if (!Array.isArray(candidate)) continue
      const threads = candidate.flatMap(entry => {
        if (typeof entry !== 'object' || entry === null) return []
        const record = entry as Record<string, unknown>
        if (typeof record['id'] !== 'string' || !/^[a-zA-Z0-9-]{1,96}$/.test(record['id']) || typeof record['title'] !== 'string') return []
        return [{ id: record['id'], title: record['title'].trim().slice(0, 48) || 'Sidechat' }]
      }).slice(0, 24)
      if (threads.length > 0) result[parentId] = threads
    }
    return result
  } catch {
    return {}
  }
}

function sidechatOwnerId(parentSessionId: string, threadId: string): string {
  return threadId === DEFAULT_SIDECHAT_THREAD.id
    ? `sidechat:${parentSessionId}`
    : `sidechat:${parentSessionId}:${threadId}`
}

function titleOf(session?: SessionSummary): string {
  const title = session?.projections?.values.title
  return typeof title === 'string' && title.trim() !== '' ? title : 'New session'
}

function errorText(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

function storedBoolean(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key)
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function storedStringSet(key: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function storedDrafts(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? '{}') as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
      .slice(-60))
  } catch {
    return {}
  }
}

function storedStringMap(key: string): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''))
  } catch {
    return {}
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

function storedThemeMode(): ThemeMode {
  const value = localStorage.getItem('dsh-workbench-theme-mode')
    ?? localStorage.getItem('dsh-workbench-theme')
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system'
}

function imageMediaType(file: File): ImageMediaType | undefined {
  return file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp' || file.type === 'image/gif'
    ? file.type
    : undefined
}

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function App() {
  const [host, setHost] = useState<HostDescription>()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [archivedSessionIds, setArchivedSessionIds] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>(STARTUP_SESSION_ID)
  const [pinnedSessionIds, setPinnedSessionIds] = useState(() => storedStringSet('dsh-workbench-pinned-sessions'))
  const [unreadSessionIds, setUnreadSessionIds] = useState(() => storedStringSet('dsh-workbench-unread-sessions'))
  const [deletedSessionIds, setDeletedSessionIds] = useState(() => storedStringSet('dsh-workbench-deleted-sessions'))
  const [subagentView, setSubagentView] = useState<{ parentSessionId: string; childSessionId: string; mode: 'one-shot' | 'continuable'; label: string }>()
  const [pendingSession, setPendingSession] = useState<PendingSession>()
  const [history, setHistory] = useState<HistoryPage>(EMPTY_HISTORY)
  const [models, setModels] = useState<SessionModels>()
  const [codexCatalog, setCodexCatalog] = useState<CodexCatalog>({
    available: false,
    authenticatedWith: 'ChatGPT',
    models: [],
  })
  const [codexSession, setCodexSession] = useState<CodexSessionState>(EMPTY_CODEX_SESSION)
  const [codexMessages, setCodexMessages] = useState<ConversationMessage[]>([])
  const [codexRunning, setCodexRunning] = useState(false)
  const [codexTurnId, setCodexTurnId] = useState<string>()
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [chromeLoading, setChromeLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false)
  const [busy, setBusy] = useState(false)
  const [conversationScrollRequest, setConversationScrollRequest] = useState(0)
  const [pendingTurns, setPendingTurns] = useState<Record<string, PendingTurnTransition>>({})
  const [pendingHostPermission, setPendingHostPermission] = useState(DEFAULT_HOST_PERMISSION)
  const [drafts, setDrafts] = useState<Record<string, string>>(storedDrafts)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [queueBySession, setQueueBySession] = useState<Record<string, QueueItem[]>>({})
  const [jobsBySession, setJobsBySession] = useState<Record<string, JobView[]>>({})
  const [searchHits, setSearchHits] = useState<SessionSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [subagents, setSubagents] = useState<SubagentCatalog>()
  const [attachmentSources, setAttachmentSources] = useState<Record<string, string>>({})
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([])
  const [pendingQuestions, setPendingQuestions] = useState<QuestionRequest[]>([])
  const [sidechatHostSessions, setSidechatHostSessions] = useState<Record<string, string>>(
    () => storedStringMap(SIDECHAT_HOST_STORAGE_KEY),
  )
  const [sidechatThreadsByParent, setSidechatThreadsByParent] = useState<Record<string, SidechatThreadSummary[]>>(readSidechatThreads)
  const [activeSidechatByParent, setActiveSidechatByParent] = useState<Record<string, string>>(
    () => storedStringMap(SIDECHAT_ACTIVE_STORAGE_KEY),
  )
  const [sidechatMessages, setSidechatMessages] = useState<ConversationMessage[]>([])
  const [sidechatRunning, setSidechatRunning] = useState(false)
  const [sidechatTurnId, setSidechatTurnId] = useState<string>()
  const [sidechatError, setSidechatError] = useState<string>()
  const [sidechatSelection, setSidechatSelection] = useState<SidechatSelection>()
  const [goalDialog, setGoalDialog] = useState<{ mode: 'create' | 'edit'; objective: string; rounds: number }>()
  const [goalDialogBusy, setGoalDialogBusy] = useState(false)
  const [goalDialogError, setGoalDialogError] = useState<string>()
  const [appError, setAppError] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(() => !storedBoolean(ONBOARDING_STORAGE_KEY, false))
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [plugins, setPlugins] = useState<PluginControlSnapshot>()
  const [pluginsLoading, setPluginsLoading] = useState(false)
  const [pluginChangingId, setPluginChangingId] = useState<string>()
  const [pluginError, setPluginError] = useState<string>()
  const [pluginBackup, setPluginBackup] = useState<string>()
  const [sidebarExpanded, setSidebarExpanded] = useState(() => storedBoolean('dsh-workbench-sidebar', true))
  const [inspectorOpen, setInspectorOpen] = useState(() => storedBoolean('dsh-workbench-inspector', true))
  const [terminalOpen, setTerminalOpen] = useState(() => storedBoolean(TERMINAL_OPEN_STORAGE_KEY, false))
  const [themeMode, setThemeMode] = useState<ThemeMode>(storedThemeMode)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [density, setDensity] = useState<InterfaceDensity>(() => localStorage.getItem('dsh-workbench-density') === 'compact' ? 'compact' : 'comfortable')
  const [responseSerif, setResponseSerif] = useState(() => storedBoolean('dsh-workbench-response-serif', true))
  const [reduceMotion, setReduceMotion] = useState(() => storedBoolean('dsh-workbench-reduce-motion', false))
  const [resumeLastSession, setResumeLastSession] = useState(() => storedBoolean('dsh-workbench-resume-last', true))
  const [fontStatus, setFontStatus] = useState<LocalFontStatus>('checking')
  const selectedRef = useRef<string>()
  const historyGeneration = useRef(0)
  const historyRef = useRef<HistoryPage>(EMPTY_HISTORY)
  const searchGeneration = useRef(0)
  const chromeRefreshes = useRef(new TrailingTask<'chrome'>())
  const historyRefreshes = useRef(new TrailingTask<string>())
  const conversationProjector = useRef<{ owner: string; projector: ConversationProjector }>()
  const codexDeltaQueue = useRef<CodexDeltaEvent[]>([])
  const codexDeltaTimer = useRef<number>()
  const sidechatOwnerRef = useRef<string>()
  const sidechatCodexActiveRef = useRef(false)
  const sidechatGeneration = useRef(0)
  const providerTranscriptCache = useRef<Record<string, {
    deepSeek: ConversationMessage[]
    codex: ConversationMessage[]
  }>>({})
  const dark = themeMode === 'dark' || (themeMode === 'system' && systemDark)

  const selectSession = useCallback((sessionId: string): void => {
    setPendingSession(undefined)
    setSubagentView(undefined)
    setSelectedId(sessionId)
    setUnreadSessionIds(current => {
      if (!current.has(sessionId)) return current
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
  }, [])

  const selected = useMemo(
    () => sessions.find(session => session.sessionId === selectedId),
    [selectedId, sessions],
  )
  const selectedWorkspace = useMemo(
    () => workspaces.find(workspace => selectedId !== undefined && workspace.sessionIds.includes(selectedId)),
    [selectedId, workspaces],
  )
  const hiddenSidechatSessionIds = useMemo(
    () => new Set(Object.values(sidechatHostSessions)),
    [sidechatHostSessions],
  )
  const visibleSessions = useMemo(
    () => sessions.filter(session => !hiddenSidechatSessionIds.has(session.sessionId)),
    [hiddenSidechatSessionIds, sessions],
  )
  const visibleWorkspaces = useMemo(
    () => workspaces.map(workspace => ({
      ...workspace,
      sessionIds: workspace.sessionIds.filter(sessionId => !hiddenSidechatSessionIds.has(sessionId)),
    })),
    [hiddenSidechatSessionIds, workspaces],
  )
  const pendingWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.workspaceId === pendingSession?.workspaceId),
    [pendingSession?.workspaceId, workspaces],
  )
  const activeWorkspace = selectedWorkspace ?? pendingWorkspace
  const draftKey = pendingSession?.key
    ?? (subagentView === undefined ? selectedId : `subagent:${subagentView.childSessionId}`)
    ?? 'pending:unscoped'
  const draft = drafts[draftKey] ?? ''
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>((nextValue) => {
    setDrafts(current => {
      const currentValue = current[draftKey] ?? ''
      const value = typeof nextValue === 'function' ? nextValue(currentValue) : nextValue
      const { [draftKey]: _discarded, ...rest } = current
      return value === '' ? rest : { ...rest, [draftKey]: value }
    })
  }, [draftKey])
  const messages = useMemo(() => {
    const owner = subagentView?.childSessionId ?? selectedId ?? 'pending'
    if (conversationProjector.current?.owner !== owner) {
      conversationProjector.current = { owner, projector: new ConversationProjector() }
    }
    const projected = conversationProjector.current.projector.sync(history.events)
    let changed = false
    const withAttachments = projected.map(message => {
      let blocksChanged = false
      const blocks = message.blocks.map(block => {
        if (block.kind !== 'image' || block.attachmentId === undefined) return block
        const source = attachmentSources[`${owner}:${block.attachmentId}`]
        if (source === undefined || source === block.src) return block
        blocksChanged = true
        return { ...block, src: source }
      })
      if (!blocksChanged) return message
      changed = true
      return { ...message, blocks }
    })
    return changed ? withAttachments : projected
  }, [attachmentSources, history.events, selectedId, subagentView?.childSessionId])
  let providerCache: { deepSeek: ConversationMessage[]; codex: ConversationMessage[] } | undefined
  if (selectedId !== undefined) {
    providerCache = providerTranscriptCache.current[selectedId] ?? { deepSeek: [], codex: [] }
    if (messages.length > 0) providerCache.deepSeek = messages
    if (codexMessages.length > 0) providerCache.codex = codexMessages
    providerTranscriptCache.current[selectedId] = providerCache
  }
  const retainedDeepSeekMessages = messages.length > 0 ? messages : providerCache?.deepSeek ?? []
  const retainedCodexMessages = codexMessages.length > 0 ? codexMessages : providerCache?.codex ?? []
  const unifiedMessages = useMemo(
    () => subagentView === undefined
      ? mergeProviderTranscripts(retainedDeepSeekMessages, retainedCodexMessages)
      : messages,
    [messages, retainedCodexMessages, retainedDeepSeekMessages, subagentView],
  )
  const conversationOwner = subagentView?.childSessionId ?? selectedId ?? pendingSession?.key ?? draftKey
  const pendingTurn = pendingTurns[conversationOwner]
  const smoothMessages = useMemo(() => pendingTurn === undefined
    ? unifiedMessages
    : [...unifiedMessages, ...pendingTurnMessages(pendingTurn, messages)],
  [messages, pendingTurn, unifiedMessages])

  useEffect(() => {
    if (pendingTurn === undefined || !pendingTurnReconciled(pendingTurn, messages)) return
    setPendingTurns(current => {
      if (current[conversationOwner]?.id !== pendingTurn.id) return current
      const { [conversationOwner]: _settled, ...rest } = current
      return rest
    })
  }, [conversationOwner, messages, pendingTurn])
  const activity = useMemo(() => projectActivity(history.events), [history.events])
  const projectionValues = history.projections?.values ?? selected?.projections?.values
  const permissions = projectionValues?.permissions
  const activeQueue = selectedId === undefined || subagentView !== undefined ? [] : queueBySession[selectedId] ?? []
  const activeSubagent = subagentView === undefined
    ? undefined
    : subagents?.entries.find((entry): entry is Extract<SubagentEntry, { kind: 'child' }> => entry.kind === 'child' && entry.id === subagentView.childSessionId)
  const selectedForView = selected === undefined || history.projections === undefined
    ? selected
    : { ...selected, projections: history.projections }

  const presentedModels = useMemo<SessionModels | undefined>(() => {
    if (models === undefined) return undefined
    const codexGroup = codexCatalog.available && codexCatalog.models.length > 0
      ? [{
          id: CODEX_PROVIDER,
          name: 'ChatGPT · Codex CLI',
          models: codexCatalog.models.map(model => ({
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
            reasoning: {
              efforts: model.efforts,
              defaultEffort: model.defaultEffort,
            },
          })),
        }]
      : []
    const selectedCodexModel = codexCatalog.models.find(model => model.id === codexSession.model)
      ?? codexCatalog.models.find(model => model.isDefault)
      ?? codexCatalog.models[0]
    const codexEffort = selectedCodexModel === undefined
      ? undefined
      : selectedCodexModel.efforts.some(effort => effort.id === codexSession.effort)
        ? codexSession.effort
        : selectedCodexModel.defaultEffort
    const useCodex = codexSession.active && codexCatalog.available && selectedCodexModel !== undefined
    return {
      ...models,
      current: useCodex
        ? {
            provider: CODEX_PROVIDER,
            model: selectedCodexModel.id,
            ...(codexEffort === undefined ? {} : { reasoningEffort: codexEffort }),
          }
        : models.current,
      routable: useCodex ? true : models.routable,
      groups: [...models.groups, ...codexGroup],
      failures: codexCatalog.error === undefined
        ? models.failures
        : [...models.failures, { id: CODEX_PROVIDER, name: 'Codex CLI', message: codexCatalog.error }],
    }
  }, [codexCatalog, codexSession, models])
  const codexActive = subagentView === undefined && presentedModels?.current.provider === CODEX_PROVIDER
  const codexPermission = codexSession.permission ?? DEFAULT_CODEX_PERMISSION
  const presentedPermissionOptions = codexActive
    ? CODEX_PERMISSION_OPTIONS
    : permissions?.options ?? (pendingSession === undefined ? [] : HOST_PERMISSION_OPTIONS)
  const presentedPermission = codexActive
    ? codexPermission
    : permissions?.currentValue ?? (pendingSession === undefined ? undefined : pendingHostPermission)
  const sidechatThreads = useMemo(
    () => selectedId === undefined ? [] : sidechatThreadsByParent[selectedId] ?? [DEFAULT_SIDECHAT_THREAD],
    [selectedId, sidechatThreadsByParent],
  )
  const activeSidechatId = selectedId === undefined
    ? undefined
    : sidechatThreads.some(thread => thread.id === activeSidechatByParent[selectedId])
      ? activeSidechatByParent[selectedId]
      : sidechatThreads[0]?.id
  const activeSidechat = sidechatThreads.find(thread => thread.id === activeSidechatId)
  const sidechatOwner = selectedId === undefined || activeSidechatId === undefined
    ? undefined
    : sidechatOwnerId(selectedId, activeSidechatId)
  const sidechatHostSessionId = sidechatOwner === undefined
    ? undefined
    : sidechatHostSessions[sidechatOwner]
      ?? (activeSidechatId === DEFAULT_SIDECHAT_THREAD.id && selectedId !== undefined ? sidechatHostSessions[selectedId] : undefined)
  const sidechatCodexActive = sidechatSelection?.provider === CODEX_PROVIDER
  const sidechatModelEntry = sidechatSelection === undefined
    ? undefined
    : presentedModels?.groups.find(group => group.id === sidechatSelection.provider)?.models.find(model => model.id === sidechatSelection.model)
  const sidechatModels = presentedModels === undefined || sidechatSelection === undefined
    ? undefined
    : {
        ...presentedModels,
        current: {
          provider: sidechatSelection.provider,
          model: sidechatSelection.model,
          ...(sidechatSelection.effort === undefined ? {} : { reasoningEffort: sidechatSelection.effort }),
        },
      }
  const sidechatPermissionOptions = sidechatCodexActive
    ? CODEX_PERMISSION_OPTIONS
    : permissions?.options ?? HOST_PERMISSION_OPTIONS

  const refreshCodexCatalog = useCallback(async (force = false): Promise<void> => {
    try {
      setCodexCatalog(await codexApi.catalog(force))
    } catch (reason) {
      setCodexCatalog({
        available: false,
        authenticatedWith: 'ChatGPT',
        models: [],
        error: errorText(reason),
      })
    }
  }, [])

  useEffect(() => {
    selectedRef.current = selectedId
    if (selectedId !== undefined) localStorage.setItem('dsh-workbench-session', selectedId)
  }, [selectedId])

  useEffect(() => {
    localStorage.setItem('dsh-workbench-pinned-sessions', JSON.stringify([...pinnedSessionIds]))
  }, [pinnedSessionIds])

  useEffect(() => {
    localStorage.setItem('dsh-workbench-unread-sessions', JSON.stringify([...unreadSessionIds]))
  }, [unreadSessionIds])

  useEffect(() => {
    localStorage.setItem('dsh-workbench-deleted-sessions', JSON.stringify([...deletedSessionIds]))
  }, [deletedSessionIds])

  useEffect(() => {
    localStorage.setItem(SIDECHAT_HOST_STORAGE_KEY, JSON.stringify(sidechatHostSessions))
  }, [sidechatHostSessions])

  useEffect(() => {
    localStorage.setItem(SIDECHAT_THREADS_STORAGE_KEY, JSON.stringify(sidechatThreadsByParent))
  }, [sidechatThreadsByParent])

  useEffect(() => {
    localStorage.setItem(SIDECHAT_ACTIVE_STORAGE_KEY, JSON.stringify(activeSidechatByParent))
  }, [activeSidechatByParent])

  useEffect(() => {
    localStorage.setItem(TERMINAL_OPEN_STORAGE_KEY, String(terminalOpen))
  }, [terminalOpen])

  useEffect(() => {
    if (sidechatOwner === undefined || presentedModels === undefined) {
      setSidechatSelection(undefined)
      return
    }
    const legacyStored = activeSidechatId === DEFAULT_SIDECHAT_THREAD.id && selectedId !== undefined
      ? readSidechatSelection(selectedId)
      : undefined
    const stored = legacyStored ?? readSidechatSelection(sidechatOwner)
    if (legacyStored !== undefined && selectedId !== undefined) {
      localStorage.removeItem(`${SIDECHAT_SELECTION_STORAGE_PREFIX}${selectedId}`)
    }
    const storedModel = stored === undefined
      ? undefined
      : presentedModels.groups.find(group => group.id === stored.provider)?.models.find(model => model.id === stored.model)
    if (stored !== undefined && storedModel !== undefined) {
      const efforts = storedModel.reasoning?.efforts ?? []
      const effort = stored.effort !== undefined && efforts.some(item => item.id === stored.effort)
        ? stored.effort
        : storedModel.reasoning?.defaultEffort
      const permissionOptions = stored.provider === CODEX_PROVIDER
        ? CODEX_PERMISSION_OPTIONS
        : permissions?.options ?? HOST_PERMISSION_OPTIONS
      const permission = permissionOptions.some(option => option.value === stored.permission)
        ? stored.permission
        : stored.provider === CODEX_PROVIDER ? DEFAULT_CODEX_PERMISSION : presentedPermission ?? DEFAULT_HOST_PERMISSION
      const next: SidechatSelection = {
        provider: stored.provider,
        model: stored.model,
        ...(effort === undefined ? {} : { effort }),
        permission,
      }
      writeSidechatSelection(sidechatOwner, next)
      setSidechatSelection(next)
      return
    }
    const current = presentedModels.current
    const next: SidechatSelection = {
      provider: current.provider,
      model: current.model,
      ...(current.reasoningEffort === undefined ? {} : { effort: current.reasoningEffort }),
      permission: current.provider === CODEX_PROVIDER ? codexPermission : presentedPermission ?? DEFAULT_HOST_PERMISSION,
    }
    writeSidechatSelection(sidechatOwner, next)
    setSidechatSelection(next)
  }, [activeSidechatId, codexPermission, permissions?.options, presentedModels, presentedPermission, selectedId, sidechatOwner])

  useEffect(() => {
    if (pendingApprovals.length + pendingQuestions.length > 0) setInspectorOpen(true)
  }, [pendingApprovals.length, pendingQuestions.length])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(drafts).slice(-60))))
      } catch {
        // Keep drafts in memory if local storage is temporarily full or unavailable.
      }
    }, 320)
    return () => window.clearTimeout(timer)
  }, [drafts])

  useEffect(() => {
    void refreshCodexCatalog(true)
  }, [refreshCodexCatalog])

  useEffect(() => {
    if (codexCatalog.available) return
    const timer = window.setInterval(() => { void refreshCodexCatalog(true) }, 15_000)
    return () => window.clearInterval(timer)
  }, [codexCatalog.available, refreshCodexCatalog])

  const flushCodexDeltas = useCallback((): void => {
    if (codexDeltaTimer.current !== undefined) window.clearTimeout(codexDeltaTimer.current)
    codexDeltaTimer.current = undefined
    if (codexDeltaQueue.current.length === 0) return
    const events = codexDeltaQueue.current
    codexDeltaQueue.current = []
    setCodexMessages(current => applyCodexDeltas(current, events))
  }, [])

  const queueCodexDelta = useCallback((event: CodexDeltaEvent): void => {
    codexDeltaQueue.current.push(event)
    if (codexDeltaTimer.current !== undefined) return
    codexDeltaTimer.current = window.setTimeout(flushCodexDeltas, 48)
  }, [flushCodexDeltas])

  useEffect(() => () => {
    if (codexDeltaTimer.current !== undefined) window.clearTimeout(codexDeltaTimer.current)
  }, [])

  useEffect(() => {
    if (codexDeltaTimer.current !== undefined) window.clearTimeout(codexDeltaTimer.current)
    codexDeltaTimer.current = undefined
    codexDeltaQueue.current = []
    setCodexMessages([])
    setCodexRunning(false)
    setCodexTurnId(undefined)
    const stateKey = selectedId ?? pendingSession?.key
    if (stateKey === undefined) {
      setCodexSession(EMPTY_CODEX_SESSION)
      return
    }
    const state = readCodexSession(stateKey)
    setCodexSession(state)
    if (selectedId === undefined || state.threadId === undefined) return
    let active = true
    void codexApi.readThread(state.threadId).then(snapshot => {
      if (active && selectedRef.current === selectedId) {
        setCodexMessages(snapshot.messages)
      }
    }).catch(reason => {
      if (active && state.active) setActionError(`Codex 线程读取失败：${errorText(reason)}`)
    })
    return () => { active = false }
  }, [pendingSession?.key, selectedId])

  useEffect(() => {
    const generation = ++sidechatGeneration.current
    sidechatOwnerRef.current = sidechatOwner
    sidechatCodexActiveRef.current = sidechatCodexActive
    setSidechatMessages([])
    setSidechatRunning(false)
    setSidechatTurnId(undefined)
    setSidechatError(undefined)
    if (sidechatOwner === undefined) return
    let active = true
    if (sidechatCodexActive) {
      const state = readCodexSession(sidechatOwner)
      if (state.threadId === undefined) return () => { active = false }
      void codexApi.readThread(state.threadId).then(snapshot => {
        if (active && generation === sidechatGeneration.current) setSidechatMessages(snapshot.messages)
      }).catch(reason => {
        if (active && generation === sidechatGeneration.current) setSidechatError(errorText(reason))
      })
      return () => { active = false }
    }
    if (sidechatHostSessionId === undefined) return () => { active = false }
    void Promise.all([harnessApi.history(sidechatHostSessionId), harnessApi.sessions()]).then(([page, list]) => {
      if (!active || generation !== sidechatGeneration.current) return
      setSidechatMessages(projectConversation(page.events))
      setSidechatRunning(list.items.find(item => item.sessionId === sidechatHostSessionId)?.running === true)
    }).catch(reason => {
      if (active && generation === sidechatGeneration.current) setSidechatError(errorText(reason))
    })
    return () => { active = false }
  }, [sidechatCodexActive, sidechatHostSessionId, sidechatOwner])

  useEffect(() => subscribeCodex((event: CodexEvent) => {
    if (event.type === 'usage-updated') return
    if (event.type === 'approval-requested') {
      const requestSessionId = event.sessionId ?? selectedRef.current
      if (requestSessionId === undefined) {
        void codexApi.respondApproval(event.requestId, false)
        return
      }
      const rpcId = `codex-${String(event.requestId)}`
      setPendingApprovals(current => current.some(item => item.rpcId === rpcId)
        ? current
        : [...current, {
            rpcId,
            sessionId: requestSessionId,
            approvalId: String(event.requestId),
            toolName: event.toolName,
            ...(event.reason === undefined ? {} : { reason: event.reason }),
            source: 'codex',
            codexRequestId: event.requestId,
          }])
      return
    }
    const sessionId = event.sessionId
    if (sessionId?.startsWith('sidechat:') === true) {
      if (!sidechatCodexActiveRef.current || sessionId !== sidechatOwnerRef.current) return
      if (event.type === 'turn-started') {
        setSidechatRunning(true)
        setSidechatTurnId(event.turnId)
        return
      }
      if (event.type === 'assistant-delta' || event.type === 'reasoning-delta') {
        setSidechatMessages(current => applyCodexDeltas(current, [event]))
        return
      }
      if (event.type === 'turn-completed') {
        setSidechatTurnId(undefined)
        if (event.status === 'failed') setSidechatError(event.error ?? 'Codex sidechat failed')
        void codexApi.readThread(event.threadId).then(snapshot => {
          if (event.sessionId === sidechatOwnerRef.current && sidechatCodexActiveRef.current) {
            setSidechatMessages(snapshot.messages)
          }
        }).catch(reason => setSidechatError(errorText(reason)))
          .finally(() => {
            if (event.sessionId === sidechatOwnerRef.current) setSidechatRunning(false)
          })
        return
      }
      if (event.type === 'error') {
        setSidechatRunning(false)
        setSidechatTurnId(undefined)
        setSidechatError(event.message)
      }
      return
    }
    if (sessionId !== undefined && sessionId !== selectedRef.current) return
    if (event.type === 'turn-started') {
      setCodexRunning(true)
      setCodexTurnId(event.turnId)
      return
    }
    if (event.type === 'assistant-delta' || event.type === 'reasoning-delta') {
      queueCodexDelta(event)
      return
    }
    if (event.type === 'turn-completed') {
      flushCodexDeltas()
      setCodexTurnId(undefined)
      if (event.status === 'failed') setActionError(`Codex 运行失败：${event.error ?? 'Unknown error'}`)
      void codexApi.readThread(event.threadId).then(snapshot => {
        if (event.sessionId === undefined || event.sessionId === selectedRef.current) setCodexMessages(snapshot.messages)
      }).catch(reason => setActionError(`Codex 线程刷新失败：${errorText(reason)}`))
        .finally(() => setCodexRunning(false))
      return
    }
    if (event.type === 'error') {
      flushCodexDeltas()
      setCodexRunning(false)
      setCodexTurnId(undefined)
      setActionError(`Codex CLI：${event.message}`)
    }
  }), [flushCodexDeltas, queueCodexDelta])

  useEffect(() => {
    const ownerSessionId = subagentView?.childSessionId ?? selectedId
    if (ownerSessionId === undefined) return
    const refs = messages.flatMap(message => message.blocks.flatMap(block => {
      if (block.kind !== 'image' || block.attachmentId === undefined || block.mediaType === undefined) return []
      const key = `${ownerSessionId}:${block.attachmentId}`
      return attachmentSources[key] === undefined ? [{ key, id: block.attachmentId, mediaType: block.mediaType }] : []
    }))
    if (refs.length === 0) return
    let active = true
    void Promise.allSettled(refs.map(async ref => {
      const result = await harnessApi.readAttachment(ownerSessionId, ref.id)
      return { key: ref.key, source: `data:${result.attachment.mediaType ?? ref.mediaType};base64,${result.data}` }
    })).then(results => {
      if (!active) return
      const loaded = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      if (loaded.length === 0) return
      setAttachmentSources(current => {
        const next = { ...current }
        loaded.forEach(item => { next[item.key] = item.source })
        return next
      })
    })
    return () => { active = false }
  }, [attachmentSources, messages, selectedId, subagentView?.childSessionId])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setSystemDark(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.dataset['theme'] = dark ? 'dark' : 'light'
    root.dataset['density'] = density
    root.dataset['responseSerif'] = String(responseSerif)
    root.dataset['reduceMotion'] = String(reduceMotion)
    localStorage.setItem('dsh-workbench-theme-mode', themeMode)
    localStorage.setItem('dsh-workbench-theme', dark ? 'dark' : 'light')
    localStorage.setItem('dsh-workbench-density', density)
    localStorage.setItem('dsh-workbench-response-serif', String(responseSerif))
    localStorage.setItem('dsh-workbench-reduce-motion', String(reduceMotion))
  }, [dark, density, reduceMotion, responseSerif, themeMode])

  useEffect(() => {
    localStorage.setItem('dsh-workbench-sidebar', String(sidebarExpanded))
    localStorage.setItem('dsh-workbench-inspector', String(inspectorOpen))
    localStorage.setItem('dsh-workbench-resume-last', String(resumeLastSession))
  }, [inspectorOpen, resumeLastSession, sidebarExpanded])

  useEffect(() => {
    let active = true
    void Promise.allSettled([
      document.fonts.load('14px "Workbench Sans"'),
      document.fonts.load('16px "Workbench Serif"'),
    ]).then(() => {
      if (!active) return
      const faces = [...document.fonts]
      const sans = faces.some(face => face.family === 'Workbench Sans' && face.status === 'loaded')
      const serif = faces.some(face => face.family === 'Workbench Serif' && face.status === 'loaded')
      setFontStatus(sans && serif ? 'pair' : sans ? 'sans' : 'fallback')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.title = selected === undefined ? 'DeepSeek Harness' : `${titleOf(selected)} · DeepSeek Harness`
  }, [selected])

  const refreshChromeNow = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const [description, sessionPage, workspacePage] = await Promise.all([
        harnessApi.describe(signal),
        harnessApi.sessions(signal),
        harnessApi.workspaces(signal),
      ])
      setHost(description)
      setSessions(sessionPage.items)
      setWorkspaces(workspacePage.items)
      setArchivedSessionIds(workspacePage.archivedSessionIds)
      setAppError(undefined)
      setSelectedId(current => {
        if (current !== undefined && sessionPage.items.some(session => session.sessionId === current)
          && !deletedSessionIds.has(current) && !hiddenSidechatSessionIds.has(current)) return current
        if (pendingSession !== undefined) return undefined
        const saved = resumeLastSession ? localStorage.getItem('dsh-workbench-session') : null
        if (saved !== null && !deletedSessionIds.has(saved)
          && !hiddenSidechatSessionIds.has(saved)
          && sessionPage.items.some(session => session.sessionId === saved)) return saved
        return sessionPage.items.find(session => !deletedSessionIds.has(session.sessionId)
            && !hiddenSidechatSessionIds.has(session.sessionId)
            && !workspacePage.archivedSessionIds.includes(session.sessionId) && !session.blank)?.sessionId
          ?? sessionPage.items.find(session => !deletedSessionIds.has(session.sessionId)
            && !hiddenSidechatSessionIds.has(session.sessionId)
            && !workspacePage.archivedSessionIds.includes(session.sessionId))?.sessionId
      })
    } catch (reason) {
      if (signal?.aborted === true) return
      setHost(undefined)
      setAppError(`无法连接本地 Harness Host：${errorText(reason)}`)
    } finally {
      if (signal?.aborted !== true) setChromeLoading(false)
    }
  }, [deletedSessionIds, hiddenSidechatSessionIds, pendingSession, resumeLastSession])

  const refreshChrome = useCallback((signal?: AbortSignal): Promise<void> => {
    if (signal !== undefined) return refreshChromeNow(signal)
    return chromeRefreshes.current.run('chrome', () => refreshChromeNow())
  }, [refreshChromeNow])

  const refreshSessionNow = useCallback(async (
    sessionId: string,
    options: { includeModels?: boolean; signal?: AbortSignal; showLoading?: boolean } = {},
  ): Promise<void> => {
    const generation = ++historyGeneration.current
    if (options.showLoading === true) setHistoryLoading(true)
    try {
      const target = subagentView?.parentSessionId === sessionId ? subagentView : undefined
      const historyPromise = target === undefined
        ? harnessApi.history(sessionId, options.signal)
        : harnessApi.subagentHistory({
            parentSessionId: target.parentSessionId,
            childSessionId: target.childSessionId,
            mode: target.mode,
          }, options.signal)
      const modelsPromise = target === undefined && options.includeModels === true
        ? harnessApi.models(sessionId, options.signal).catch(() => undefined)
        : Promise.resolve(undefined)
      const [nextHistory, nextModels] = await Promise.all([historyPromise, modelsPromise])
      if (generation !== historyGeneration.current || selectedRef.current !== sessionId) return
      const mergedHistory = mergeHistoryTail(historyRef.current, nextHistory)
      historyRef.current = mergedHistory
      setHistory(mergedHistory)
      if (nextModels !== undefined) setModels(nextModels)
      setActionError(undefined)
    } catch (reason) {
      if (options.signal?.aborted === true || generation !== historyGeneration.current) return
      setActionError(`会话刷新失败：${errorText(reason)}`)
    } finally {
      if (generation === historyGeneration.current && options.signal?.aborted !== true) setHistoryLoading(false)
    }
  }, [subagentView])

  const refreshSession = useCallback((
    sessionId: string,
    options: { includeModels?: boolean; signal?: AbortSignal; showLoading?: boolean } = {},
  ): Promise<void> => {
    if (options.signal !== undefined || options.includeModels === true || options.showLoading === true) {
      return refreshSessionNow(sessionId, options)
    }
    const target = subagentView?.parentSessionId === sessionId ? subagentView.childSessionId : sessionId
    return historyRefreshes.current.run(target, () => refreshSessionNow(sessionId, options))
  }, [refreshSessionNow, subagentView])

  const refreshPlugins = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setPluginsLoading(true)
    try {
      setPlugins(await harnessApi.plugins(signal))
      setPluginError(undefined)
    } catch (reason) {
      if (signal?.aborted === true) return
      setPluginError(`插件清单读取失败：${errorText(reason)}`)
    } finally {
      if (signal?.aborted !== true) setPluginsLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refreshChrome(controller.signal)
    return () => controller.abort()
  }, [refreshChrome])

  useEffect(() => {
    setSubagentView(current => current?.parentSessionId === selectedId ? current : undefined)
    historyRef.current = EMPTY_HISTORY
    setHistory(EMPTY_HISTORY)
    if (pendingSession === undefined) setModels(undefined)
    setSkills([])
    setSubagents(undefined)
    setActionError(undefined)
    if (selectedId === undefined) return
    const controller = new AbortController()
    void refreshSession(selectedId, { includeModels: true, signal: controller.signal, showLoading: true })
    void Promise.allSettled([
      harnessApi.skills(selectedId, controller.signal),
      harnessApi.subagents(selectedId, controller.signal),
    ]).then(([skillsResult, subagentsResult]) => {
      if (controller.signal.aborted || selectedRef.current !== selectedId) return
      if (skillsResult.status === 'fulfilled') setSkills(skillsResult.value.skills)
      if (subagentsResult.status === 'fulfilled') setSubagents(subagentsResult.value)
    })
    return () => controller.abort()
  }, [pendingSession, refreshSession, selectedId, subagentView])

  useEffect(() => {
    let chromeTimer: ReturnType<typeof setTimeout> | undefined
    let historyTimer: ReturnType<typeof setTimeout> | undefined
    let liveTimer: ReturnType<typeof setTimeout> | undefined
    const liveEntries: HistoryEntry[] = []

    const scheduleChromeRefresh = (): void => {
      if (chromeTimer !== undefined) clearTimeout(chromeTimer)
      chromeTimer = setTimeout(() => { void refreshChrome() }, 160)
    }

    const scheduleHistoryRepair = (): void => {
      if (historyTimer !== undefined) return
      historyTimer = setTimeout(() => {
        historyTimer = undefined
        const current = selectedRef.current
        if (current !== undefined) void refreshSession(current)
      }, 180)
    }

    const flushLiveEntries = (): void => {
      liveTimer = undefined
      if (liveEntries.length === 0) return
      const batch = liveEntries.splice(0)
      const result = appendLiveHistory(historyRef.current, batch)
      if (result.page !== historyRef.current) {
        historyRef.current = result.page
        setHistory(result.page)
      }
      if (result.gap) scheduleHistoryRepair()
    }

    const queueLiveEntry = (entry: HistoryEntry): void => {
      liveEntries.push(entry)
      if (liveTimer !== undefined) return
      liveTimer = setTimeout(flushLiveEntries, 48)
    }

    const dispose = subscribeDownlinks((frame) => {
      const sessionId = frameSessionId(frame)
      const ownerSessionId = subagentView?.childSessionId ?? selectedRef.current
      let historyHandled = false
      if (frame['type'] === 'approval/requested' && typeof frame.__rpcId === 'string'
        && typeof sessionId === 'string' && typeof frame['approvalId'] === 'string' && typeof frame['toolName'] === 'string') {
        historyHandled = true
        setPendingApprovals(current => current.some(item => item.rpcId === frame.__rpcId)
          ? current
          : [...current, {
              rpcId: frame.__rpcId as string,
              sessionId,
              approvalId: frame['approvalId'] as string,
              toolName: frame['toolName'] as string,
              ...(typeof frame['callId'] === 'string' ? { callId: frame['callId'] as string } : {}),
              ...(typeof frame['reason'] === 'string' ? { reason: frame['reason'] as string } : {}),
            }])
      }
      if (frame['type'] === 'approval/resolved' && typeof frame['approvalId'] === 'string') {
        historyHandled = true
        setPendingApprovals(current => current.filter(item => item.approvalId !== frame['approvalId']))
      }
      if (frame['type'] === 'question/requested' && typeof frame.__rpcId === 'string'
        && typeof sessionId === 'string' && Array.isArray(frame['questions'])) {
        historyHandled = true
        setPendingQuestions(current => current.some(item => item.rpcId === frame.__rpcId)
          ? current
          : [...current, { rpcId: frame.__rpcId as string, sessionId, questions: frame['questions'] as QuestionRequest['questions'] }])
      }
      if (frame['type'] === 'question/resolved' && typeof frame['questionRpcId'] === 'string') {
        historyHandled = true
        setPendingQuestions(current => current.filter(item => item.rpcId !== frame['questionRpcId']))
      }
      if (frame['type'] === 'session/jobs' && typeof sessionId === 'string' && Array.isArray(frame['jobs'])) {
        historyHandled = true
        const jobs = frame['jobs'].flatMap(item => {
          if (typeof item !== 'object' || item === null) return []
          const row = item as Record<string, unknown>
          const status = row['status']
          if (typeof row['id'] !== 'string' || typeof row['kind'] !== 'string' || typeof row['label'] !== 'string'
            || (status !== 'running' && status !== 'stopping' && status !== 'completed' && status !== 'killed' && status !== 'failed')
            || typeof row['startedAt'] !== 'number') return []
          return [{
            id: row['id'],
            kind: row['kind'],
            label: row['label'],
            status,
            startedAt: row['startedAt'],
            ...(typeof row['detail'] === 'string' ? { detail: row['detail'] } : {}),
            ...(typeof row['finishedAt'] === 'number' ? { finishedAt: row['finishedAt'] } : {}),
          } satisfies JobView]
        })
        setJobsBySession(current => ({ ...current, [sessionId]: jobs }))
      }
      const queue = projectQueue(frame)
      if (sessionId !== undefined && queue !== undefined) {
        historyHandled = true
        setQueueBySession(current => ({ ...current, [sessionId]: queue }))
      }

      const liveEntry = liveHistoryEntry(frame)
      if (liveEntry !== undefined) {
        historyHandled = true
        if (sessionId === ownerSessionId) queueLiveEntry(liveEntry)
      }

      if (frame['type'] === 'session/projection') {
        historyHandled = true
        if (sessionId === ownerSessionId && typeof frame['key'] === 'string' && typeof frame['seq'] === 'number') {
          const next = applyLiveProjection(historyRef.current, frame['key'], frame['value'], frame['seq'])
          if (next !== historyRef.current) {
            historyRef.current = next
            setHistory(next)
          }
        }
      }

      if (frame['type'] === 'session/subscribed') {
        historyHandled = true
        const tailSeq = historyRef.current.events.at(-1)?.event.seq
        if (sessionId === ownerSessionId && tailSeq !== undefined
          && typeof frame['lastSeq'] === 'number' && frame['lastSeq'] > tailSeq) {
          scheduleHistoryRepair()
        }
      }

      scheduleChromeRefresh()
      if (!historyHandled && sessionId === ownerSessionId) scheduleHistoryRepair()
    }, setConnection)
    const poll = setInterval(() => { void refreshChrome() }, 4_000)
    return () => {
      if (chromeTimer !== undefined) clearTimeout(chromeTimer)
      if (historyTimer !== undefined) clearTimeout(historyTimer)
      if (liveTimer !== undefined) clearTimeout(liveTimer)
      clearInterval(poll)
      dispose()
    }
  }, [refreshChrome, refreshSession, subagentView?.childSessionId])

  useEffect(() => {
    const running = subagentView !== undefined
      ? activeSubagent?.activity === 'running'
      : selected?.running === true
    if (selectedId === undefined || !running) return
    const poll = setInterval(() => { void refreshSession(selectedId) }, connection === 'connected' ? 12_000 : 1_000)
    return () => clearInterval(poll)
  }, [activeSubagent?.activity, connection, refreshSession, selected?.running, selectedId, subagentView])

  useEffect(() => {
    if (!pluginsOpen && !settingsOpen) return
    const controller = new AbortController()
    void refreshPlugins(controller.signal)
    const poll = setInterval(() => { void refreshPlugins() }, 3_000)
    return () => {
      controller.abort()
      clearInterval(poll)
    }
  }, [pluginsOpen, refreshPlugins, settingsOpen])

  const beginPendingSession = useCallback((workspace = selectedWorkspace ?? pendingWorkspace ?? workspaces[0], agentPreset?: string): string => {
    const owner = workspace?.workspaceId ?? workspace?.path ?? host?.cwd ?? 'local'
    const key = `pending:${owner}:${agentPreset ?? 'default'}`
    setPendingSession({
      key,
      ...(workspace === undefined ? { cwd: host?.cwd } : { workspaceId: workspace.workspaceId }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
    })
    setSelectedId(undefined)
    selectedRef.current = undefined
    setSubagentView(undefined)
    setPendingHostPermission(DEFAULT_HOST_PERMISSION)
    setActionError(undefined)
    return key
  }, [host?.cwd, pendingWorkspace, selectedWorkspace, workspaces])

  const createSession = useCallback(async (agentPreset?: string): Promise<string> => {
    const workspace = pendingWorkspace ?? selectedWorkspace ?? workspaces[0]
    const resolvedPreset = agentPreset ?? pendingSession?.agentPreset
    const result = await harnessApi.createSession(
      {
        ...(workspace === undefined ? { cwd: pendingSession?.cwd ?? host?.cwd } : { workspaceId: workspace.workspaceId }),
        ...(resolvedPreset === undefined ? {} : { agentPreset: resolvedPreset }),
      },
    )
    if (pendingSession !== undefined) {
      setPendingTurns(current => {
        const candidate = current[pendingSession.key]
        if (candidate === undefined) return current
        const { [pendingSession.key]: _pendingTurn, ...rest } = current
        return { ...rest, [result.sessionId]: { ...candidate, owner: result.sessionId } }
      })
      setDrafts(current => {
        const text = current[pendingSession.key]
        const { [pendingSession.key]: _pendingDraft, ...rest } = current
        return text === undefined ? rest : { ...rest, [result.sessionId]: text }
      })
      const pendingCodex = readCodexSession(pendingSession.key)
      writeCodexSession(result.sessionId, pendingCodex)
      localStorage.removeItem(codexSessionKey(pendingSession.key))
      setCodexSession(pendingCodex)
    }
    setPendingSession(undefined)
    setSelectedId(result.sessionId)
    selectedRef.current = result.sessionId
    await refreshChrome()
    return result.sessionId
  }, [host?.cwd, pendingSession, pendingWorkspace, refreshChrome, selectedWorkspace, workspaces])

  const handleNew = (): void => {
    if (busy) return
    beginPendingSession()
  }

  const handleSearch = useCallback(async (query: string): Promise<void> => {
    const generation = ++searchGeneration.current
    if (query === '') {
      setSearchHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    try {
      const result = await harnessApi.searchSessions(query)
      if (generation === searchGeneration.current) setSearchHits(result.items)
    } catch {
      if (generation === searchGeneration.current) setSearchHits([])
    } finally {
      if (generation === searchGeneration.current) setSearching(false)
    }
  }, [])

  const releaseAttachments = useCallback((items: PendingAttachment[]): void => {
    items.forEach(item => URL.revokeObjectURL(item.previewUrl))
  }, [])

  const handleAddFiles = useCallback(async (files: File[]): Promise<void> => {
    if (codexActive) {
      setActionError('Codex CLI 当前只接受文本输入；图片请切回 DeepSeek Host。')
      return
    }
    const limits = projectionValues?.imageLimits
    const accepted: PendingAttachment[] = []
    let totalBytes = attachments.reduce((sum, item) => sum + item.bytes, 0)
    for (const file of files) {
      const mediaType = imageMediaType(file)
      if (mediaType === undefined) continue
      if (limits !== undefined && !limits.mediaTypes.includes(mediaType)) {
        setActionError(`Host 不支持 ${mediaType} 图片。`)
        continue
      }
      if (limits !== undefined && file.size > limits.maxImageBytes) {
        setActionError(`图片 ${file.name} 超过 Host 单图大小限制。`)
        continue
      }
      if (limits !== undefined && attachments.length + accepted.length >= limits.maxImagesPerMessage) {
        setActionError(`一条消息最多附加 ${limits.maxImagesPerMessage} 张图片。`)
        break
      }
      if (limits !== undefined && totalBytes + file.size > limits.maxMessageImageBytes) {
        setActionError('本条消息的图片总大小超过 Host 限制。')
        break
      }
      try {
        accepted.push({
          type: 'image',
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name || 'image',
          mediaType,
          data: await base64Of(file),
          previewUrl: URL.createObjectURL(file),
          bytes: file.size,
        })
        totalBytes += file.size
      } catch (reason) {
        setActionError(`读取图片失败：${errorText(reason)}`)
      }
    }
    if (accepted.length > 0) {
      setAttachments(current => [...current, ...accepted])
      setActionError(undefined)
    }
  }, [attachments, codexActive, projectionValues?.imageLimits])

  const handleRemoveAttachment = useCallback((id: string): void => {
    setAttachments(current => {
      const removed = current.find(item => item.id === id)
      if (removed !== undefined) URL.revokeObjectURL(removed.previewUrl)
      return current.filter(item => item.id !== id)
    })
  }, [])

  const handleApproval = useCallback(async (request: ApprovalRequest, outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    try {
      if (request.source === 'codex' && request.codexRequestId !== undefined) {
        await codexApi.respondApproval(request.codexRequestId, outcome === 'allowed-once')
        setPendingApprovals(current => current.filter(item => item.rpcId !== request.rpcId))
        return
      }
      const receipt = await harnessApi.respond(request.rpcId, {
        ok: true,
        value: { sessionId: request.sessionId, approvalId: request.approvalId, outcome },
      })
      if (!receipt.accepted) throw new Error(receipt.reason ?? 'Host rejected the approval response')
      setPendingApprovals(current => current.filter(item => item.rpcId !== request.rpcId))
    } catch (reason) {
      setActionError(`审批响应失败：${errorText(reason)}`)
    }
  }, [])

  const handleQuestion = useCallback(async (request: QuestionRequest, answers: QuestionAnswer[]): Promise<void> => {
    try {
      const receipt = await harnessApi.respond(request.rpcId, {
        ok: true,
        value: { sessionId: request.sessionId, answer: { answers } },
      })
      if (!receipt.accepted) throw new Error(receipt.reason ?? 'Host rejected the question response')
      setPendingQuestions(current => current.filter(item => item.rpcId !== request.rpcId))
    } catch (reason) {
      setActionError(`问题响应失败：${errorText(reason)}`)
    }
  }, [])

  const handleNewSidechat = (): void => {
    if (selectedId === undefined || sidechatThreads.length >= 24) return
    const id = `chat-${crypto.randomUUID()}`
    const nextThread: SidechatThreadSummary = { id, title: `Sidechat ${sidechatThreads.length + 1}` }
    setSidechatThreadsByParent(current => ({
      ...current,
      [selectedId]: [...sidechatThreads, nextThread],
    }))
    setActiveSidechatByParent(current => ({ ...current, [selectedId]: id }))
  }

  const handleSelectSidechat = (threadId: string): void => {
    if (selectedId === undefined || !sidechatThreads.some(thread => thread.id === threadId)) return
    setActiveSidechatByParent(current => ({ ...current, [selectedId]: threadId }))
  }

  const nameActiveSidechat = (text: string): void => {
    if (selectedId === undefined || activeSidechat === undefined || !/^Sidechat \d+$/.test(activeSidechat.title)) return
    const title = text.replace(/\s+/g, ' ').trim().slice(0, 34)
    if (title === '') return
    setSidechatThreadsByParent(current => ({
      ...current,
      [selectedId]: (current[selectedId] ?? sidechatThreads).map(thread => thread.id === activeSidechat.id ? { ...thread, title } : thread),
    }))
  }

  const handleSidechatModel = (provider: string, model: string): void => {
    if (sidechatOwner === undefined || presentedModels === undefined) return
    const entry = presentedModels.groups.find(group => group.id === provider)?.models.find(item => item.id === model)
    if (entry === undefined) return
    const previousEffort = sidechatSelection?.provider === provider ? sidechatSelection.effort : undefined
    const efforts = entry.reasoning?.efforts ?? []
    const effort = previousEffort !== undefined && efforts.some(item => item.id === previousEffort)
      ? previousEffort
      : entry.reasoning?.defaultEffort
    const previousPermission = sidechatSelection?.provider === provider ? sidechatSelection.permission : undefined
    const next: SidechatSelection = {
      provider,
      model,
      ...(effort === undefined ? {} : { effort }),
      permission: previousPermission
        ?? (provider === CODEX_PROVIDER ? DEFAULT_CODEX_PERMISSION : presentedPermission ?? DEFAULT_HOST_PERMISSION),
    }
    writeSidechatSelection(sidechatOwner, next)
    setSidechatSelection(next)
  }

  const handleSidechatEffort = (effort: string): void => {
    if (sidechatOwner === undefined || sidechatSelection === undefined) return
    if (sidechatModelEntry?.reasoning?.efforts.some(item => item.id === effort) !== true) return
    const next = { ...sidechatSelection, effort }
    writeSidechatSelection(sidechatOwner, next)
    setSidechatSelection(next)
  }

  const handleSidechatPermission = (permission: string): void => {
    if (sidechatOwner === undefined || sidechatSelection === undefined) return
    if (!sidechatPermissionOptions.some(option => option.value === permission)) return
    if ((permission === 'full-access' || permission === 'danger-full-access')
      && !window.confirm('Full access removes approval or workspace sandbox restrictions for future sidechat turns. Continue?')) return
    const next = { ...sidechatSelection, permission }
    writeSidechatSelection(sidechatOwner, next)
    setSidechatSelection(next)
  }

  const handleSidechatSend = async (text: string): Promise<void> => {
    if (selectedId === undefined || sidechatOwner === undefined || sidechatRunning || sidechatSelection === undefined) return
    const generation = ++sidechatGeneration.current
    const optimistic: ConversationMessage = {
      id: `sidechat-user-${Date.now()}`,
      seq: (sidechatMessages.at(-1)?.seq ?? 0) + 1,
      time: Date.now(),
      role: 'user',
      blocks: [{ kind: 'text', text }],
    }
    setSidechatMessages(current => [...current, optimistic])
    nameActiveSidechat(text)
    setSidechatRunning(true)
    setSidechatError(undefined)
    try {
      const cwd = activeWorkspace?.path ?? selected?.cwd ?? host?.cwd
      if (cwd === undefined) throw new Error('This session has no working directory')
      const handoff = collectProviderHandoff(activeMessages)
      if (sidechatCodexActive) {
        if (sidechatSelection.provider !== CODEX_PROVIDER || sidechatSelection.effort === undefined) throw new Error('Codex model metadata is unavailable')
        const state = readCodexSession(sidechatOwner)
        const result = await codexApi.prompt({
          sessionId: sidechatOwner,
          ...(state.threadId === undefined ? {} : { threadId: state.threadId }),
          cwd,
          model: sidechatSelection.model,
          effort: sidechatSelection.effort,
          permission: sidechatSelection.permission,
          prompt: text,
          ...(state.threadId === undefined ? { context: handoff.messages } : {}),
        })
        const next: CodexSessionState = {
          ...state,
          active: true,
          threadId: result.threadId,
          model: sidechatSelection.model,
          effort: sidechatSelection.effort,
          permission: sidechatSelection.permission as CodexPermissionMode,
        }
        writeCodexSession(sidechatOwner, next)
        setSidechatTurnId(result.turnId)
        return
      }

      let hostSessionId = sidechatHostSessionId
      let created = false
      if (hostSessionId === undefined) {
        const result = await harnessApi.createSession({
          ...(selectedWorkspace === undefined ? { cwd } : { workspaceId: selectedWorkspace.workspaceId }),
          ...(selected?.agentPreset === undefined ? {} : { agentPreset: selected.agentPreset }),
        })
        hostSessionId = result.sessionId
        created = true
        const next = { ...sidechatHostSessions, [sidechatOwner]: hostSessionId }
        localStorage.setItem(SIDECHAT_HOST_STORAGE_KEY, JSON.stringify(next))
        setSidechatHostSessions(next)
        await harnessApi.renameSession(hostSessionId, `${text.replace(/\s+/g, ' ').trim().slice(0, 34) || activeSidechat?.title || 'Sidechat'} · ${titleOf(selected)}`).catch(() => undefined)
      }
      await harnessApi.selectModel(hostSessionId, sidechatSelection.provider, sidechatSelection.model, sidechatSelection.effort)
      if (sidechatSelection.permission !== DEFAULT_HOST_PERMISSION) await harnessApi.setPermission(hostSessionId, sidechatSelection.permission)
      const baselineAssistantCount = sidechatMessages.filter(message => message.role === 'assistant').length
      const content: PromptContentPart[] = [
        ...(created && handoff.messages.length > 0
          ? [{ type: 'text' as const, text: providerHandoffText(codexActive ? 'Codex' : 'DeepSeek', handoff) }]
          : []),
        { type: 'text', text },
      ]
      await harnessApi.prompt(hostSessionId, content)
      let observedAnswer = false
      for (let attempt = 0; attempt < 300 && generation === sidechatGeneration.current; attempt += 1) {
        await wait(attempt === 0 ? 180 : 620)
        const [page, list] = await Promise.all([harnessApi.history(hostSessionId), harnessApi.sessions()])
        if (generation !== sidechatGeneration.current) return
        const projected = projectConversation(page.events)
        observedAnswer ||= projected.filter(message => message.role === 'assistant').length > baselineAssistantCount
        const running = list.items.find(item => item.sessionId === hostSessionId)?.running === true
        setSidechatMessages(projected)
        setSidechatRunning(running || !observedAnswer)
        if (observedAnswer && !running) break
      }
      if (generation === sidechatGeneration.current) setSidechatRunning(false)
    } catch (reason) {
      if (generation !== sidechatGeneration.current) return
      setSidechatRunning(false)
      setSidechatTurnId(undefined)
      setSidechatError(errorText(reason))
    }
  }

  const handleSidechatStop = async (): Promise<void> => {
    if (sidechatOwner === undefined || !sidechatRunning) return
    try {
      if (sidechatCodexActive) {
        const state = readCodexSession(sidechatOwner)
        if (state.threadId !== undefined && sidechatTurnId !== undefined) {
          await codexApi.interrupt(state.threadId, sidechatTurnId)
        }
      } else if (sidechatHostSessionId !== undefined) {
        await harnessApi.cancel(sidechatHostSessionId)
        const page = await harnessApi.history(sidechatHostSessionId)
        setSidechatMessages(projectConversation(page.events))
      }
    } catch (reason) {
      setSidechatError(errorText(reason))
    } finally {
      setSidechatRunning(false)
      setSidechatTurnId(undefined)
    }
  }

  const handleCreatorPresetDraft = async (): Promise<void> => {
    if (busy) return
    setSettingsOpen(false)
    setActionError(undefined)
    const key = beginPendingSession(undefined, 'cordis')
    setDrafts(current => ({ ...current, [key]: current[key] ?? 'Help me create a custom DeepSeek Harness agent preset for ' }))
  }

  const handleSend = async (): Promise<void> => {
    const prompt = draft.trim()
    if ((prompt === '' && attachments.length === 0) || busy) return
    const tailBeforeSend = historyRef.current.events.at(-1)?.event.seq
    const sourceDraftKey = draftKey
    const sourceOwner = subagentView?.childSessionId ?? selectedId ?? sourceDraftKey
    const submittedAttachments = attachments
    const wasPending = pendingSession !== undefined
    const pendingModel = presentedModels?.current
    const pendingPermission = wasPending ? pendingHostPermission : undefined
    const transition = codexActive
      ? undefined
      : createPendingTurn(sourceOwner, prompt, submittedAttachments, tailBeforeSend ?? -1)
    setConversationScrollRequest(current => current + 1)
    let restoreDraftKey = sourceDraftKey
    if (transition !== undefined) {
      setPendingTurns(current => ({ ...current, [sourceOwner]: transition }))
      setDrafts(current => {
        const { [sourceDraftKey]: _submitted, ...rest } = current
        return rest
      })
      setAttachments([])
    }
    setBusy(true)
    setActionError(undefined)
    try {
      const sessionId = selectedId ?? await createSession()
      if (wasPending) restoreDraftKey = sessionId
      if (transition !== undefined) {
        const targetOwner = subagentView?.childSessionId ?? sessionId
        if (targetOwner !== sourceOwner) {
          setPendingTurns(current => {
            const candidate = current[sourceOwner]
            if (candidate?.id !== transition.id) return current
            const { [sourceOwner]: _source, ...rest } = current
            return { ...rest, [targetOwner]: { ...candidate, owner: targetOwner } }
          })
        }
      }
      if (codexActive) {
        if (attachments.length > 0) throw new Error('Codex CLI 当前只接受文本输入')
        const current = presentedModels?.current
        const cwd = activeWorkspace?.path ?? pendingSession?.cwd ?? selected?.cwd ?? host?.cwd
        if (current === undefined || cwd === undefined) throw new Error('Codex model or work folder is unavailable')
        const optimisticId = `codex-user-${Date.now()}`
        setCodexMessages(messages => [...messages, {
          id: optimisticId,
          seq: (messages.at(-1)?.seq ?? 0) + 1,
          time: Date.now(),
          role: 'user',
          blocks: [{ kind: 'text', text: prompt }],
        }])
        setCodexRunning(true)
        const handoff = collectProviderHandoff(retainedDeepSeekMessages, codexSession.codexImportedHostSeq ?? 0)
        const result = await codexApi.prompt({
          sessionId,
          ...(codexSession.threadId === undefined ? {} : { threadId: codexSession.threadId }),
          cwd,
          model: current.model,
          effort: current.reasoningEffort ?? 'medium',
          permission: codexPermission,
          prompt,
          context: handoff.messages,
        })
        const next = {
          ...codexSession,
          active: true,
          threadId: result.threadId,
          model: current.model,
          effort: current.reasoningEffort ?? 'medium',
          permission: codexPermission,
          ...(handoff.throughSeq === undefined ? {} : { codexImportedHostSeq: handoff.throughSeq }),
        }
        setCodexSession(next)
        writeCodexSession(sessionId, next)
        setCodexTurnId(result.turnId)
        setDrafts(current => {
          const nextDrafts = { ...current }
          delete nextDrafts[sourceDraftKey]
          delete nextDrafts[sessionId]
          return nextDrafts
        })
        return
      }
      if (wasPending && pendingModel !== undefined && pendingModel.provider !== CODEX_PROVIDER) {
        await harnessApi.selectModel(sessionId, pendingModel.provider, pendingModel.model, pendingModel.reasoningEffort)
      }
      if (pendingPermission !== undefined) {
        await harnessApi.setPermission(sessionId, pendingPermission)
      }
      if (subagentView !== undefined) {
        if (subagentView.mode !== 'continuable') throw new Error('One-shot subagent 不能继续发送消息')
        if (attachments.length > 0) throw new Error('子代理会话暂不支持图片')
        await harnessApi.subagentPrompt({ parentSessionId: sessionId, childSessionId: subagentView.childSessionId, text: prompt })
      } else {
        const handoff = collectProviderHandoff(retainedCodexMessages, codexSession.deepSeekImportedCodexSeq ?? 0)
        const content: PromptContentPart[] = [
          ...(handoff.messages.length === 0
            ? []
            : [{ type: 'text' as const, text: providerHandoffText('Codex', handoff) }]),
          ...(prompt === '' ? [] : [{ type: 'text' as const, text: prompt }]),
          ...attachments.map(item => ({ type: 'image' as const, mediaType: item.mediaType, data: item.data, name: item.name })),
        ]
        await harnessApi.prompt(sessionId, content)
        if (handoff.throughSeq !== undefined) {
          const next = { ...codexSession, active: false, deepSeekImportedCodexSeq: handoff.throughSeq }
          setCodexSession(next)
          writeCodexSession(sessionId, next)
        }
      }
      releaseAttachments(submittedAttachments)
      const submittedIds = new Set(submittedAttachments.map(item => item.id))
      setAttachments(current => current.filter(item => !submittedIds.has(item.id)))
      void refreshChrome()
      window.setTimeout(() => {
        if (selectedRef.current !== sessionId) return
        const tailAfterSend = historyRef.current.events.at(-1)?.event.seq
        const liveEventLanded = tailBeforeSend === undefined
          ? tailAfterSend !== undefined
          : tailAfterSend !== undefined && tailAfterSend > tailBeforeSend
        if (!liveEventLanded) void refreshSession(sessionId)
      }, 700)
    } catch (reason) {
      if (codexActive) {
        setCodexRunning(false)
        setCodexTurnId(undefined)
      }
      if (transition !== undefined) {
        setPendingTurns(current => Object.fromEntries(
          Object.entries(current).filter(([, item]) => item.id !== transition.id),
        ))
        if (prompt !== '') {
          setDrafts(current => {
            const currentDraft = current[restoreDraftKey] ?? ''
            const restored = currentDraft === '' ? prompt : `${prompt}\n\n${currentDraft}`
            return { ...current, [restoreDraftKey]: restored }
          })
        }
        setAttachments(current => {
          const existing = new Set(current.map(item => item.id))
          return [...submittedAttachments.filter(item => !existing.has(item.id)), ...current]
        })
      }
      setActionError(`发送失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleStop = async (): Promise<void> => {
    if (selectedId === undefined || busy) return
    setBusy(true)
    setActionError(undefined)
    try {
      if (codexRunning && codexSession.threadId !== undefined && codexTurnId !== undefined) {
        await codexApi.interrupt(codexSession.threadId, codexTurnId)
        return
      }
      if (subagentView !== undefined) {
        await harnessApi.subagentInterrupt(selectedId, subagentView.childSessionId)
      } else {
        await harnessApi.cancel(selectedId)
      }
      await Promise.all([refreshChrome(), refreshSession(selectedId)])
    } catch (reason) {
      setActionError(`停止失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleModel = async (provider: string, model: string): Promise<void> => {
    const stateKey = selectedId ?? pendingSession?.key
    if (stateKey === undefined || presentedModels === undefined || busy || subagentView !== undefined) return
    const modelEntry = presentedModels.groups.find(group => group.id === provider)?.models.find(entry => entry.id === model)
    const currentEffort = provider === CODEX_PROVIDER
      ? codexSession.effort
      : models?.current.reasoningEffort
    const efforts = modelEntry?.reasoning?.efforts ?? []
    const effort = currentEffort !== undefined && efforts.some(candidate => candidate.id === currentEffort)
      ? currentEffort
      : modelEntry?.reasoning?.defaultEffort
    setBusy(true)
    try {
      if (provider === CODEX_PROVIDER) {
        if (modelEntry === undefined || effort === undefined) throw new Error('Codex model metadata is unavailable')
        const next = { ...codexSession, active: true, model, effort, permission: codexPermission }
        setCodexSession(next)
        writeCodexSession(stateKey, next)
        setActionError(undefined)
        return
      }
      if (selectedId === undefined) {
        setModels(current => current === undefined ? current : {
          ...current,
          current: { provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) },
        })
        const next = { ...codexSession, active: false }
        setCodexSession(next)
        writeCodexSession(stateKey, next)
        setActionError(undefined)
        return
      }
      await harnessApi.selectModel(selectedId, provider, model, effort)
      setModels(await harnessApi.models(selectedId))
      const next = { ...codexSession, active: false }
      setCodexSession(next)
      writeCodexSession(selectedId, next)
      await refreshChrome()
    } catch (reason) {
      setActionError(`模型切换失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleEffort = async (effort: string): Promise<void> => {
    const stateKey = selectedId ?? pendingSession?.key
    if (stateKey === undefined || presentedModels === undefined || busy || subagentView !== undefined) return
    setBusy(true)
    try {
      if (codexActive) {
        const model = codexCatalog.models.find(candidate => candidate.id === presentedModels.current.model)
        if (model === undefined || !model.efforts.some(candidate => candidate.id === effort)) {
          throw new Error('This Codex model does not support the selected reasoning effort')
        }
        const next = { ...codexSession, active: true, model: model.id, effort }
        setCodexSession(next)
        writeCodexSession(stateKey, next)
        setActionError(undefined)
        return
      }
      if (selectedId === undefined) {
        setModels(current => current === undefined ? current : {
          ...current,
          current: { ...current.current, reasoningEffort: effort },
        })
        setActionError(undefined)
        return
      }
      await harnessApi.selectModel(
        selectedId,
        presentedModels.current.provider,
        presentedModels.current.model,
        effort,
      )
      setModels(await harnessApi.models(selectedId))
    } catch (reason) {
      setActionError(`推理强度切换失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handlePermission = async (preset: string): Promise<void> => {
    const stateKey = selectedId ?? pendingSession?.key
    if (stateKey === undefined || busy || subagentView !== undefined) return
    if (codexActive) {
      if (preset !== 'ask-for-approval' && preset !== 'approve-for-me' && preset !== 'full-access') return
      if (preset === codexPermission) return
      if (preset === 'full-access' && !window.confirm('Full access disables Codex approval prompts and filesystem sandboxing. Continue?')) return
      const permission = preset as CodexPermissionMode
      const next = { ...codexSession, active: true, permission }
      setCodexSession(next)
      writeCodexSession(stateKey, next)
      setActionError(undefined)
      return
    }
    if (!presentedPermissionOptions.some(option => option.value === preset)) return
    if (selectedId === undefined) {
      if (preset === pendingHostPermission) return
      if (preset === 'danger-full-access' && !window.confirm('切换到 Full access 会取消文件沙箱限制。确定继续吗？')) return
      setPendingHostPermission(preset)
      setActionError(undefined)
      return
    }
    if (preset === permissions?.currentValue) return
    if (preset === 'danger-full-access' && !window.confirm('切换到 danger-full-access 会取消文件沙箱限制。确定继续吗？')) return
    setBusy(true)
    try {
      await harnessApi.setPermission(selectedId, preset)
      await Promise.all([refreshChrome(), refreshSession(selectedId)])
    } catch (reason) {
      setActionError(`权限切换失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleExitPlan = async (): Promise<void> => {
    if (selectedId === undefined || busy || codexActive || subagentView !== undefined) return
    setBusy(true)
    try {
      await harnessApi.prompt(selectedId, [{ type: 'text', text: '/plan off' }])
      await Promise.all([refreshChrome(), refreshSession(selectedId)])
    } catch (reason) {
      setActionError(`退出计划模式失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handlePluginToggle = async (entry: PluginEntry, enabled: boolean): Promise<void> => {
    if (pluginChangingId !== undefined || !entry.controllable) return
    setPluginChangingId(entry.entryId)
    setPluginError(undefined)
    setPluginBackup(undefined)
    setPlugins(current => current === undefined ? current : {
      ...current,
      entries: current.entries.map(candidate => candidate.entryId === entry.entryId
        ? {
            ...candidate,
            enabled,
            fiberPhase: enabled ? 'loading' : 'unloading',
          }
        : candidate),
    })
    try {
      const result = await harnessApi.togglePlugin(entry.entryId, enabled)
      setPlugins(result.snapshot)
      setPluginBackup(result.backupFile)
    } catch (reason) {
      const message = errorText(reason)
      await refreshPlugins()
      setPluginError(message)
    } finally {
      setPluginChangingId(undefined)
    }
  }

  const handleWorkspace = async (workspace: WorkspaceSummary): Promise<void> => {
    if (busy) return
    setActionError(undefined)
    const existing = workspace.sessionIds
      .map(id => sessions.find(session => session.sessionId === id))
      .filter((session): session is SessionSummary => session !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (existing === undefined) beginPendingSession(workspace)
    else selectSession(existing.sessionId)
  }

  const handleRenameSession = async (session: SessionSummary = selected as SessionSummary): Promise<void> => {
    if (session === undefined || busy) return
    const nextTitle = window.prompt('Rename session', titleOf(session))?.trim()
    if (nextTitle === undefined || nextTitle === '' || nextTitle === titleOf(session)) return
    setBusy(true)
    try {
      await harnessApi.renameSession(session.sessionId, nextTitle)
      await refreshChrome()
      if (session.sessionId === selectedId) await refreshSession(session.sessionId)
    } catch (reason) {
      setActionError(`会话重命名失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleForkSession = async (session: SessionSummary = selected as SessionSummary): Promise<void> => {
    if (session === undefined || busy) return
    setBusy(true)
    try {
      const result = await harnessApi.forkSession(session.sessionId)
      setSubagentView(undefined)
      setSelectedId(result.sessionId)
      selectedRef.current = result.sessionId
      await refreshChrome()
    } catch (reason) {
      setActionError(`会话分叉失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleArchiveSession = async (session: SessionSummary = selected as SessionSummary): Promise<void> => {
    if (session === undefined || busy) return
    if (!window.confirm(`归档“${titleOf(session)}”？会话日志不会被删除。`)) return
    setBusy(true)
    try {
      await harnessApi.archiveSession(session.sessionId)
      setSubagentView(undefined)
      if (session.sessionId === selectedId) {
        setSelectedId(undefined)
        selectedRef.current = undefined
      }
      await refreshChrome()
    } catch (reason) {
      setActionError(`会话归档失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteSession = (session: SessionSummary): void => {
    if (session.running) {
      setActionError('运行中的会话不能删除，请先停止任务。')
      return
    }
    const confirmed = window.confirm(
      `从 DeepSeek Harness 删除“${titleOf(session)}”？\n\n`
      + '该会话会从本应用中移除。由于 Local Harness Host 没有公开删除接口，底层会话日志仍会保留在磁盘上。',
    )
    if (!confirmed) return
    setDeletedSessionIds(current => new Set(current).add(session.sessionId))
    setPinnedSessionIds(current => {
      if (!current.has(session.sessionId)) return current
      const next = new Set(current)
      next.delete(session.sessionId)
      return next
    })
    setUnreadSessionIds(current => {
      if (!current.has(session.sessionId)) return current
      const next = new Set(current)
      next.delete(session.sessionId)
      return next
    })
    localStorage.removeItem(codexSessionKey(session.sessionId))
    delete providerTranscriptCache.current[session.sessionId]
    if (session.sessionId === selectedId) {
      setSubagentView(undefined)
      setSelectedId(undefined)
      selectedRef.current = undefined
    }
    setActionError('会话已从 DeepSeek Harness 中删除；Host 原始日志仍保留。')
  }

  const handleOpenPath = async (path?: string): Promise<void> => {
    const target = path ?? activeWorkspace?.path ?? pendingSession?.cwd ?? selected?.cwd ?? host?.cwd
    if (target === undefined || busy) return
    setBusy(true)
    try {
      await harnessApi.openPath(target)
    } catch (reason) {
      setActionError(`打开路径失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleExportSession = async (): Promise<void> => {
    if (selected === undefined || busy || subagentView !== undefined) return
    const hasDescendants = subagents?.entries.some(entry => entry.kind === 'child') === true
    const includeDescendants = hasDescendants
      ? window.confirm('Export this session with all subagent logs? Choose Cancel for the current session only.')
      : false
    setBusy(true)
    try {
      const result = await harnessApi.exportSession(selected.sessionId, includeDescendants)
      if (!result.canceled) setActionError(`会话日志已导出：${result.path ?? result.filename ?? 'download started'}`)
    } catch (reason) {
      setActionError(`会话日志导出失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleSessionMenu = async (session: SessionSummary, extended = false): Promise<void> => {
    const desktop = window.dshDesktop
    if (desktop === undefined) {
      setActionError('Session actions are available in the desktop app.')
      return
    }
    const action = await desktop.showSessionMenu({
      pinned: pinnedSessionIds.has(session.sessionId),
      unread: unreadSessionIds.has(session.sessionId),
      archived: archivedSessionIds.includes(session.sessionId),
      running: session.running,
      ...(extended ? { extended: true } : {}),
    })
    if (action === null) return
    const workspace = workspaces.find(candidate => candidate.sessionIds.includes(session.sessionId))
    const directory = workspace?.path ?? session.cwd
    try {
      if (action === 'toggle-pin') {
        setPinnedSessionIds(current => {
          const next = new Set(current)
          if (next.has(session.sessionId)) next.delete(session.sessionId)
          else next.add(session.sessionId)
          return next
        })
      } else if (action === 'rename') {
        await handleRenameSession(session)
      } else if (action === 'archive') {
        await handleArchiveSession(session)
      } else if (action === 'delete') {
        handleDeleteSession(session)
      } else if (action === 'toggle-unread') {
        setUnreadSessionIds(current => {
          const next = new Set(current)
          if (next.has(session.sessionId)) next.delete(session.sessionId)
          else next.add(session.sessionId)
          return next
        })
      } else if (action === 'reveal') {
        if (directory === undefined) throw new Error('This session has no working directory')
        await desktop.revealPath(directory)
      } else if (action === 'copy-working-directory') {
        if (directory === undefined) throw new Error('This session has no working directory')
        await desktop.copyText(directory)
      } else if (action === 'copy-session-id') {
        await desktop.copyText(session.sessionId)
      } else if (action === 'copy-deeplink') {
        await desktop.copyText(await desktop.sessionDeeplink(session.sessionId))
      } else if (action === 'fork') {
        await handleForkSession(session)
      } else if (action === 'export') {
        await handleExportSession()
      } else if (action === 'open-new-window') {
        await desktop.openSessionWindow(session.sessionId)
      }
    } catch (reason) {
      setActionError(`会话操作失败：${errorText(reason)}`)
    }
  }

  const handleWorkspaceMenu = async (workspace: WorkspaceSummary): Promise<void> => {
    const desktop = window.dshDesktop
    if (desktop === undefined) {
      setActionError('Work-folder actions are available in the desktop app.')
      return
    }
    const action = await desktop.showWorkspaceMenu()
    if (action === null) return
    if (action === 'rename') {
      const title = window.prompt('Rename work folder', workspace.title)?.trim()
      if (title === undefined || title === '' || title === workspace.title) return
      setBusy(true)
      try {
        await harnessApi.renameWorkspace(workspace.workspaceId, title)
        await refreshChrome()
      } catch (reason) {
        setActionError(`工作区重命名失败：${errorText(reason)}`)
      } finally {
        setBusy(false)
      }
      return
    }
    if (action === 'remove') {
      if (!window.confirm(`移除工作区“${workspace.title}”？目录和会话日志不会被删除。`)) return
      setBusy(true)
      try {
        await harnessApi.deleteWorkspace(workspace.workspaceId)
        await refreshChrome()
      } catch (reason) {
        setActionError(`工作区移除失败：${errorText(reason)}`)
      } finally {
        setBusy(false)
      }
      return
    }
    try {
      if (action === 'reveal') {
        await desktop.revealPath(workspace.path)
      } else if (action === 'copy-working-directory') {
        await desktop.copyText(workspace.path)
      } else if (action === 'new-session') {
        beginPendingSession(workspace)
      } else if (action === 'open-new-window') {
        const sessionId = workspace.sessionIds
          .map(id => sessions.find(session => session.sessionId === id))
          .filter((session): session is SessionSummary => session !== undefined)
          .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.sessionId
          ?? (await harnessApi.createSession({ workspaceId: workspace.workspaceId })).sessionId
        await desktop.openSessionWindow(sessionId)
        await refreshChrome()
      }
    } catch (reason) {
      setActionError(`工作区操作失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleMoveWorkspace = async (workspaceId: string, beforeWorkspaceId?: string): Promise<void> => {
    if (busy || workspaceId === beforeWorkspaceId) return
    setBusy(true)
    try {
      await harnessApi.moveWorkspace(workspaceId, beforeWorkspaceId)
      await refreshChrome()
    } catch (reason) {
      setActionError(`工作区排序失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleMoveSession = async (workspaceId: string, sessionId: string, beforeSessionId?: string): Promise<void> => {
    if (busy || sessionId === beforeSessionId) return
    setBusy(true)
    try {
      await harnessApi.moveSession(workspaceId, sessionId, beforeSessionId)
      await refreshChrome()
    } catch (reason) {
      setActionError(`会话排序失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleLoadOlder = useCallback(async (): Promise<void> => {
    if (selectedId === undefined || historyLoadingOlder || !history.hasMore || history.events.length === 0) return
    const beforeSeq = history.events[0]?.event.seq
    if (beforeSeq === undefined) return
    setHistoryLoadingOlder(true)
    try {
      const page = subagentView === undefined
        ? await harnessApi.historyPage(selectedId, beforeSeq)
        : await harnessApi.subagentHistory({
            parentSessionId: subagentView.parentSessionId,
            childSessionId: subagentView.childSessionId,
            mode: subagentView.mode,
            beforeSeq,
          })
      if (selectedRef.current !== selectedId) return
      const current = historyRef.current
      const bySeq = new Map<number, typeof current.events[number]>()
      current.events.forEach(item => bySeq.set(item.event.seq, item))
      page.events.forEach(item => bySeq.set(item.event.seq, item))
      const next = {
        ...current,
        events: [...bySeq.values()].sort((left, right) => left.event.seq - right.event.seq),
        hasMore: page.hasMore,
      }
      historyRef.current = next
      setHistory(next)
    } catch (reason) {
      setActionError(`读取更早历史失败：${errorText(reason)}`)
    } finally {
      setHistoryLoadingOlder(false)
    }
  }, [history, historyLoadingOlder, selectedId, subagentView])

  const handleQueueAction = async (itemId: string, action: { kind: 'remove' | 'steer' } | { kind: 'edit'; text: string }): Promise<void> => {
    if (selectedId === undefined || subagentView !== undefined || busy) return
    setBusy(true)
    try {
      await harnessApi.updateQueue(selectedId, itemId, action.kind === 'edit'
        ? { kind: 'edit', content: [{ type: 'text', text: action.text }] }
        : action)
      await refreshSession(selectedId)
    } catch (reason) {
      setActionError(`队列操作失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleOpenSubagent = (entry: Extract<SubagentEntry, { kind: 'child' }>): void => {
    if (selectedId === undefined) return
    setActionError(undefined)
    setAttachments(current => { releaseAttachments(current); return [] })
    setSubagentView({
      parentSessionId: selectedId,
      childSessionId: entry.id,
      mode: entry.mode,
      label: entry.label ?? 'One-shot subagent',
    })
  }

  const handleGoalAction = async (action: 'create' | 'edit' | 'pause' | 'resume' | 'complete' | 'clear'): Promise<void> => {
    if (selectedId === undefined || busy || subagentView !== undefined) return
    const goal = projectionValues?.goal
    const current = goal?.goal
    if (action === 'create') {
      setGoalDialogError(undefined)
      setGoalDialog({ mode: 'create', objective: '', rounds: 8 })
      return
    }
    if (action === 'edit') {
      if (current === undefined) return
      setGoalDialogError(undefined)
      setGoalDialog({ mode: 'edit', objective: current.objective, rounds: current.maxGoalRounds })
      return
    }
    if (current === undefined || goal === undefined) return
    try {
      setBusy(true)
      if (action === 'pause') {
        await harnessApi.goalPause(selectedId, { id: current.id, revision: current.revision })
      } else if (action === 'resume') {
        await harnessApi.goalResume(selectedId, { id: current.id, revision: current.revision })
      } else if (action === 'complete') {
        if (!window.confirm('Mark this goal complete?')) return
        await harnessApi.goalComplete(selectedId, { id: current.id, revision: current.revision })
      } else {
        if (!window.confirm('Clear this goal?')) return
        await harnessApi.goalClear(selectedId, { id: current.id, revision: current.revision })
      }
      await refreshSession(selectedId)
    } catch (reason) {
      setActionError(`目标操作失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleGoalSubmit = async (objective: string, maxGoalRounds: number): Promise<void> => {
    if (selectedId === undefined || goalDialog === undefined || goalDialogBusy) return
    setGoalDialogBusy(true)
    setGoalDialogError(undefined)
    try {
      if (goalDialog.mode === 'create') {
        await harnessApi.goalCreate(selectedId, objective, maxGoalRounds)
      } else {
        const current = projectionValues?.goal?.goal
        if (current === undefined) throw new Error('The current goal is no longer available')
        await harnessApi.goalEdit(selectedId, { id: current.id, revision: current.revision }, objective, maxGoalRounds)
      }
      setGoalDialog(undefined)
      await refreshSession(selectedId)
    } catch (reason) {
      setGoalDialogError(errorText(reason))
    } finally {
      setGoalDialogBusy(false)
    }
  }

  const handleOpenFolder = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setActionError(undefined)
    try {
      const path = await harnessApi.pickDirectory()
      if (path === null) return
      const { workspace } = await harnessApi.createWorkspace(path)
      const existing = workspace.sessionIds
        .map(id => sessions.find(session => session.sessionId === id))
        .filter((session): session is SessionSummary => session !== undefined)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0]
      await refreshChrome()
      if (existing === undefined) beginPendingSession(workspace)
      else selectSession(existing.sessionId)
    } catch (reason) {
      setActionError(`打开工作文件夹失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const openPlugins = useCallback((): void => {
    setCommandsOpen(false)
    setSettingsOpen(false)
    setPluginsOpen(true)
  }, [])

  const openSettings = useCallback((): void => {
    setCommandsOpen(false)
    setPluginsOpen(false)
    setSettingsOpen(true)
  }, [])

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLocaleLowerCase()
      if (key === 'k') {
        event.preventDefault()
        setPluginsOpen(false)
        setSettingsOpen(false)
        setCommandsOpen(value => !value)
      } else if (event.key === ',') {
        event.preventDefault()
        openSettings()
      } else if (key === 'p' && event.shiftKey) {
        event.preventDefault()
        openPlugins()
      } else if (key === 'o') {
        event.preventDefault()
        setCommandsOpen(false)
        setSettingsOpen(false)
        void handleOpenFolder()
      } else if (key === 'n') {
        event.preventDefault()
        setCommandsOpen(false)
        setSettingsOpen(false)
        void handleNew()
      } else if (key === 'b') {
        event.preventDefault()
        setSidebarExpanded(value => !value)
      } else if (key === 'j') {
        event.preventDefault()
        setTerminalOpen(value => !value)
      } else if (key === 'i' && event.shiftKey) {
        event.preventDefault()
        setInspectorOpen(value => !value)
      }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })

  useEffect(() => window.dshDesktop?.onOpenPlugins(openPlugins), [openPlugins])
  useEffect(() => window.dshDesktop?.onOpenSettings(openSettings), [openSettings])

  const currentFolder = activeWorkspace?.title ?? basename(pendingSession?.cwd) ?? basename(selected?.cwd) ?? basename(host?.cwd) ?? 'Local workspace'
  const offline = host === undefined && !chromeLoading
  const activeMessages = smoothMessages
  const activeRunning = subagentView !== undefined
    ? activeSubagent?.activity === 'running'
    : codexRunning || selected?.running === true
  const activeTitle = subagentView?.label ?? titleOf(selected)
  const activeModels = subagentView === undefined ? presentedModels : undefined
  const activeJobs = subagentView === undefined
    ? (selectedId === undefined ? [] : jobsBySession[selectedId] ?? [])
    : (jobsBySession[subagentView.childSessionId] ?? [])

  return (
    <div className="workbench" data-sidebar={sidebarExpanded ? 'expanded' : 'rail'} data-inspector={inspectorOpen}>
      <Sidebar
        sessions={visibleSessions}
        workspaces={visibleWorkspaces}
        selectedId={selectedId}
        archivedSessionIds={archivedSessionIds}
        pinnedSessionIds={pinnedSessionIds}
        unreadSessionIds={unreadSessionIds}
        deletedSessionIds={deletedSessionIds}
        activeWorkspaceId={activeWorkspace?.workspaceId}
        collapsed={!sidebarExpanded}
        onSelect={selectSession}
        onNew={() => { void handleNew() }}
        onOpenFolder={() => { void handleOpenFolder() }}
        onWorkspace={workspace => { void handleWorkspace(workspace) }}
        onToggle={() => setSidebarExpanded(value => !value)}
        onPlugins={openPlugins}
        onSettings={openSettings}
        pluginCount={plugins?.entries.filter(entry => entry.enabled).length}
        searchHits={searchHits}
        searching={searching}
        onSearch={handleSearch}
        onSessionMenu={session => { void handleSessionMenu(session) }}
        onWorkspaceMenu={workspace => { void handleWorkspaceMenu(workspace) }}
        onMoveWorkspace={(workspaceId, beforeWorkspaceId) => { void handleMoveWorkspace(workspaceId, beforeWorkspaceId) }}
        onMoveSession={(workspaceId, sessionId, beforeSessionId) => { void handleMoveSession(workspaceId, sessionId, beforeSessionId) }}
      />

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarExpanded && (
              <button type="button" className="icon-button" onClick={() => setSidebarExpanded(true)} aria-label="Expand sidebar">
                <Icon name="panel-left" size={15} />
              </button>
            )}
            <div className="breadcrumbs">
              <span>{currentFolder}</span>
              <Icon name="chevron-right" size={12} />
              <strong>{activeTitle}</strong>
            </div>
          </div>
          <div className="topbar-center" />
          <div className="topbar-right">
            {selected !== undefined && subagentView === undefined && (
              <div className="session-actions">
                <button type="button" className="icon-button quiet session-overflow" onClick={() => { void handleSessionMenu(selected, true) }} aria-label="Chat actions" title="Chat actions">
                  <Icon name="more" size={16} />
                </button>
              </div>
            )}
            <JobDock jobs={activeJobs} />
            <button type="button" className="quick-command" onClick={() => setCommandsOpen(true)} aria-label="Open quick commands">
              <Icon name="search" size={13} /><span>Commands</span><kbd>{shortcutLabel('K')}</kbd>
            </button>
            <span className="connection-pill" data-state={offline ? 'offline' : connection}>
              <i />
              {codexActive ? 'Codex CLI' : offline ? 'Host offline' : connection === 'connected' ? 'Local' : connection}
            </span>
            <button type="button" className="icon-button" onClick={openSettings} aria-label="Open Settings" title={`Settings (${shortcutLabel(',')})`}>
              <Icon name="settings" size={15} />
            </button>
            <button type="button" className="icon-button" onClick={() => { void refreshChrome(); void refreshCodexCatalog(true) }} aria-label="Refresh">
              <Icon name="refresh" size={15} />
            </button>
            <button type="button" className="icon-button" data-active={terminalOpen} onClick={() => setTerminalOpen(value => !value)} aria-label="Toggle bottom panel" title={`Toggle bottom panel (${shortcutLabel('J')})`}>
              <Icon name="terminal" size={15} />
            </button>
            <button type="button" className="icon-button" data-active={inspectorOpen} onClick={() => setInspectorOpen(value => !value)} aria-label="Toggle side panel" title={`Toggle side panel (${shortcutLabel('I', true)})`}>
              <Icon name="panel-right" size={15} />
            </button>
          </div>
        </header>

        {appError !== undefined && (
          <div className="host-error">
            <div><strong>Harness Host is unavailable</strong><span>{appError}</span></div>
            <code>cd /path/to/deepseek-harness &amp;&amp; corepack pnpm dsh web</code>
            <button type="button" onClick={() => setOnboardingOpen(true)}>Setup</button>
            <button type="button" onClick={() => void refreshChrome()}>Retry</button>
          </div>
        )}

        <Conversation
          messages={activeMessages}
          loading={historyLoading || chromeLoading}
          running={activeRunning}
          scrollToBottomRequest={conversationScrollRequest}
          title={activeTitle}
          workspace={currentFolder}
          greeting={STARTUP_GREETING}
          hasMore={history.hasMore}
          loadingOlder={historyLoadingOlder}
          onLoadOlder={() => { void handleLoadOlder() }}
          onUseSuggestion={setDraft}
        />

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => { void handleSend() }}
          onStop={() => { void handleStop() }}
          disabled={codexActive ? !codexCatalog.available || (selectedId === undefined && pendingSession === undefined) : subagentView?.mode === 'one-shot' || offline}
          running={activeRunning}
          busy={busy}
          error={actionError}
          models={activeModels}
          permissionOptions={presentedPermissionOptions}
          permission={presentedPermission}
          onModel={(provider, model) => { void handleModel(provider, model) }}
          onEffort={effort => { void handleEffort(effort) }}
          onPermission={preset => { void handlePermission(preset) }}
          plan={codexActive ? undefined : projectionValues?.plan}
          onExitPlan={() => { void handleExitPlan() }}
          attachments={attachments}
          onAddFiles={files => { void handleAddFiles(files) }}
          onRemoveAttachment={handleRemoveAttachment}
          queue={activeQueue}
          onQueueAction={(itemId, action) => { void handleQueueAction(itemId, action) }}
        />

        {terminalOpen && (
          <TerminalDock
            cwd={activeWorkspace?.path ?? pendingSession?.cwd ?? selected?.cwd ?? host?.cwd}
            onClose={() => setTerminalOpen(false)}
          />
        )}
      </main>

      {inspectorOpen && (
        <Inspector
          host={host}
          session={selectedForView}
          workspace={activeWorkspace}
          models={presentedModels}
          activity={activity}
          skills={skills}
          subagents={subagents}
          subagentView={subagentView === undefined ? undefined : { id: subagentView.childSessionId, label: subagentView.label }}
          approvals={pendingApprovals}
          questions={pendingQuestions}
          sidechat={{
            owner: sidechatOwner,
            parentTitle: titleOf(selected),
            threads: sidechatThreads,
            activeThreadId: activeSidechatId,
            provider: sidechatCodexActive ? 'Codex' : sidechatModelEntry?.name ?? sidechatSelection?.model ?? 'DeepSeek',
            models: sidechatModels,
            permissionOptions: sidechatPermissionOptions,
            permission: sidechatSelection?.permission,
            messages: sidechatMessages,
            running: sidechatRunning,
            error: sidechatError,
          }}
          onUseSkill={name => setDraft(current => `${current}${current === '' ? '' : ' '}/${name} `)}
          onOpenSubagent={handleOpenSubagent}
          onExitSubagent={() => { setSubagentView(undefined) }}
          onApproval={(request, outcome) => { void handleApproval(request, outcome) }}
          onQuestion={(request, answers) => { void handleQuestion(request, answers) }}
          onSidechatSend={text => { void handleSidechatSend(text) }}
          onSidechatStop={() => { void handleSidechatStop() }}
          onSidechatNew={handleNewSidechat}
          onSidechatThread={handleSelectSidechat}
          onSidechatModel={handleSidechatModel}
          onSidechatEffort={handleSidechatEffort}
          onSidechatPermission={handleSidechatPermission}
          onGoalAction={action => { void handleGoalAction(action) }}
          onClose={() => setInspectorOpen(false)}
          onRefresh={() => {
            void refreshChrome()
            void refreshCodexCatalog(true)
            if (selectedId !== undefined) void refreshSession(selectedId, { includeModels: true })
          }}
        />
      )}

      <OnboardingWizard
        open={onboardingOpen}
        codex={codexCatalog}
        workspaces={visibleWorkspaces}
        onClose={() => {
          localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
          setOnboardingOpen(false)
        }}
        onComplete={() => {
          localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true')
          setOnboardingOpen(false)
        }}
        onHostReady={async () => {
          await refreshChrome()
          await refreshCodexCatalog(true)
        }}
        onRefreshCodex={async () => { await refreshCodexCatalog(true) }}
        onWorkspaceReady={workspace => {
          void refreshChrome()
          beginPendingSession(workspace)
        }}
      />

      <GoalDialog
        open={goalDialog !== undefined}
        mode={goalDialog?.mode ?? 'create'}
        initialObjective={goalDialog?.objective ?? ''}
        initialRounds={goalDialog?.rounds ?? 8}
        busy={goalDialogBusy}
        error={goalDialogError}
        onClose={() => { if (!goalDialogBusy) setGoalDialog(undefined) }}
        onSubmit={(objective, rounds) => { void handleGoalSubmit(objective, rounds) }}
      />

      <PluginManager
        open={pluginsOpen}
        snapshot={plugins}
        loading={pluginsLoading}
        changingId={pluginChangingId}
        error={pluginError}
        lastBackup={pluginBackup}
        onClose={() => setPluginsOpen(false)}
        onRefresh={() => { void refreshPlugins() }}
        onToggle={(entry, enabled) => { void handlePluginToggle(entry, enabled) }}
      />

      <SettingsPanel
        open={settingsOpen}
        themeMode={themeMode}
        density={density}
        responseSerif={responseSerif}
        reduceMotion={reduceMotion}
        resumeLastSession={resumeLastSession}
        sidebarExpanded={sidebarExpanded}
        inspectorOpen={inspectorOpen}
        currentFolder={currentFolder}
        models={presentedModels}
        permissionOptions={presentedPermissionOptions}
        permission={presentedPermission}
        busy={busy}
        running={activeRunning}
        currentPreset={selected?.agentPreset}
        currentSessionBlank={selected?.blank === true}
        plugins={plugins}
        host={host}
        connection={connection}
        offline={offline}
        fontStatus={fontStatus}
        onClose={() => setSettingsOpen(false)}
        onThemeMode={setThemeMode}
        onDensity={setDensity}
        onResponseSerif={setResponseSerif}
        onReduceMotion={setReduceMotion}
        onResumeLastSession={setResumeLastSession}
        onSidebar={setSidebarExpanded}
        onInspector={setInspectorOpen}
        onOpenFolder={() => { setSettingsOpen(false); void handleOpenFolder() }}
        onModel={(provider, model) => { void handleModel(provider, model) }}
        onEffort={effort => { void handleEffort(effort) }}
        onPermission={preset => { void handlePermission(preset) }}
        onCreatorPresetDraft={() => { void handleCreatorPresetDraft() }}
        onPlugins={openPlugins}
        onRefreshHost={() => {
          void refreshChrome()
          void refreshCodexCatalog(true)
          if (selectedId !== undefined) void refreshSession(selectedId, { includeModels: true })
        }}
      />

      <CommandPalette
        open={commandsOpen}
        sessions={visibleSessions}
        workspaces={visibleWorkspaces}
        selectedId={selectedId}
        dark={dark}
        inspectorOpen={inspectorOpen}
        sidebarExpanded={sidebarExpanded}
        onClose={() => setCommandsOpen(false)}
        onSession={selectSession}
        onWorkspace={workspace => { void handleWorkspace(workspace) }}
        onNew={() => { void handleNew() }}
        onOpenFolder={() => { void handleOpenFolder() }}
        onPlugins={openPlugins}
        onSettings={openSettings}
        onTheme={() => setThemeMode(dark ? 'light' : 'dark')}
        onInspector={() => setInspectorOpen(value => !value)}
        onSidebar={() => setSidebarExpanded(value => !value)}
      />
    </div>
  )
}
