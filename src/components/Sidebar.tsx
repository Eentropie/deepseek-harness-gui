import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon.tsx'
import { WhaleLogo } from './WhaleLogo.tsx'
import type { SessionSearchHit, SessionSummary, WorkspaceSummary } from '../lib/types.ts'

interface SidebarProps {
  sessions: SessionSummary[]
  workspaces: WorkspaceSummary[]
  archivedSessionIds: string[]
  pinnedSessionIds: ReadonlySet<string>
  unreadSessionIds: ReadonlySet<string>
  deletedSessionIds: ReadonlySet<string>
  selectedId?: string
  activeWorkspaceId?: string
  collapsed: boolean
  onSelect: (sessionId: string) => void
  onNew: () => void
  onOpenFolder: () => void
  onWorkspace: (workspace: WorkspaceSummary) => void
  onToggle: () => void
  onPlugins: () => void
  onSettings: () => void
  pluginCount?: number
  searchHits: SessionSearchHit[]
  searching: boolean
  onSearch: (query: string) => void
  onSessionMenu: (session: SessionSummary) => void
  onWorkspaceMenu: (workspace: WorkspaceSummary) => void
  onMoveWorkspace: (workspaceId: string, beforeWorkspaceId?: string) => void
  onMoveSession: (workspaceId: string, sessionId: string, beforeSessionId?: string) => void
}

type DragPayload =
  | { kind: 'workspace'; id: string }
  | { kind: 'session'; id: string; workspaceId: string }

function readDrag(event: React.DragEvent): DragPayload | undefined {
  try {
    const value = JSON.parse(event.dataTransfer.getData('application/x-dsh-workbench')) as unknown
    if (typeof value !== 'object' || value === null) return undefined
    const record = value as Record<string, unknown>
    if (record['kind'] === 'workspace' && typeof record['id'] === 'string') return { kind: 'workspace', id: record['id'] }
    if (record['kind'] === 'session' && typeof record['id'] === 'string' && typeof record['workspaceId'] === 'string') {
      return { kind: 'session', id: record['id'], workspaceId: record['workspaceId'] }
    }
  } catch {
    // Ignore drags originating outside this sidebar.
  }
  return undefined
}

function sessionTitle(session: SessionSummary): string {
  const value = session.projections?.values.title
  return typeof value === 'string' && value.trim() !== '' ? value : 'New session'
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function Sidebar({
  sessions,
  workspaces,
  archivedSessionIds,
  pinnedSessionIds,
  unreadSessionIds,
  deletedSessionIds,
  selectedId,
  activeWorkspaceId,
  collapsed,
  onSelect,
  onNew,
  onOpenFolder,
  onWorkspace,
  onToggle,
  onPlugins,
  onSettings,
  pluginCount,
  searchHits,
  searching,
  onSearch,
  onSessionMenu,
  onWorkspaceMenu,
  onMoveWorkspace,
  onMoveSession,
}: SidebarProps) {
  const [query, setQuery] = useState('')
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set(['__archived__']))
  const [dragging, setDragging] = useState<DragPayload>()
  const [dropTarget, setDropTarget] = useState<string>()
  const archivedIds = useMemo(() => new Set(archivedSessionIds), [archivedSessionIds])
  const availableSessions = useMemo(
    () => sessions.filter(session => !deletedSessionIds.has(session.sessionId)),
    [deletedSessionIds, sessions],
  )
  const activeSessions = useMemo(
    () => availableSessions.filter(session => !archivedIds.has(session.sessionId)),
    [archivedIds, availableSessions],
  )
  const archivedSessions = useMemo(
    () => availableSessions.filter(session => archivedIds.has(session.sessionId)),
    [archivedIds, availableSessions],
  )
  const byId = useMemo(() => new Map(activeSessions.map(session => [session.sessionId, session])), [activeSessions])
  const normalized = query.trim().toLocaleLowerCase()
  const hitIds = useMemo(() => new Set(searchHits.map(hit => hit.sessionId)), [searchHits])
  const hitById = useMemo(() => new Map(searchHits.map(hit => [hit.sessionId, hit.snippet])), [searchHits])
  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(query.trim()), query.trim() === '' ? 0 : 220)
    return () => window.clearTimeout(timer)
  }, [onSearch, query])
  const visible = (session: SessionSummary): boolean => {
    if (normalized === '') return true
    if (hitIds.has(session.sessionId)) return true
    if (searching) return sessionTitle(session).toLocaleLowerCase().includes(normalized)
    return sessionTitle(session).toLocaleLowerCase().includes(normalized)
      || (session.cwd ?? '').toLocaleLowerCase().includes(normalized)
  }
  const groupedIds = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
  const ungrouped = activeSessions.filter(session => !groupedIds.has(session.sessionId))
  const archivedRows = archivedSessions
    .filter(visible)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const archivedClosed = normalized === '' && closedGroups.has('__archived__')

  const toggleGroup = (workspaceId: string): void => {
    setClosedGroups(current => {
      const next = new Set(current)
      if (next.has(workspaceId)) next.delete(workspaceId)
      else next.add(workspaceId)
      return next
    })
  }

  const row = (session: SessionSummary, workspaceId?: string, archived = false) => (
    <button
      type="button"
      className="session-row"
      data-session-id={session.sessionId}
      draggable={workspaceId !== undefined}
      data-selected={session.sessionId === selectedId}
      data-pinned={pinnedSessionIds.has(session.sessionId)}
      data-unread={unreadSessionIds.has(session.sessionId)}
      data-archived={archived}
      data-dragging={dragging?.kind === 'session' && dragging.id === session.sessionId}
      data-drop-target={dropTarget === `session:${session.sessionId}`}
      onClick={() => onSelect(session.sessionId)}
      onDoubleClick={event => { event.preventDefault(); onSessionMenu(session) }}
      onContextMenu={event => { event.preventDefault(); onSessionMenu(session) }}
      onDragStart={event => {
        if (workspaceId === undefined) return
        const payload: DragPayload = { kind: 'session', id: session.sessionId, workspaceId }
        setDragging(payload)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-dsh-workbench', JSON.stringify(payload))
      }}
      onDragEnd={() => { setDragging(undefined); setDropTarget(undefined) }}
      onDragOver={event => {
        const payload = dragging ?? readDrag(event)
        if (payload?.kind === 'session' && payload.workspaceId === workspaceId) {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          setDropTarget(`session:${session.sessionId}`)
        }
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === `session:${session.sessionId}` ? undefined : current)
      }}
      onDrop={event => {
        event.preventDefault()
        event.stopPropagation()
        if (workspaceId === undefined) return
        const payload = dragging ?? readDrag(event)
        setDropTarget(undefined)
        if (payload?.kind === 'session' && payload.workspaceId === workspaceId) onMoveSession(workspaceId, payload.id, session.sessionId)
      }}
      title={collapsed ? sessionTitle(session) : undefined}
      key={session.sessionId}
    >
      <span className="session-state" data-running={session.running} />
      {!collapsed && (
        <>
          <span className="session-copy">
            <span className="session-title">{sessionTitle(session)}</span>
            <span className="session-path">
              {hitById.get(session.sessionId) ?? (archived ? `Archived · ${session.agentPreset ?? 'standard'}` : session.agentPreset ?? 'standard')}
            </span>
          </span>
          {pinnedSessionIds.has(session.sessionId) && <Icon name="pin" size={12} className="session-pin" />}
          {unreadSessionIds.has(session.sessionId) && <span className="session-unread" aria-label="Unread" />}
          <span className="session-time">{relativeTime(session.updatedAt)}</span>
        </>
      )}
    </button>
  )

  return (
    <aside className="sidebar" data-collapsed={collapsed} aria-label="Sessions">
      <div className="brand-row">
        <div className="brand-mark" title="DeepSeek Harness">
          <WhaleLogo size={collapsed ? 26 : 29} />
        </div>
        {!collapsed && (
          <div className="brand-copy">
            <span>DeepSeek</span>
            <small>HARNESS</small>
          </div>
        )}
        {!collapsed && (
          <button type="button" className="icon-button quiet" onClick={onToggle} aria-label="Collapse sidebar">
            <Icon name="panel-left" />
          </button>
        )}
      </div>

      {collapsed && (
        <button type="button" className="rail-action" onClick={onToggle} aria-label="Expand sidebar">
          <Icon name="panel-left" />
        </button>
      )}

      <button type="button" className="new-session" onClick={onNew} title="New session">
        <Icon name="plus" size={17} />
        {!collapsed && <span>New session</span>}
      </button>

      <button type="button" className="open-folder" onClick={onOpenFolder} title="Open folder (⌘O)">
        <Icon name="folder-plus" size={16} />
        {!collapsed && <span>Open folder…</span>}
        {!collapsed && <kbd>⌘O</kbd>}
      </button>

      {!collapsed && (
        <label className="search-box">
          <Icon name="search" size={15} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
        </label>
      )}

      <div className="sidebar-scroll">
        {workspaces.map(workspace => {
          const rows = workspace.sessionIds
            .map(id => byId.get(id))
            .filter((session): session is SessionSummary => session !== undefined && visible(session))
            .sort((left, right) => Number(pinnedSessionIds.has(right.sessionId)) - Number(pinnedSessionIds.has(left.sessionId)))
          if (normalized !== '' && rows.length === 0) return null
          const closed = closedGroups.has(workspace.workspaceId)
          return (
            <section
              className="session-group"
              data-workspace-id={workspace.workspaceId}
              data-drop-target={dropTarget === `group:${workspace.workspaceId}`}
              key={workspace.workspaceId}
              onDragOver={event => {
                const payload = dragging ?? readDrag(event)
                if (payload?.kind === 'session' && payload.workspaceId === workspace.workspaceId) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropTarget(`group:${workspace.workspaceId}`)
                }
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === `group:${workspace.workspaceId}` ? undefined : current)
              }}
              onDrop={event => {
                event.preventDefault()
                const payload = dragging ?? readDrag(event)
                setDropTarget(undefined)
                if (payload?.kind === 'session' && payload.workspaceId === workspace.workspaceId) onMoveSession(workspace.workspaceId, payload.id)
              }}
            >
              {!collapsed && (
                <div
                  className="group-heading"
                  data-active={workspace.workspaceId === activeWorkspaceId}
                  draggable
                  onDragStart={event => {
                    const payload: DragPayload = { kind: 'workspace', id: workspace.workspaceId }
                    setDragging(payload)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('application/x-dsh-workbench', JSON.stringify(payload))
                  }}
                  onDragEnd={() => { setDragging(undefined); setDropTarget(undefined) }}
                  onDragOver={event => {
                    const payload = dragging ?? readDrag(event)
                    if (payload?.kind === 'workspace' && payload.id !== workspace.workspaceId) {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDropTarget(`workspace:${workspace.workspaceId}`)
                    }
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    const payload = dragging ?? readDrag(event)
                    setDropTarget(undefined)
                    if (payload?.kind === 'workspace' && payload.id !== workspace.workspaceId) onMoveWorkspace(payload.id, workspace.workspaceId)
                  }}
                  data-drop-target={dropTarget === `workspace:${workspace.workspaceId}`}
                  onContextMenu={event => { event.preventDefault(); onWorkspaceMenu(workspace) }}
                >
                  <button type="button" className="group-disclosure" onClick={() => toggleGroup(workspace.workspaceId)} aria-label={`${closed ? 'Expand' : 'Collapse'} ${workspace.title}`}>
                    <Icon name={closed ? 'chevron-right' : 'chevron-down'} size={13} />
                  </button>
                  <button type="button" className="workspace-switch" onClick={() => onWorkspace(workspace)} title={`Switch to ${workspace.path}`}>
                    <Icon name="folder" size={14} />
                    <span>{workspace.title}</span>
                    <small>{rows.length}</small>
                  </button>
                  <button type="button" className="workspace-menu" onClick={event => { event.stopPropagation(); onWorkspaceMenu(workspace) }} aria-label={`Manage ${workspace.title}`} title="Workspace actions">
                    <Icon name="more" size={13} />
                  </button>
                </div>
              )}
              {(!closed || collapsed) && rows.map(session => row(session, workspace.workspaceId))}
            </section>
          )
        })}
        {ungrouped.filter(visible).length > 0 && (
          <section className="session-group">
            {!collapsed && <div className="group-label">Ungrouped</div>}
            {ungrouped.filter(visible)
              .sort((left, right) => Number(pinnedSessionIds.has(right.sessionId)) - Number(pinnedSessionIds.has(left.sessionId)))
              .map(session => row(session))}
          </section>
        )}
        {!collapsed && archivedRows.length > 0 && (
          <section className="session-group archived-group" data-collapsed={archivedClosed}>
            <button
              type="button"
              className="archived-heading"
              onClick={() => toggleGroup('__archived__')}
              aria-expanded={!archivedClosed}
            >
              <Icon name={archivedClosed ? 'chevron-right' : 'chevron-down'} size={13} />
              <Icon name="archive" size={14} />
              <span>Archived</span>
              <small>{archivedRows.length}</small>
            </button>
            {!archivedClosed && archivedRows.map(session => row(session, undefined, true))}
          </section>
        )}
      </div>

      <div className="sidebar-footer">
        <button type="button" className="footer-button" onClick={onPlugins} title="Manage plugins (⌘⇧P)">
          <Icon name="plug" size={16} />
          {!collapsed && <span>Plugins</span>}
          {!collapsed && pluginCount !== undefined && <small className="footer-count">{pluginCount}</small>}
        </button>
        <button type="button" className="footer-button" onClick={onSettings} title="Settings (⌘,)">
          <Icon name="settings" size={16} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  )
}
