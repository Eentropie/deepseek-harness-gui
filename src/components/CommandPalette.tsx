import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon.tsx'
import type { SessionSummary, WorkspaceSummary } from '../lib/types.ts'

interface PaletteItem {
  id: string
  label: string
  detail: string
  section: 'Actions' | 'Work folders' | 'Recent sessions'
  icon: IconName
  shortcut?: string
  selected?: boolean
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  sessions: SessionSummary[]
  workspaces: WorkspaceSummary[]
  selectedId?: string
  dark: boolean
  inspectorOpen: boolean
  sidebarExpanded: boolean
  onClose: () => void
  onSession: (sessionId: string) => void
  onWorkspace: (workspace: WorkspaceSummary) => void
  onNew: () => void
  onOpenFolder: () => void
  onPlugins: () => void
  onSettings: () => void
  onTheme: () => void
  onInspector: () => void
  onSidebar: () => void
}

function sessionTitle(session: SessionSummary): string {
  const value = session.projections?.values.title
  return typeof value === 'string' && value.trim() !== '' ? value : 'New session'
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

export function CommandPalette({
  open,
  sessions,
  workspaces,
  selectedId,
  dark,
  inspectorOpen,
  sidebarExpanded,
  onClose,
  onSession,
  onWorkspace,
  onNew,
  onOpenFolder,
  onPlugins,
  onSettings,
  onTheme,
  onInspector,
  onSidebar,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo<PaletteItem[]>(() => {
    const closeThen = (action: () => void): (() => void) => () => {
      onClose()
      action()
    }
    return [
      {
        id: 'action:new', label: 'New session', detail: 'Start in the current work folder',
        section: 'Actions', icon: 'plus', shortcut: '⌘N', run: closeThen(onNew),
      },
      {
        id: 'action:folder', label: 'Open folder…', detail: 'Add or switch to a local work folder',
        section: 'Actions', icon: 'folder-plus', shortcut: '⌘O', run: closeThen(onOpenFolder),
      },
      {
        id: 'action:settings', label: 'Open Settings', detail: 'Appearance, layout, model, permissions, and Host',
        section: 'Actions', icon: 'settings', shortcut: '⌘,', run: closeThen(onSettings),
      },
      {
        id: 'action:plugins', label: 'Manage plugins', detail: 'One-click profile enable and disable',
        section: 'Actions', icon: 'plug', shortcut: '⌘⇧P', run: closeThen(onPlugins),
      },
      {
        id: 'action:sidebar', label: sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar', detail: 'Adjust the workbench layout',
        section: 'Actions', icon: 'panel-left', shortcut: '⌘B', run: closeThen(onSidebar),
      },
      {
        id: 'action:inspector', label: inspectorOpen ? 'Hide inspector' : 'Show inspector', detail: 'Context, tokens and activity',
        section: 'Actions', icon: 'panel-right', shortcut: '⌘⇧I', run: closeThen(onInspector),
      },
      {
        id: 'action:theme', label: dark ? 'Use light appearance' : 'Use dark appearance', detail: 'Switch workbench theme',
        section: 'Actions', icon: dark ? 'sun' : 'moon', run: closeThen(onTheme),
      },
      ...workspaces.map(workspace => ({
        id: `workspace:${workspace.workspaceId}`,
        label: workspace.title,
        detail: workspace.path,
        section: 'Work folders' as const,
        icon: 'folder' as const,
        run: closeThen(() => onWorkspace(workspace)),
      })),
      ...[...sessions]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(session => ({
          id: `session:${session.sessionId}`,
          label: sessionTitle(session),
          detail: `${session.agentPreset ?? 'standard'} · ${basename(session.cwd ?? 'Local')}`,
          section: 'Recent sessions' as const,
          icon: session.running ? 'activity' as const : 'terminal' as const,
          selected: session.sessionId === selectedId,
          run: closeThen(() => onSession(session.sessionId)),
        })),
    ]
  }, [dark, inspectorOpen, onClose, onInspector, onNew, onOpenFolder, onPlugins, onSession, onSettings, onSidebar, onTheme, onWorkspace, selectedId, sessions, sidebarExpanded, workspaces])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') return items.slice(0, 18)
    return items.filter(item => `${item.label} ${item.detail} ${item.section}`.toLocaleLowerCase().includes(needle)).slice(0, 24)
  }, [items, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (active < visible.length) return
    setActive(Math.max(0, visible.length - 1))
  }, [active, visible.length])

  if (!open) return null

  const grouped = new Map<PaletteItem['section'], PaletteItem[]>()
  visible.forEach(item => grouped.set(item.section, [...(grouped.get(item.section) ?? []), item]))
  let rowIndex = -1

  return (
    <div className="command-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Quick commands">
        <label className="command-input">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={event => { setQuery(event.target.value); setActive(0) }}
            placeholder="Search commands, folders, and sessions"
            aria-label="Search quick commands"
            onKeyDown={event => {
              if (event.key === 'Escape') onClose()
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive(value => visible.length === 0 ? 0 : (value + 1) % visible.length)
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive(value => visible.length === 0 ? 0 : (value - 1 + visible.length) % visible.length)
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                visible[active]?.run()
              }
            }}
          />
          <kbd>⌘K</kbd>
        </label>

        <div className="command-results">
          {visible.length === 0 && (
            <div className="command-empty"><Icon name="search" size={20} /><span>No matching command</span></div>
          )}
          {(['Actions', 'Work folders', 'Recent sessions'] as const).map(section => {
            const rows = grouped.get(section)
            if (rows === undefined) return null
            return (
              <section className="command-section" key={section}>
                <h3>{section}</h3>
                {rows.map(item => {
                  rowIndex += 1
                  const index = rowIndex
                  return (
                    <button
                      type="button"
                      className="command-row"
                      data-active={index === active}
                      data-selected={item.selected === true}
                      key={item.id}
                      onMouseEnter={() => setActive(index)}
                      onClick={item.run}
                    >
                      <span className="command-icon"><Icon name={item.icon} size={15} /></span>
                      <span className="command-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
                      {item.selected && <span className="command-current">Current</span>}
                      {item.shortcut !== undefined && <kbd>{item.shortcut}</kbd>}
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>

        <footer className="command-footer">
          <span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>esc</kbd> Close</span>
        </footer>
      </section>
    </div>
  )
}
