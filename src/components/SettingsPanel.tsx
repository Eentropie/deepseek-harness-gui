import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'
import { WhaleLogo } from './WhaleLogo.tsx'
import { desktopArchitecture, desktopPlatform, platformDisplayName, shortcutLabel } from '../lib/platform.ts'
import { AgentPresetsSettings } from './AgentPresetsSettings.tsx'
import { HarnessSettings } from './HarnessSettings.tsx'
import { ModelsCredentialsSettings } from './ModelsCredentialsSettings.tsx'
import { UsageBillingSettings } from './UsageBillingSettings.tsx'
import type { HostDescription, PermissionOption, PluginControlSnapshot, SessionModels } from '../lib/types.ts'

export type ThemeMode = 'system' | 'light' | 'dark'
export type InterfaceDensity = 'comfortable' | 'compact'
export type LocalFontStatus = 'checking' | 'pair' | 'sans' | 'fallback'

type SettingsSection = 'general' | 'appearance' | 'model' | 'usage' | 'providers' | 'presets' | 'plugins' | 'harness' | 'host' | 'shortcuts' | 'about'

interface SettingsPanelProps {
  open: boolean
  themeMode: ThemeMode
  density: InterfaceDensity
  responseSerif: boolean
  reduceMotion: boolean
  resumeLastSession: boolean
  sidebarExpanded: boolean
  inspectorOpen: boolean
  currentFolder: string
  models?: SessionModels
  permissionOptions: PermissionOption[]
  permission?: string
  busy: boolean
  running: boolean
  currentPreset?: string
  currentSessionBlank: boolean
  plugins?: PluginControlSnapshot
  host?: HostDescription
  connection: 'connecting' | 'connected' | 'reconnecting'
  offline: boolean
  fontStatus: LocalFontStatus
  onClose: () => void
  onThemeMode: (mode: ThemeMode) => void
  onDensity: (density: InterfaceDensity) => void
  onResponseSerif: (enabled: boolean) => void
  onReduceMotion: (enabled: boolean) => void
  onResumeLastSession: (enabled: boolean) => void
  onSidebar: (visible: boolean) => void
  onInspector: (visible: boolean) => void
  onOpenFolder: () => void
  onModel: (provider: string, model: string) => void
  onEffort: (effort: string) => void
  onPermission: (preset: string) => void
  onCreatorPresetDraft: () => void
  onPlugins: () => void
  onRefreshHost: () => void
}

const sections: Array<{ id: SettingsSection; label: string; icon: IconName | 'whale' }> = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'model', label: 'Model & permissions', icon: 'brain' },
  { id: 'usage', label: 'Usage & billing', icon: 'activity' },
  { id: 'providers', label: 'Models & credentials', icon: 'key' },
  { id: 'presets', label: 'Agent presets', icon: 'agent' },
  { id: 'plugins', label: 'Plugins', icon: 'plug' },
  { id: 'harness', label: 'Harness settings', icon: 'sliders' },
  { id: 'host', label: 'Local Host', icon: 'whale' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'sparkles' },
  { id: 'about', label: 'About', icon: 'activity' },
]

function Toggle({ checked, label, disabled = false, onChange }: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      className="settings-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-enabled={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  )
}

function Row({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy"><strong>{title}</strong><span>{detail}</span></div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function Segmented<T extends string>({ value, values, label, onChange }: {
  value: T
  values: Array<{ value: T; label: string }>
  label: string
  onChange: (value: T) => void
}) {
  return (
    <div className="settings-segmented" aria-label={label}>
      {values.map(option => (
        <button type="button" key={option.value} data-active={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

function platformShortcuts(): string[][] {
  return [
    [shortcutLabel('K'), 'Open command palette'],
    [shortcutLabel('O'), 'Add or switch work folder'],
    [shortcutLabel('N'), 'Create a new session'],
    [shortcutLabel('B'), 'Collapse or expand sidebar'],
    [shortcutLabel('I', true), 'Hide or show inspector'],
    [shortcutLabel('P', true), 'Open plugin manager'],
    [shortcutLabel(','), 'Open Settings'],
    ['Esc', 'Close the active overlay'],
  ]
}

export function SettingsPanel({
  open,
  themeMode,
  density,
  responseSerif,
  reduceMotion,
  resumeLastSession,
  sidebarExpanded,
  inspectorOpen,
  currentFolder,
  models,
  permissionOptions,
  permission,
  busy,
  running,
  currentPreset,
  currentSessionBlank,
  plugins,
  host,
  connection,
  offline,
  fontStatus,
  onClose,
  onThemeMode,
  onDensity,
  onResponseSerif,
  onReduceMotion,
  onResumeLastSession,
  onSidebar,
  onInspector,
  onOpenFolder,
  onModel,
  onEffort,
  onPermission,
  onCreatorPresetDraft,
  onPlugins,
  onRefreshHost,
}: SettingsPanelProps) {
  const [section, setSection] = useState<SettingsSection>('general')
  const currentModel = useMemo(() => models?.groups
    .flatMap(group => group.models.map(model => ({ ...model, provider: group.id })))
    .find(model => model.provider === models.current.provider && model.id === models.current.model), [models])
  const efforts = currentModel?.reasoning?.efforts ?? []
  const enabledPlugins = plugins?.entries.filter(entry => entry.enabled).length ?? 0
  const switchablePlugins = plugins?.entries.filter(entry => entry.controllable).length ?? 0
  const platform = desktopPlatform()
  const platformName = platformDisplayName()
  const architecture = desktopArchitecture()
  const shortcuts = platformShortcuts()

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, open])

  if (!open) return null

  const fontLabel = fontStatus === 'pair'
    ? 'Local Sans + Serif active'
    : fontStatus === 'sans'
      ? 'Local Sans active · Serif fallback'
      : fontStatus === 'fallback'
        ? platform === 'win32' ? 'Segoe UI / system fallback active' : 'SF Pro / system fallback active'
        : 'Checking local typefaces…'

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="settings-window" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-header">
          <div className="settings-title-mark"><Icon name="settings" size={18} /></div>
          <div><p>DEEPSEEK HARNESS</p><h2 id="settings-title">Settings</h2></div>
          <span>Changes save automatically</span>
          <button type="button" className="icon-button quiet" onClick={onClose} aria-label="Close Settings"><Icon name="x" size={15} /></button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map(item => (
              <button type="button" key={item.id} data-active={section === item.id} onClick={() => setSection(item.id)}>
                {item.icon === 'whale' ? <WhaleLogo size={16} /> : <Icon name={item.icon} size={15} />}<span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {section === 'general' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>HARNESS</p><h3>General</h3><span>Startup, workspace, and window behavior.</span></div>
                <div className="settings-card">
                  <Row title="Resume last session" detail="Reopen the last selected Harness session on launch.">
                    <Toggle checked={resumeLastSession} label="Resume last session" onChange={onResumeLastSession} />
                  </Row>
                  <Row title="Sidebar" detail="Show work folders and sessions by default.">
                    <Toggle checked={sidebarExpanded} label="Show sidebar" onChange={onSidebar} />
                  </Row>
                  <Row title="Context inspector" detail="Show runtime, token, session, and activity details.">
                    <Toggle checked={inspectorOpen} label="Show context inspector" onChange={onInspector} />
                  </Row>
                </div>
                <div className="settings-card">
                  <Row title="Current work folder" detail={currentFolder}>
                    <button type="button" className="settings-button" onClick={onOpenFolder}><Icon name="folder-plus" size={14} />Open folder…</button>
                  </Row>
                </div>
              </section>
            )}

            {section === 'appearance' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>INTERFACE</p><h3>Appearance</h3><span>Theme mode, density, typography, and motion.</span></div>
                <div className="settings-card">
                  <Row title="Color mode" detail="System follows the current operating-system appearance.">
                    <Segmented
                      value={themeMode}
                      label="Color mode"
                      values={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
                      onChange={onThemeMode}
                    />
                  </Row>
                  <Row title="Interface density" detail="Compact fits more sessions and plugin rows on screen.">
                    <Segmented
                      value={density}
                      label="Interface density"
                      values={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
                      onChange={onDensity}
                    />
                  </Row>
                  <Row title="Serif assistant responses" detail="Use the local Sans + Serif pairing for clearer visual hierarchy.">
                    <Toggle checked={responseSerif} label="Use serif assistant responses" onChange={onResponseSerif} />
                  </Row>
                  <Row title="Reduce motion" detail="Disable drawer, palette, pulse, and loading animations.">
                    <Toggle checked={reduceMotion} label="Reduce interface motion" onChange={onReduceMotion} />
                  </Row>
                </div>
                <div className="settings-type-preview" data-serif={responseSerif}>
                  <div><span>TYPOGRAPHY</span><small>{fontLabel}</small></div>
                  <strong>Build clearly. Think deeply.</strong>
                  <p>Interface labels remain precise; assistant prose gets a distinct reading voice.</p>
                </div>
              </section>
            )}

            {section === 'model' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>CURRENT SESSION</p><h3>Model & permissions</h3><span>These controls call the existing Harness session APIs.</span></div>
                {models === undefined ? (
                  <div className="settings-empty">Select a connected session to configure its model.</div>
                ) : (
                  <div className="settings-card">
                    <Row title="Model" detail="Provider and model used by the current session.">
                      <label className="settings-select settings-select-provider"><ProviderLogo provider={models.current.provider} name={currentModel?.name} size={15} /><select value={`${models.current.provider}::${models.current.model}`} disabled={busy} onChange={event => {
                        const [provider = '', model = ''] = event.target.value.split('::')
                        onModel(provider, model)
                      }}>
                        {models.groups.map(group => <optgroup label={group.name} key={group.id}>{group.models.map(model => <option value={`${group.id}::${model.id}`} key={`${group.id}-${model.id}`}>{model.name}</option>)}</optgroup>)}
                      </select><Icon name="chevron-down" size={12} /></label>
                    </Row>
                    <Row title="Reasoning effort" detail="Higher effort can improve difficult coding and planning tasks.">
                      {efforts.length === 0 ? <span className="settings-unavailable">Not offered by this model</span> : (
                        <label className="settings-select"><select value={models.current.reasoningEffort ?? currentModel?.reasoning?.defaultEffort ?? ''} disabled={busy} onChange={event => onEffort(event.target.value)}>{efforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}</select><Icon name="chevron-down" size={12} /></label>
                      )}
                    </Row>
                    <Row title="Permission mode" detail="Controls approval routing and sandbox access for the selected provider.">
                      {permission === undefined || permissionOptions.length === 0 ? <span className="settings-unavailable">Unavailable</span> : (
                        <label className="settings-select"><select value={permission} disabled={busy} onChange={event => onPermission(event.target.value)}>{permissionOptions.map(option => <option value={option.value} key={option.value}>{option.name}</option>)}</select><Icon name="chevron-down" size={12} /></label>
                      )}
                    </Row>
                  </div>
                )}
                {models?.failures.map(failure => (
                  <div className="settings-note model-failure-note" key={failure.id}><Icon name="activity" size={14} /><span><strong>{failure.name}</strong> · {failure.message}</span></div>
                ))}
                {running && <div className="settings-note"><Icon name="activity" size={14} /><span>Changes are saved now and apply from the next model step or turn.</span></div>}
                <div className="settings-note"><Icon name="lock" size={14} /><span>Settings do not add permissions beyond the options exposed by the selected Harness session.</span></div>
              </section>
            )}

            {section === 'usage' && (
              <UsageBillingSettings active={open && section === 'usage'} />
            )}

            {section === 'plugins' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>LOCAL PROFILE</p><h3>Plugins</h3><span>Inspect and safely switch profile-composed extensions.</span></div>
                <div className="settings-stat-grid">
                  <div><strong>{enabledPlugins}</strong><span>Enabled</span></div>
                  <div><strong>{switchablePlugins}</strong><span>Switchable</span></div>
                  <div><strong>{plugins?.entries.length ?? '—'}</strong><span>Detected</span></div>
                </div>
                <div className="settings-card">
                  <Row title="Plugin manager" detail="Control entries stay locked to protect Host RPC and the original localhost UI.">
                    <button type="button" className="settings-button primary" onClick={onPlugins}><Icon name="plug" size={14} />Open manager</button>
                  </Row>
                  <Row title="Profile patch" detail={plugins?.configFile ?? '~/.dsh/profiles/web/cordis.patch.yml'}>
                    <span className="settings-state">HMR managed</span>
                  </Row>
                </div>
              </section>
            )}

            {section === 'providers' && (
              <ModelsCredentialsSettings active={open && section === 'providers'} />
            )}

            {section === 'harness' && (
              <HarnessSettings active={open && section === 'harness'} />
            )}

            {section === 'presets' && (
              <AgentPresetsSettings
                active={open && section === 'presets'}
                currentPreset={currentPreset}
                currentSessionBlank={currentSessionBlank}
                onCreatorDraft={onCreatorPresetDraft}
              />
            )}

            {section === 'host' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>RUNTIME</p><h3>Local Host</h3><span>The endpoint remains fixed to the unmodified local Harness Host.</span></div>
                <div className="settings-host-card">
                  <div className="settings-host-icon"><WhaleLogo size={24} /></div>
                  <div><strong>127.0.0.1:3080</strong><span>{offline ? 'Offline' : connection === 'connected' ? 'Connected locally' : connection}</span></div>
                  <i data-state={offline ? 'offline' : connection} />
                </div>
                <div className="settings-card">
                  <Row title="Harness version" detail="Reported by host.describe"><code>{host?.version ?? '—'}</code></Row>
                  <Row title="Host working directory" detail="Read-only runtime description"><code>{host?.cwd ?? 'Unavailable'}</code></Row>
                  <Row title="Connection" detail="Refresh Host, workspaces, sessions, and projections.">
                    <button type="button" className="settings-button" onClick={onRefreshHost}><Icon name="refresh" size={14} />Reconnect</button>
                  </Row>
                </div>
              </section>
            )}

            {section === 'shortcuts' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>KEYBOARD</p><h3>Shortcuts</h3><span>Primary desktop actions remain available without the mouse.</span></div>
                <div className="settings-shortcuts">{shortcuts.map(([keys, action]) => <div key={keys}><kbd>{keys}</kbd><span>{action}</span></div>)}</div>
              </section>
            )}

            {section === 'about' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>LOCAL DESKTOP CLIENT</p><h3>About</h3><span>Independent companion UI for DeepSeek Harness.</span></div>
                <div className="settings-about">
                  <div className="settings-about-whale"><WhaleLogo size={38} /></div>
                  <div><strong>DeepSeek Harness</strong><span>Version 0.2.1 · {platformName} {architecture}</span></div>
                </div>
                <div className="settings-card">
                  <Row title="Host source" detail="The upstream repository and localhost UI are not modified."><span className="settings-state">Untouched</span></Row>
                  <Row title="Renderer security" detail="Context isolation, sandbox, no Node integration, allowlisted IPC."><span className="settings-state">Restricted</span></Row>
                  <Row title="Signing" detail={platform === 'win32' ? 'Local development build; no Authenticode certificate.' : 'Local development build; no platform signing identity.'}><span className="settings-state">Unsigned</span></Row>
                </div>
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
