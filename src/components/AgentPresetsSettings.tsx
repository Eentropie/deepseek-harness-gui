import { useCallback, useEffect, useMemo, useState } from 'react'
import { harnessApi } from '../lib/api.ts'
import { copyDraftError, presetDisplay } from '../lib/presets.ts'
import type {
  AgentPresetDocument,
  AgentPresetEntry,
  AgentPresetRoster,
  SettingsDescription,
} from '../lib/types.ts'
import { Icon } from './Icon.tsx'

interface AgentPresetsSettingsProps {
  active: boolean
  currentPreset?: string
  currentSessionBlank: boolean
  onCreatorDraft: () => void
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function PresetBadge({ children, tone = 'plain' }: { children: string; tone?: 'plain' | 'active' | 'warning' }) {
  return <span className="preset-badge" data-tone={tone}>{children}</span>
}

export function AgentPresetsSettings({
  active,
  currentPreset,
  currentSessionBlank,
  onCreatorDraft,
}: AgentPresetsSettingsProps) {
  const [roster, setRoster] = useState<AgentPresetRoster>()
  const [settings, setSettings] = useState<SettingsDescription>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [changingId, setChangingId] = useState<string>()
  const [view, setView] = useState<AgentPresetDocument>()
  const [copySource, setCopySource] = useState<AgentPresetEntry>()
  const [copyId, setCopyId] = useState('')
  const [copyName, setCopyName] = useState('')
  const [copyError, setCopyError] = useState<string>()
  const [pendingDelete, setPendingDelete] = useState<AgentPresetEntry>()
  const [revealedPaths, setRevealedPaths] = useState<Record<string, string>>({})

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextRoster, nextSettings] = await Promise.all([
        harnessApi.agentPresets(),
        harnessApi.describeSettings(),
      ])
      setRoster(nextRoster)
      setSettings(nextSettings)
      setRevealedPaths(current => Object.fromEntries(
        Object.entries(current).filter(([id]) => nextRoster.presets.some(preset => preset.id === id)),
      ))
      setError(undefined)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) void load()
  }, [active, load])

  useEffect(() => {
    if (!active || (view === undefined && copySource === undefined && pendingDelete === undefined)) return
    const closeTopDialog = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (pendingDelete !== undefined) setPendingDelete(undefined)
      else if (copySource !== undefined) setCopySource(undefined)
      else setView(undefined)
    }
    window.addEventListener('keydown', closeTopDialog, true)
    return () => window.removeEventListener('keydown', closeTopDialog, true)
  }, [active, copySource, pendingDelete, view])

  const settingsNamespace = settings?.namespaces.find(namespace => namespace.ns === 'agent-presets')
  const writable = settings?.writable === true && settingsNamespace !== undefined
  const builtIn = useMemo(() => roster?.presets.filter(preset => preset.trust === 'system') ?? [], [roster])
  const custom = useMemo(() => roster?.presets.filter(preset => preset.trust === 'user') ?? [], [roster])

  const makeDefault = async (entry: AgentPresetEntry): Promise<void> => {
    if (!writable || entry.isDefault || entry.broken !== undefined || changingId !== undefined) return
    setChangingId(entry.id)
    setError(undefined)
    try {
      await harnessApi.updateAgentPresetDefault(entry.id, settingsNamespace?.revision)
      await load()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setChangingId(undefined)
    }
  }

  const openConfiguration = async (): Promise<void> => {
    setError(undefined)
    try {
      await harnessApi.openSettingsDocument()
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  const openView = async (entry: AgentPresetEntry): Promise<void> => {
    setChangingId(entry.id)
    setError(undefined)
    try {
      setView(await harnessApi.readAgentPreset(entry.id))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setChangingId(undefined)
    }
  }

  const openLocation = async (entry: AgentPresetEntry): Promise<void> => {
    setChangingId(entry.id)
    setError(undefined)
    try {
      const result = await harnessApi.openAgentPreset(entry.id)
      if (!result.opened && result.path !== undefined) {
        setRevealedPaths(current => ({ ...current, [entry.id]: result.path as string }))
      }
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setChangingId(undefined)
    }
  }

  const beginCopy = (entry: AgentPresetEntry): void => {
    setCopySource(entry)
    setCopyId('')
    setCopyName('')
    setCopyError(undefined)
  }

  const submitCopy = async (): Promise<void> => {
    if (copySource === undefined || roster === undefined || changingId !== undefined) return
    const id = copyId.trim()
    const blocker = copyDraftError(id, roster.presets)
    if (blocker !== undefined) {
      setCopyError(blocker)
      return
    }
    setChangingId(copySource.id)
    setCopyError(undefined)
    try {
      await harnessApi.copyAgentPreset(copySource.id, id, copyName.trim() === '' ? undefined : copyName.trim())
      setCopySource(undefined)
      await load()
      const opened = await harnessApi.openAgentPreset(id)
      if (!opened.opened && opened.path !== undefined) {
        setRevealedPaths(current => ({ ...current, [id]: opened.path as string }))
      }
    } catch (reason) {
      setCopyError(errorText(reason))
    } finally {
      setChangingId(undefined)
    }
  }

  const removePreset = async (): Promise<void> => {
    if (pendingDelete === undefined || changingId !== undefined) return
    const target = pendingDelete
    setChangingId(target.id)
    setError(undefined)
    try {
      await harnessApi.removeAgentPreset(target.id)
      setPendingDelete(undefined)
      await load()
    } catch (reason) {
      setPendingDelete(undefined)
      setError(errorText(reason))
    } finally {
      setChangingId(undefined)
    }
  }

  const renderCard = (entry: AgentPresetEntry) => {
    const text = presetDisplay(entry)
    const changing = changingId === entry.id
    return (
      <article
        className="preset-card"
        data-active={entry.isDefault}
        data-broken={entry.broken !== undefined}
        key={entry.id}
      >
        <button
          type="button"
          className="preset-card-main"
          aria-pressed={entry.isDefault}
          aria-label={`${entry.isDefault ? 'In use' : 'Set as default'}: ${text.name}`}
          disabled={!writable || entry.isDefault || entry.broken !== undefined || changingId !== undefined}
          onClick={() => { void makeDefault(entry) }}
        >
          <span className="preset-card-head">
            <strong>{text.name}</strong>
            <PresetBadge>{entry.trust === 'system' ? 'Built-in' : 'Custom'}</PresetBadge>
            {entry.isDefault && <PresetBadge tone="active">In use</PresetBadge>}
            {entry.id === currentPreset && <PresetBadge tone="plain">Current session</PresetBadge>}
            {entry.broken !== undefined && <PresetBadge tone="warning">Failed to load</PresetBadge>}
          </span>
          <span className="preset-card-description">{text.description ?? 'No description provided.'}</span>
          {entry.broken !== undefined && <span className="preset-card-error" role="alert">{entry.broken}</span>}
          <code>{entry.id}</code>
        </button>
        <footer className="preset-card-footer">
          {entry.trust === 'system' ? (
            <button type="button" disabled={entry.broken !== undefined || changing} aria-label={`View ${text.name}`} title="View composition" onClick={() => { void openView(entry) }}>
              <Icon name="document" size={16} />
            </button>
          ) : (
            <button type="button" disabled={changing} aria-label={`Open ${text.name} files`} title="Open preset files" onClick={() => { void openLocation(entry) }}>
              <Icon name="folder" size={16} />
            </button>
          )}
          <button type="button" disabled={!roster?.authorable || entry.broken !== undefined || changingId !== undefined} aria-label={`Duplicate ${text.name}`} title="Duplicate preset" onClick={() => beginCopy(entry)}>
            <Icon name="copy" size={16} />
          </button>
          {entry.trust === 'user' && (
            <button type="button" className="preset-danger" disabled={changingId !== undefined} aria-label={`Delete ${text.name}`} title="Delete preset" onClick={() => setPendingDelete(entry)}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </footer>
        {revealedPaths[entry.id] !== undefined && <p className="preset-path"><span>Preset files</span><code>{revealedPaths[entry.id]}</code></p>}
      </article>
    )
  }

  const copyBlocker = roster === undefined ? undefined : copyDraftError(copyId.trim(), roster.presets)
  const sourceText = copySource === undefined ? undefined : presetDisplay(copySource)
  const viewText = view === undefined
    ? undefined
    : presetDisplay({ id: view.agentPreset, trust: view.trust, name: view.name, description: view.description })

  return (
    <section className="settings-page preset-settings-page">
      <div className="preset-page-heading">
        <div className="settings-page-heading">
          <p>AGENT COMPOSITION</p>
          <h3>Agent presets</h3>
          <span>A preset defines the tools, prompt, and capabilities used by a session. Selecting a card changes the default for new sessions; existing conversations stay unchanged.</span>
        </div>
        <button type="button" className="settings-button preset-config-button" disabled={loading || settings?.hasDocument !== true} onClick={() => { void openConfiguration() }}>
          <Icon name="document" size={14} />Open configuration file
        </button>
      </div>

      {currentPreset !== undefined && (
        <div className="preset-current-note">
          <Icon name="agent" size={15} />
          <span>Current session uses <strong>{presetDisplay(roster?.presets.find(entry => entry.id === currentPreset) ?? { id: currentPreset, trust: 'system' }).name}</strong>{currentSessionBlank ? ' and is still blank.' : '.'}</span>
        </div>
      )}
      {error !== undefined && <div className="preset-inline-error" role="alert"><span>{error}</span><button type="button" onClick={() => { void load() }}>Retry</button></div>}

      {loading && roster === undefined ? (
        <div className="settings-empty">Loading the Host preset roster…</div>
      ) : roster === undefined || roster.presets.length === 0 ? (
        <div className="settings-empty">This Harness profile does not expose agent presets.</div>
      ) : (
        <>
          <section className="preset-group" aria-labelledby="preset-built-in-title">
            <h4 id="preset-built-in-title">BUILT-IN</h4>
            <div className="preset-grid">{builtIn.map(renderCard)}</div>
          </section>
          <section className="preset-group" aria-labelledby="preset-custom-title">
            <h4 id="preset-custom-title">CUSTOM</h4>
            {custom.length > 0 && <div className="preset-grid">{custom.map(renderCard)}</div>}
            <button
              type="button"
              className="preset-creator-button"
              disabled={!roster.authorable || !roster.presets.some(entry => entry.id === 'cordis')}
              onClick={onCreatorDraft}
            >
              <Icon name="plus" size={17} />
              <span>Draft a custom preset with Creator mode</span>
            </button>
          </section>
        </>
      )}

      {copySource !== undefined && (
        <div className="preset-dialog-layer preset-subdialog" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget && changingId === undefined) setCopySource(undefined)
        }}>
          <section className="preset-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-copy-title">
            <header><div><p>CUSTOM PRESET</p><h4 id="preset-copy-title">Duplicate {sourceText?.name}</h4></div><button type="button" aria-label="Close duplicate dialog" onClick={() => setCopySource(undefined)}><Icon name="x" size={15} /></button></header>
            <p>Harness copies the complete preset directory. Edit the copied files after creation.</p>
            <label><span>Identifier</span><input autoFocus spellCheck={false} placeholder="my-agent" value={copyId} onChange={event => { setCopyId(event.target.value); setCopyError(undefined) }} /></label>
            <label><span>Display name <small>Optional</small></span><input spellCheck={false} placeholder="My agent" value={copyName} onChange={event => { setCopyName(event.target.value); setCopyError(undefined) }} /></label>
            {(copyError ?? (copyId === '' ? undefined : copyBlocker)) !== undefined && <div className="preset-dialog-error" role="alert">{copyError ?? copyBlocker}</div>}
            <footer><button type="button" className="settings-button" disabled={changingId !== undefined} onClick={() => setCopySource(undefined)}>Cancel</button><button type="button" className="settings-button primary" disabled={changingId !== undefined || copyBlocker !== undefined} onClick={() => { void submitCopy() }}>{changingId !== undefined ? 'Creating…' : 'Create copy'}</button></footer>
          </section>
        </div>
      )}

      {view !== undefined && (
        <div className="preset-dialog-layer preset-subdialog" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setView(undefined) }}>
          <section className="preset-dialog preset-view-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-view-title">
            <header><div><p>READ-ONLY COMPOSITION</p><h4 id="preset-view-title">{viewText?.name}</h4></div><button type="button" aria-label="Close composition viewer" onClick={() => setView(undefined)}><Icon name="x" size={15} /></button></header>
            <pre>{view.content}</pre>
            <footer><button type="button" className="settings-button" onClick={() => setView(undefined)}>Close</button></footer>
          </section>
        </div>
      )}

      {pendingDelete !== undefined && (
        <div className="preset-dialog-layer preset-subdialog" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && changingId === undefined) setPendingDelete(undefined) }}>
          <section className="preset-dialog preset-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="preset-delete-title">
            <header><div><p>CUSTOM PRESET</p><h4 id="preset-delete-title">Delete {presetDisplay(pendingDelete).name}?</h4></div></header>
            <p>This removes the local preset directory. Existing sessions keep their mounted composition.</p>
            <footer><button type="button" className="settings-button" autoFocus disabled={changingId !== undefined} onClick={() => setPendingDelete(undefined)}>Cancel</button><button type="button" className="settings-button preset-delete-confirm" disabled={changingId !== undefined} onClick={() => { void removePreset() }}>{changingId !== undefined ? 'Deleting…' : 'Delete preset'}</button></footer>
          </section>
        </div>
      )}
    </section>
  )
}
