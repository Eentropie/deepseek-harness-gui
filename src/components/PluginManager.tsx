import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon.tsx'
import type { PluginControlSnapshot, PluginEntry } from '../lib/types.ts'

type Filter = 'all' | 'enabled' | 'disabled'

interface PluginManagerProps {
  open: boolean
  snapshot?: PluginControlSnapshot
  loading: boolean
  changingId?: string
  error?: string
  lastBackup?: string
  onClose: () => void
  onRefresh: () => void
  onToggle: (entry: PluginEntry, enabled: boolean) => void
}

function shortModule(value: string): string {
  return value
    .replace(/^@deepseek-ai\/dsh-/, '')
    .replace(/^@deepseek-ai\/cordis-plugin-/, '')
}

function phaseLabel(entry: PluginEntry): string {
  if (!entry.enabled) return 'disabled'
  return entry.fiberPhase ?? 'enabled'
}

function phaseTone(entry: PluginEntry): string {
  if (!entry.enabled) return 'off'
  if (entry.fiberPhase === 'active') return 'active'
  if (entry.fiberPhase === 'failed') return 'failed'
  return 'waiting'
}

export function PluginManager({
  open,
  snapshot,
  loading,
  changingId,
  error,
  lastBackup,
  onClose,
  onRefresh,
  onToggle,
}: PluginManagerProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && changingId === undefined) onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [changingId, onClose, open])

  const entries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return [...(snapshot?.entries ?? [])]
      .filter(entry => filter === 'all' || (filter === 'enabled' ? entry.enabled : !entry.enabled))
      .filter(entry => needle === ''
        || entry.entryId.toLocaleLowerCase().includes(needle)
        || entry.moduleName.toLocaleLowerCase().includes(needle))
      .sort((left, right) => {
        if (left.controllable !== right.controllable) return left.controllable ? -1 : 1
        if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
        return shortModule(left.moduleName).localeCompare(shortModule(right.moduleName))
      })
  }, [filter, query, snapshot?.entries])

  const enabled = snapshot?.entries.filter(entry => entry.enabled).length ?? 0
  const controllable = snapshot?.entries.filter(entry => entry.controllable).length ?? 0

  if (!open) return null

  return (
    <div className="plugin-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && changingId === undefined) onClose()
    }}>
      <section className="plugin-drawer" role="dialog" aria-modal="true" aria-labelledby="plugins-title">
        <header className="plugin-header">
          <div className="plugin-title-mark"><Icon name="plug" size={18} /></div>
          <div className="plugin-title-copy">
            <p>LOCAL PROFILE · {snapshot?.profile ?? 'web'}</p>
            <h2 id="plugins-title">Plugins</h2>
          </div>
          <button type="button" className="icon-button quiet" onClick={onRefresh} aria-label="Refresh plugins" disabled={loading}>
            <Icon name="refresh" size={15} />
          </button>
          <button type="button" className="icon-button quiet" onClick={onClose} aria-label="Close plugins" disabled={changingId !== undefined}>
            <Icon name="x" size={15} />
          </button>
        </header>

        <div className="plugin-summary">
          <div><strong>{enabled}</strong><span>enabled</span></div>
          <div><strong>{controllable}</strong><span>switchable</span></div>
          <div><strong>{snapshot?.entries.length ?? 0}</strong><span>detected</span></div>
        </div>

        <div className="plugin-safety">
          <Icon name="lock" size={14} />
          <p><strong>Host source stays untouched.</strong> Switches are written to the <code>{snapshot?.profile ?? 'web'}</code> profile and applied by Harness HMR. Control and original localhost UI entries stay locked.</p>
        </div>

        <div className="plugin-toolbar">
          <label className="plugin-search">
            <Icon name="search" size={15} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search plugins or entry IDs" autoFocus />
          </label>
          <div className="plugin-filters" aria-label="Plugin filter">
            {(['all', 'enabled', 'disabled'] as const).map(value => (
              <button type="button" key={value} data-active={filter === value} onClick={() => setFilter(value)}>{value}</button>
            ))}
          </div>
        </div>

        {error !== undefined && (
          <div className="plugin-error"><strong>Plugin change was not applied</strong><span>{error}</span></div>
        )}
        {lastBackup !== undefined && error === undefined && (
          <div className="plugin-backup"><Icon name="check" size={13} />Applied · backup saved as <code>{lastBackup}</code></div>
        )}

        <div className="plugin-list" aria-busy={loading}>
          {loading && snapshot === undefined && (
            <div className="plugin-loading"><i /><span>Reading live Host inventory…</span></div>
          )}
          {!loading && entries.length === 0 && (
            <div className="plugin-empty"><Icon name="search" size={20} /><strong>No matching plugins</strong><span>Try a different name or status filter.</span></div>
          )}
          {entries.map(entry => {
            const changing = changingId === entry.entryId
            return (
              <article className="plugin-row" key={entry.entryId} data-protected={!entry.controllable}>
                <div className="plugin-glyph"><Icon name={entry.controllable ? 'plug' : 'lock'} size={15} /></div>
                <div className="plugin-copy">
                  <div className="plugin-name-line">
                    <strong>{shortModule(entry.moduleName)}</strong>
                    <span className="plugin-phase" data-tone={phaseTone(entry)}>{phaseLabel(entry)}</span>
                  </div>
                  <code>{entry.entryId}</code>
                  {!entry.controllable && <small>{entry.protectedReason}</small>}
                </div>
                <button
                  type="button"
                  className="plugin-switch"
                  role="switch"
                  aria-checked={entry.enabled}
                  aria-label={`${entry.enabled ? 'Disable' : 'Enable'} ${shortModule(entry.moduleName)}`}
                  disabled={!entry.controllable || changingId !== undefined}
                  data-enabled={entry.enabled}
                  data-changing={changing}
                  onClick={() => onToggle(entry, !entry.enabled)}
                  title={entry.controllable ? `One-click ${entry.enabled ? 'disable' : 'enable'}` : entry.protectedReason}
                >
                  <i />
                </button>
              </article>
            )
          })}
        </div>

        <footer className="plugin-footer">
          <span>Config</span><code>{snapshot?.configFile ?? '~/.dsh/profiles/web/cordis.patch.yml'}</code>
        </footer>
      </section>
    </div>
  )
}
