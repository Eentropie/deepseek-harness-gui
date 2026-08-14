import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Composer } from './components/Composer.tsx'
import { CommandPalette } from './components/CommandPalette.tsx'
import { Conversation } from './components/Conversation.tsx'
import { Icon } from './components/Icon.tsx'
import { Inspector } from './components/Inspector.tsx'
import { InteractionPanel, type QuestionAnswer } from './components/InteractionPanel.tsx'
import { JobDock } from './components/JobDock.tsx'
import { PluginManager } from './components/PluginManager.tsx'
import {
  SettingsPanel,
  type InterfaceDensity,
  type LocalFontStatus,
  type ThemeMode,
} from './components/SettingsPanel.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { codexApi, harnessApi, subscribeCodex, subscribeDownlinks } from './lib/api.ts'
import { frameSessionId, projectActivity, projectConversation, projectQueue } from './lib/history.ts'
import { chooseGreeting } from './lib/greetings.ts'
import type {
  GoalProjection,
  HistoryPage,
  CodexCatalog,
  CodexEvent,
  ConversationMessage,
  HostDescription,
  JobView,
  ImageMediaType,
  PendingAttachment,
  PluginControlSnapshot,
  PluginEntry,
  PromptContentPart,
  ApprovalRequest,
  QuestionRequest,
  QueueItem,
  SessionSearchHit,
  SessionModels,
  SessionSummary,
  SkillEntry,
  SubagentCatalog,
  SubagentEntry,
  WorkspaceSummary,
} from './lib/types.ts'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting'

const EMPTY_HISTORY: HistoryPage = { events: [], hasMore: false }
const CODEX_PROVIDER = 'codex-cli'
const STARTUP_SESSION_ID = new URLSearchParams(window.location.search).get('sessionId') ?? undefined
const GREETING_STORAGE_KEY = 'dsh-workbench-last-greeting'
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
}

const EMPTY_CODEX_SESSION: CodexSessionState = { active: false }

function codexSessionKey(sessionId: string): string {
  return `dsh-workbench-codex-session:${sessionId}`
}

function readCodexSession(sessionId: string): CodexSessionState {
  try {
    const value = JSON.parse(localStorage.getItem(codexSessionKey(sessionId)) ?? 'null') as unknown
    if (typeof value !== 'object' || value === null) return EMPTY_CODEX_SESSION
    const record = value as Record<string, unknown>
    return {
      active: record['active'] === true,
      ...(typeof record['threadId'] === 'string' ? { threadId: record['threadId'] } : {}),
      ...(typeof record['model'] === 'string' ? { model: record['model'] } : {}),
      ...(typeof record['effort'] === 'string' ? { effort: record['effort'] } : {}),
    }
  } catch {
    return EMPTY_CODEX_SESSION
  }
}

function writeCodexSession(sessionId: string, state: CodexSessionState): void {
  localStorage.setItem(codexSessionKey(sessionId), JSON.stringify(state))
}

function titleOf(session?: SessionSummary): string {
  const title = session?.projections?.values.title
  return typeof title === 'string' && title.trim() !== '' ? title : 'New session'
}

function basename(path?: string): string | undefined {
  if (path === undefined) return undefined
  return path.split('/').filter(Boolean).at(-1)
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
  const [draft, setDraft] = useState('')
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
  const [appError, setAppError] = useState<string>()
  const [actionError, setActionError] = useState<string>()
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [plugins, setPlugins] = useState<PluginControlSnapshot>()
  const [pluginsLoading, setPluginsLoading] = useState(false)
  const [pluginChangingId, setPluginChangingId] = useState<string>()
  const [pluginError, setPluginError] = useState<string>()
  const [pluginBackup, setPluginBackup] = useState<string>()
  const [sidebarExpanded, setSidebarExpanded] = useState(() => storedBoolean('dsh-workbench-sidebar', true))
  const [inspectorOpen, setInspectorOpen] = useState(() => storedBoolean('dsh-workbench-inspector', true))
  const [themeMode, setThemeMode] = useState<ThemeMode>(storedThemeMode)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [density, setDensity] = useState<InterfaceDensity>(() => localStorage.getItem('dsh-workbench-density') === 'compact' ? 'compact' : 'comfortable')
  const [responseSerif, setResponseSerif] = useState(() => storedBoolean('dsh-workbench-response-serif', true))
  const [reduceMotion, setReduceMotion] = useState(() => storedBoolean('dsh-workbench-reduce-motion', false))
  const [resumeLastSession, setResumeLastSession] = useState(() => storedBoolean('dsh-workbench-resume-last', true))
  const [fontStatus, setFontStatus] = useState<LocalFontStatus>('checking')
  const selectedRef = useRef<string>()
  const historyGeneration = useRef(0)
  const searchGeneration = useRef(0)
  const dark = themeMode === 'dark' || (themeMode === 'system' && systemDark)

  const selectSession = useCallback((sessionId: string): void => {
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
  const messages = useMemo(() => projectConversation(history.events).map(message => ({
    ...message,
    blocks: message.blocks.map(block => {
      if (block.kind !== 'image' || block.attachmentId === undefined) return block
      const source = attachmentSources[`${subagentView?.childSessionId ?? selectedId ?? ''}:${block.attachmentId}`]
      return source === undefined ? block : { ...block, src: source }
    }),
  })), [attachmentSources, history.events, selectedId, subagentView?.childSessionId])
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
    let active = true
    void codexApi.catalog().then(catalog => {
      if (active) setCodexCatalog(catalog)
    }).catch(reason => {
      if (!active) return
      setCodexCatalog({
        available: false,
        authenticatedWith: 'ChatGPT',
        models: [],
        error: errorText(reason),
      })
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    setCodexMessages([])
    setCodexRunning(false)
    setCodexTurnId(undefined)
    if (selectedId === undefined) {
      setCodexSession(EMPTY_CODEX_SESSION)
      return
    }
    const state = readCodexSession(selectedId)
    setCodexSession(state)
    if (state.threadId === undefined) return
    let active = true
    void codexApi.readThread(state.threadId).then(snapshot => {
      if (active && selectedRef.current === selectedId) setCodexMessages(snapshot.messages)
    }).catch(reason => {
      if (active && state.active) setActionError(`Codex 线程读取失败：${errorText(reason)}`)
    })
    return () => { active = false }
  }, [selectedId])

  useEffect(() => subscribeCodex((event: CodexEvent) => {
    const sessionId = event.sessionId
    if (sessionId !== undefined && sessionId !== selectedRef.current) return
    if (event.type === 'turn-started') {
      setCodexRunning(true)
      setCodexTurnId(event.turnId)
      return
    }
    if (event.type === 'assistant-delta' || event.type === 'reasoning-delta') {
      const id = `codex-stream-${event.turnId}-${event.itemId}`
      const kind = event.type === 'assistant-delta' ? 'text' : 'reasoning'
      setCodexMessages(current => {
        const index = current.findIndex(message => message.id === id)
        if (index < 0) return [...current, {
          id,
          seq: Date.now(),
          time: Date.now(),
          role: 'assistant',
          agent: 'Codex',
          blocks: [{ kind, text: event.delta }],
          streaming: true,
        }]
        const next = [...current]
        const existing = next[index]
        if (existing === undefined) return current
        const block = existing.blocks[0]
        next[index] = {
          ...existing,
          blocks: [{ kind, text: block?.kind === kind ? block.text + event.delta : event.delta }],
          streaming: true,
        }
        return next
      })
      return
    }
    if (event.type === 'turn-completed') {
      setCodexRunning(false)
      setCodexTurnId(undefined)
      if (event.status === 'failed') setActionError(`Codex 运行失败：${event.error ?? 'Unknown error'}`)
      void codexApi.readThread(event.threadId).then(snapshot => {
        if (event.sessionId === undefined || event.sessionId === selectedRef.current) setCodexMessages(snapshot.messages)
      }).catch(reason => setActionError(`Codex 线程刷新失败：${errorText(reason)}`))
      return
    }
    if (event.type === 'error') {
      setCodexRunning(false)
      setCodexTurnId(undefined)
      setActionError(`Codex CLI：${event.message}`)
    }
  }), [])

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

  const refreshChrome = useCallback(async (signal?: AbortSignal): Promise<void> => {
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
          && !deletedSessionIds.has(current)) return current
        const saved = resumeLastSession ? localStorage.getItem('dsh-workbench-session') : null
        if (saved !== null && !deletedSessionIds.has(saved)
          && sessionPage.items.some(session => session.sessionId === saved)) return saved
        return sessionPage.items.find(session => !deletedSessionIds.has(session.sessionId)
            && !workspacePage.archivedSessionIds.includes(session.sessionId) && !session.blank)?.sessionId
          ?? sessionPage.items.find(session => !deletedSessionIds.has(session.sessionId)
            && !workspacePage.archivedSessionIds.includes(session.sessionId))?.sessionId
      })
    } catch (reason) {
      if (signal?.aborted === true) return
      setHost(undefined)
      setAppError(`无法连接本地 Harness Host：${errorText(reason)}`)
    } finally {
      if (signal?.aborted !== true) setChromeLoading(false)
    }
  }, [deletedSessionIds, resumeLastSession])

  const refreshSession = useCallback(async (
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
      setHistory(nextHistory)
      if (nextModels !== undefined) setModels(nextModels)
      setActionError(undefined)
    } catch (reason) {
      if (options.signal?.aborted === true || generation !== historyGeneration.current) return
      setActionError(`会话刷新失败：${errorText(reason)}`)
    } finally {
      if (generation === historyGeneration.current && options.signal?.aborted !== true) setHistoryLoading(false)
    }
  }, [subagentView])

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
    setHistory(EMPTY_HISTORY)
    setModels(undefined)
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
  }, [refreshSession, selectedId, subagentView])

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const dispose = subscribeDownlinks((frame) => {
      const sessionId = frameSessionId(frame)
      if (frame['type'] === 'approval/requested' && typeof frame.__rpcId === 'string'
        && typeof sessionId === 'string' && typeof frame['approvalId'] === 'string' && typeof frame['toolName'] === 'string') {
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
        setPendingApprovals(current => current.filter(item => item.approvalId !== frame['approvalId']))
      }
      if (frame['type'] === 'question/requested' && typeof frame.__rpcId === 'string'
        && typeof sessionId === 'string' && Array.isArray(frame['questions'])) {
        setPendingQuestions(current => current.some(item => item.rpcId === frame.__rpcId)
          ? current
          : [...current, { rpcId: frame.__rpcId as string, sessionId, questions: frame['questions'] as QuestionRequest['questions'] }])
      }
      if (frame['type'] === 'question/resolved' && typeof frame['questionRpcId'] === 'string') {
        setPendingQuestions(current => current.filter(item => item.rpcId !== frame['questionRpcId']))
      }
      if (frame['type'] === 'session/jobs' && typeof sessionId === 'string' && Array.isArray(frame['jobs'])) {
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
        setQueueBySession(current => ({ ...current, [sessionId]: queue }))
      }
      if (refreshTimer !== undefined) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void refreshChrome()
        const current = selectedRef.current
        const relevantSubagent = subagentView?.childSessionId === sessionId
        if (current !== undefined && (sessionId === undefined || sessionId === current || relevantSubagent)) {
          void refreshSession(current)
        }
      }, 140)
    }, setConnection)
    const poll = setInterval(() => { void refreshChrome() }, 4_000)
    return () => {
      if (refreshTimer !== undefined) clearTimeout(refreshTimer)
      clearInterval(poll)
      dispose()
    }
  }, [refreshChrome, refreshSession, subagentView?.childSessionId])

  useEffect(() => {
    const running = subagentView !== undefined
      ? activeSubagent?.activity === 'running'
      : selected?.running === true
    if (selectedId === undefined || !running) return
    const poll = setInterval(() => { void refreshSession(selectedId) }, 650)
    return () => clearInterval(poll)
  }, [activeSubagent?.activity, refreshSession, selected?.running, selectedId, subagentView])

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

  const createSession = useCallback(async (agentPreset?: string): Promise<string> => {
    const workspace = selectedWorkspace ?? workspaces[0]
    const result = await harnessApi.createSession(
      {
        ...(workspace === undefined ? { cwd: host?.cwd } : { workspaceId: workspace.workspaceId }),
        ...(agentPreset === undefined ? {} : { agentPreset }),
      },
    )
    setSelectedId(result.sessionId)
    selectedRef.current = result.sessionId
    await refreshChrome()
    return result.sessionId
  }, [host?.cwd, refreshChrome, selectedWorkspace, workspaces])

  const handleNew = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setActionError(undefined)
    try {
      await createSession()
      setDraft('')
    } catch (reason) {
      setActionError(`新建会话失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
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

  const handleCreatorPresetDraft = async (): Promise<void> => {
    if (busy) return
    setSettingsOpen(false)
    setBusy(true)
    setActionError(undefined)
    try {
      await createSession('cordis')
      setDraft('Help me create a custom DeepSeek Harness agent preset for ')
    } catch (reason) {
      setActionError(`Creator 预设会话创建失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleSend = async (): Promise<void> => {
    const prompt = draft.trim()
    if ((prompt === '' && attachments.length === 0) || busy) return
    setBusy(true)
    setActionError(undefined)
    setDraft('')
    try {
      const sessionId = selectedId ?? await createSession()
      if (codexActive) {
        if (attachments.length > 0) throw new Error('Codex CLI 当前只接受文本输入')
        const current = presentedModels?.current
        const cwd = selectedWorkspace?.path ?? selected?.cwd ?? host?.cwd
        if (current === undefined || cwd === undefined) throw new Error('Codex model or work folder is unavailable')
        const optimisticId = `codex-user-${Date.now()}`
        setCodexMessages(messages => [...messages, {
          id: optimisticId,
          seq: Date.now(),
          time: Date.now(),
          role: 'user',
          blocks: [{ kind: 'text', text: prompt }],
        }])
        setCodexRunning(true)
        const result = await codexApi.prompt({
          sessionId,
          ...(codexSession.threadId === undefined ? {} : { threadId: codexSession.threadId }),
          cwd,
          model: current.model,
          effort: current.reasoningEffort ?? 'medium',
          prompt,
        })
        const next = {
          ...codexSession,
          active: true,
          threadId: result.threadId,
          model: current.model,
          effort: current.reasoningEffort ?? 'medium',
        }
        setCodexSession(next)
        writeCodexSession(sessionId, next)
        setCodexTurnId(result.turnId)
        return
      }
      if (subagentView !== undefined) {
        if (subagentView.mode !== 'continuable') throw new Error('One-shot subagent 不能继续发送消息')
        if (attachments.length > 0) throw new Error('子代理会话暂不支持图片')
        await harnessApi.subagentPrompt({ parentSessionId: sessionId, childSessionId: subagentView.childSessionId, text: prompt })
      } else {
        const content: PromptContentPart[] = [
          ...(prompt === '' ? [] : [{ type: 'text' as const, text: prompt }]),
          ...attachments.map(item => ({ type: 'image' as const, mediaType: item.mediaType, data: item.data, name: item.name })),
        ]
        await harnessApi.prompt(sessionId, content)
      }
      releaseAttachments(attachments)
      setAttachments([])
      await Promise.all([refreshChrome(), refreshSession(sessionId)])
      window.setTimeout(() => { void refreshSession(sessionId) }, 250)
    } catch (reason) {
      if (codexActive) {
        setCodexRunning(false)
        setCodexTurnId(undefined)
      }
      setDraft(current => current === '' ? prompt : current)
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
      if (codexActive && codexSession.threadId !== undefined && codexTurnId !== undefined) {
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
    if (selectedId === undefined || presentedModels === undefined || busy || subagentView !== undefined) return
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
        const next = { ...codexSession, active: true, model, effort }
        setCodexSession(next)
        writeCodexSession(selectedId, next)
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
    if (selectedId === undefined || presentedModels === undefined || busy || subagentView !== undefined) return
    setBusy(true)
    try {
      if (codexActive) {
        const model = codexCatalog.models.find(candidate => candidate.id === presentedModels.current.model)
        if (model === undefined || !model.efforts.some(candidate => candidate.id === effort)) {
          throw new Error('This Codex model does not support the selected reasoning effort')
        }
        const next = { ...codexSession, active: true, model: model.id, effort }
        setCodexSession(next)
        writeCodexSession(selectedId, next)
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
    if (selectedId === undefined || busy || subagentView !== undefined || preset === permissions?.currentValue) return
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
    setBusy(true)
    setActionError(undefined)
    try {
      const existing = workspace.sessionIds
        .map(id => sessions.find(session => session.sessionId === id))
        .filter((session): session is SessionSummary => session !== undefined)
        .sort((left, right) => right.updatedAt - left.updatedAt)[0]
      const sessionId = existing?.sessionId
        ?? (await harnessApi.createSession({ workspaceId: workspace.workspaceId })).sessionId
      setSelectedId(sessionId)
      selectedRef.current = sessionId
      setDraft('')
      await refreshChrome()
    } catch (reason) {
      setActionError(`工作文件夹切换失败：${errorText(reason)}`)
    } finally {
      setBusy(false)
    }
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
    if (session.sessionId === selectedId) {
      setSubagentView(undefined)
      setSelectedId(undefined)
      selectedRef.current = undefined
    }
    setActionError('会话已从 DeepSeek Harness 中删除；Host 原始日志仍保留。')
  }

  const handleOpenPath = async (path?: string): Promise<void> => {
    const target = path ?? selectedWorkspace?.path ?? selected?.cwd ?? host?.cwd
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
        setBusy(true)
        const result = await harnessApi.createSession({ workspaceId: workspace.workspaceId })
        selectSession(result.sessionId)
        selectedRef.current = result.sessionId
        setDraft('')
        await refreshChrome()
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
      setHistory(current => {
        const bySeq = new Map<number, typeof current.events[number]>()
        current.events.forEach(item => bySeq.set(item.event.seq, item))
        page.events.forEach(item => bySeq.set(item.event.seq, item))
        return {
          ...current,
          events: [...bySeq.values()].sort((left, right) => left.event.seq - right.event.seq),
          hasMore: page.hasMore,
        }
      })
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
    setDraft('')
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
    try {
      setBusy(true)
      if (action === 'create') {
        const objective = window.prompt('Goal objective')?.trim()
        if (objective === undefined || objective === '') return
        const roundsText = window.prompt('Maximum rounds (optional)', String(current?.maxGoalRounds ?? 8))?.trim()
        const rounds = roundsText === undefined || roundsText === '' ? undefined : Number(roundsText)
        await harnessApi.goalCreate(selectedId, objective, rounds !== undefined && Number.isInteger(rounds) && rounds > 0 ? rounds : undefined)
      } else if (current === undefined || goal === undefined) {
        return
      } else if (action === 'edit') {
        const objective = window.prompt('Goal objective', current.objective)?.trim()
        if (objective === undefined || objective === '') return
        await harnessApi.goalEdit(selectedId, { id: current.id, revision: current.revision }, objective)
      } else if (action === 'pause') {
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
      const sessionId = existing?.sessionId
        ?? (await harnessApi.createSession({ workspaceId: workspace.workspaceId })).sessionId
      setSelectedId(sessionId)
      selectedRef.current = sessionId
      setDraft('')
      await refreshChrome()
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

  const currentFolder = selectedWorkspace?.title ?? basename(selected?.cwd) ?? basename(host?.cwd) ?? 'Local workspace'
  const offline = host === undefined && !chromeLoading
  const activeMessages = codexActive ? codexMessages : messages
  const activeRunning = codexActive
    ? codexRunning
    : subagentView !== undefined
      ? activeSubagent?.activity === 'running'
      : selected?.running === true
  const activeTitle = subagentView?.label ?? titleOf(selected)
  const activeModels = subagentView === undefined ? presentedModels : undefined
  const activeJobs = subagentView === undefined
    ? (selectedId === undefined ? [] : jobsBySession[selectedId] ?? [])
    : (jobsBySession[subagentView.childSessionId] ?? [])

  return (
    <div className="workbench" data-sidebar={sidebarExpanded ? 'expanded' : 'rail'} data-inspector={inspectorOpen}>
      <Sidebar
        sessions={sessions}
        workspaces={workspaces}
        selectedId={selectedId}
        archivedSessionIds={archivedSessionIds}
        pinnedSessionIds={pinnedSessionIds}
        unreadSessionIds={unreadSessionIds}
        deletedSessionIds={deletedSessionIds}
        activeWorkspaceId={selectedWorkspace?.workspaceId}
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
              <Icon name="search" size={13} /><span>Commands</span><kbd>⌘K</kbd>
            </button>
            <span className="connection-pill" data-state={offline ? 'offline' : connection}>
              <i />
              {codexActive ? 'Codex CLI' : offline ? 'Host offline' : connection === 'connected' ? 'Local' : connection}
            </span>
            <button type="button" className="icon-button" onClick={openSettings} aria-label="Open Settings" title="Settings (⌘,)">
              <Icon name="settings" size={15} />
            </button>
            <button type="button" className="icon-button" onClick={() => void refreshChrome()} aria-label="Refresh">
              <Icon name="refresh" size={15} />
            </button>
            {!inspectorOpen && (
              <button type="button" className="icon-button" onClick={() => setInspectorOpen(true)} aria-label="Open inspector">
                <Icon name="panel-right" size={15} />
              </button>
            )}
          </div>
        </header>

        {appError !== undefined && (
          <div className="host-error">
            <div><strong>Harness Host is unavailable</strong><span>{appError}</span></div>
            <code>cd /path/to/deepseek-harness &amp;&amp; corepack pnpm dsh web</code>
            <button type="button" onClick={() => void refreshChrome()}>Retry</button>
          </div>
        )}

        <InteractionPanel
          approval={pendingApprovals[0]}
          question={pendingQuestions[0]}
          onApproval={(request, outcome) => { void handleApproval(request, outcome) }}
          onQuestion={(request, answers) => { void handleQuestion(request, answers) }}
        />

        <Conversation
          messages={activeMessages}
          loading={historyLoading || chromeLoading}
          title={activeTitle}
          workspace={currentFolder}
          greeting={STARTUP_GREETING}
          hasMore={codexActive ? false : history.hasMore}
          loadingOlder={historyLoadingOlder}
          onLoadOlder={() => { void handleLoadOlder() }}
          onUseSuggestion={setDraft}
        />

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => { void handleSend() }}
          onStop={() => { void handleStop() }}
          disabled={codexActive ? !codexCatalog.available || selectedId === undefined : subagentView?.mode === 'one-shot' || offline}
          running={activeRunning}
          busy={busy}
          error={actionError}
          models={activeModels}
          permissionOptions={codexActive ? [] : permissions?.options ?? []}
          permission={codexActive ? undefined : permissions?.currentValue}
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
      </main>

      {inspectorOpen && (
        <Inspector
          host={host}
          session={selectedForView}
          workspace={selectedWorkspace}
          models={presentedModels}
          activity={activity}
          skills={skills}
          subagents={subagents}
          subagentView={subagentView === undefined ? undefined : { id: subagentView.childSessionId, label: subagentView.label }}
          onUseSkill={name => setDraft(current => `${current}${current === '' ? '' : ' '}/${name} `)}
          onOpenSubagent={handleOpenSubagent}
          onExitSubagent={() => { setSubagentView(undefined) }}
          onGoalAction={action => { void handleGoalAction(action) }}
          onClose={() => setInspectorOpen(false)}
          onRefresh={() => {
            void refreshChrome()
            if (selectedId !== undefined) void refreshSession(selectedId, { includeModels: true })
          }}
        />
      )}

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
        permissionOptions={codexActive ? [] : permissions?.options ?? []}
        permission={codexActive ? undefined : permissions?.currentValue}
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
          if (selectedId !== undefined) void refreshSession(selectedId, { includeModels: true })
        }}
      />

      <CommandPalette
        open={commandsOpen}
        sessions={sessions}
        workspaces={workspaces}
        selectedId={selectedId}
        dark={dark}
        inspectorOpen={inspectorOpen}
        sidebarExpanded={sidebarExpanded}
        onClose={() => setCommandsOpen(false)}
        onSession={setSelectedId}
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
