import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'
import { WhaleLogo } from './WhaleLogo.tsx'
import { desktopArchitecture, desktopPlatform, platformDisplayName, shortcutLabel } from '../lib/platform.ts'
import { AgentPresetsSettings } from './AgentPresetsSettings.tsx'
import { HarnessSettings } from './HarnessSettings.tsx'
import { ModelsCredentialsSettings } from './ModelsCredentialsSettings.tsx'
import { UsageBillingSettings } from './UsageBillingSettings.tsx'
import type { HostDescription, PermissionOption, PluginControlSnapshot, SessionModels, SessionSummary } from '../lib/types.ts'
import { useI18n } from '../lib/i18n.tsx'

export type ThemeMode = 'system' | 'light' | 'dark'
export type InterfaceDensity = 'comfortable' | 'compact'
export type LocalFontStatus = 'checking' | 'pair' | 'sans' | 'fallback'

type SettingsSection = 'general' | 'appearance' | 'model' | 'usage' | 'providers' | 'presets' | 'plugins' | 'harness' | 'archived' | 'host' | 'shortcuts' | 'about'

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
  archivedSessions: SessionSummary[]
  effectivePermission?: string
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
  onArchivedSession: (sessionId: string) => void
  onArchivedMenu: (session: SessionSummary) => void
}

const sections: Array<{ id: SettingsSection; label: [string, string]; icon: IconName | 'whale' }> = [
  { id: 'general', label: ['General', '通用'], icon: 'settings' },
  { id: 'appearance', label: ['Appearance', '外观'], icon: 'sun' },
  { id: 'model', label: ['Model & permissions', '模型与权限'], icon: 'brain' },
  { id: 'usage', label: ['Usage & billing', '用量与计费'], icon: 'activity' },
  { id: 'providers', label: ['Models & credentials', '模型与凭据'], icon: 'key' },
  { id: 'presets', label: ['Agent presets', 'Agent 预设'], icon: 'agent' },
  { id: 'plugins', label: ['Plugins', '插件'], icon: 'plug' },
  { id: 'harness', label: ['Harness settings', 'Harness 设置'], icon: 'sliders' },
  { id: 'archived', label: ['Archived chats', '已归档对话'], icon: 'archive' },
  { id: 'host', label: ['Local Host', '本地 Host'], icon: 'whale' },
  { id: 'shortcuts', label: ['Shortcuts', '快捷键'], icon: 'sparkles' },
  { id: 'about', label: ['About', '关于'], icon: 'activity' },
]

function archivedTitle(session: SessionSummary): string {
  const title = session.projections?.values.title
  return typeof title === 'string' && title.trim() !== '' ? title : 'New session'
}

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

function codexPermissionDetail(
  running: boolean,
  effective: string | undefined,
  selected: string | undefined,
  tr: (english: string, chinese: string) => string,
): string {
  if (!running || effective === undefined) return tr('Controls approval routing and sandbox access for the selected provider.', '控制所选来源的审批路由与沙箱访问。')
  if (effective === selected) return `${tr('Current turn effective permission', '本轮实际权限')} · ${effective}`
  return `${tr('Current turn', '本轮')} · ${effective} · ${tr('Next turn', '下一轮')} · ${selected ?? '—'}`
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
  archivedSessions,
  effectivePermission,
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
  onArchivedSession,
  onArchivedMenu,
}: SettingsPanelProps) {
  const { locale, setLocale, tr } = useI18n()
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
          <div><p>DEEPSEEK HARNESS</p><h2 id="settings-title">{tr('Settings', '设置')}</h2></div>
          <span>{tr('Changes save automatically', '更改会自动保存')}</span>
          <button type="button" className="icon-button quiet" onClick={onClose} aria-label={tr('Close Settings', '关闭设置')}><Icon name="x" size={15} /></button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map(item => (
              <button type="button" key={item.id} data-active={section === item.id} onClick={() => setSection(item.id)}>
                {item.icon === 'whale' ? <WhaleLogo size={16} /> : <Icon name={item.icon} size={15} />}<span>{tr(item.label[0], item.label[1])}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {section === 'general' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>HARNESS</p><h3>{tr('General', '通用')}</h3><span>{tr('Startup, workspace, and window behavior.', '启动、工作区与窗口行为。')}</span></div>
                <div className="settings-card">
                  <Row title={tr('Interface language', '界面语言')} detail={tr('Switch immediately without restarting the app.', '无需重启，立即切换中英文界面。')}>
                    <Segmented value={locale} label={tr('Interface language', '界面语言')} values={[{ value: 'en', label: 'English' }, { value: 'zh', label: '中文' }]} onChange={setLocale} />
                  </Row>
                  <Row title={tr('Resume last session', '恢复上次会话')} detail={tr('Reopen the last selected Harness session on launch.', '启动时重新打开上次选择的 Harness 会话。')}>
                    <Toggle checked={resumeLastSession} label={tr('Resume last session', '恢复上次会话')} onChange={onResumeLastSession} />
                  </Row>
                  <Row title={tr('Sidebar', '侧边栏')} detail={tr('Show work folders and sessions by default.', '默认显示工作文件夹与会话。')}>
                    <Toggle checked={sidebarExpanded} label={tr('Show sidebar', '显示侧边栏')} onChange={onSidebar} />
                  </Row>
                  <Row title={tr('Context inspector', '上下文检查器')} detail={tr('Show runtime, token, session, and activity details.', '显示运行时、Token、会话和活动详情。')}>
                    <Toggle checked={inspectorOpen} label={tr('Show context inspector', '显示上下文检查器')} onChange={onInspector} />
                  </Row>
                </div>
                <div className="settings-card">
                  <Row title={tr('Current work folder', '当前工作文件夹')} detail={currentFolder}>
                    <button type="button" className="settings-button" onClick={onOpenFolder}><Icon name="folder-plus" size={14} />{tr('Open folder…', '打开文件夹…')}</button>
                  </Row>
                </div>
              </section>
            )}

            {section === 'appearance' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>INTERFACE</p><h3>{tr('Appearance', '外观')}</h3><span>{tr('Theme mode, density, typography, and motion.', '主题、密度、字体与动效。')}</span></div>
                <div className="settings-card">
                  <Row title={tr('Color mode', '颜色模式')} detail={tr('System follows the current operating-system appearance.', '“系统”会跟随操作系统当前外观。')}>
                    <Segmented
                      value={themeMode}
                      label={tr('Color mode', '颜色模式')}
                      values={[{ value: 'system', label: tr('System', '系统') }, { value: 'light', label: tr('Light', '浅色') }, { value: 'dark', label: tr('Dark', '深色') }]}
                      onChange={onThemeMode}
                    />
                  </Row>
                  <Row title={tr('Interface density', '界面密度')} detail={tr('Compact fits more sessions and plugin rows on screen.', '紧凑模式可在屏幕中容纳更多会话和插件行。')}>
                    <Segmented
                      value={density}
                      label={tr('Interface density', '界面密度')}
                      values={[{ value: 'comfortable', label: tr('Comfortable', '舒适') }, { value: 'compact', label: tr('Compact', '紧凑') }]}
                      onChange={onDensity}
                    />
                  </Row>
                  <Row title={tr('Serif assistant responses', '回答使用衬线字体')} detail={tr('Use the local Sans + Serif pairing for clearer visual hierarchy.', '使用本地无衬线与衬线字体组合，建立更清晰的视觉层级。')}>
                    <Toggle checked={responseSerif} label={tr('Use serif assistant responses', '回答使用衬线字体')} onChange={onResponseSerif} />
                  </Row>
                  <Row title={tr('Reduce motion', '减少动态效果')} detail={tr('Disable drawer, palette, pulse, and loading animations.', '停用抽屉、面板、脉冲和加载动效。')}>
                    <Toggle checked={reduceMotion} label={tr('Reduce interface motion', '减少界面动效')} onChange={onReduceMotion} />
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
                <div className="settings-page-heading"><p>{tr('CURRENT SESSION', '当前会话')}</p><h3>{tr('Model & permissions', '模型与权限')}</h3><span>{tr('These controls call the existing Harness session APIs.', '这些控件调用现有 Harness 会话 API。')}</span></div>
                {models === undefined ? (
                  <div className="settings-empty">Select a connected session to configure its model.</div>
                ) : (
                  <div className="settings-card">
                    <Row title={tr('Model', '模型')} detail={tr('Provider and model used by the current session.', '当前会话使用的模型来源与模型。')}>
                      <label className="settings-select settings-select-provider"><ProviderLogo provider={models.current.provider} name={currentModel?.name} size={15} /><select value={`${models.current.provider}::${models.current.model}`} disabled={busy} onChange={event => {
                        const [provider = '', model = ''] = event.target.value.split('::')
                        onModel(provider, model)
                      }}>
                        {models.groups.map(group => <optgroup label={group.name} key={group.id}>{group.models.map(model => <option value={`${group.id}::${model.id}`} key={`${group.id}-${model.id}`}>{model.name}</option>)}</optgroup>)}
                      </select><Icon name="chevron-down" size={12} /></label>
                    </Row>
                    <Row title={tr('Reasoning effort', '推理强度')} detail={tr('Higher effort can improve difficult coding and planning tasks.', '更高推理强度可改善困难的编码与规划任务。')}>
                      {efforts.length === 0 ? <span className="settings-unavailable">Not offered by this model</span> : (
                        <label className="settings-select"><select value={models.current.reasoningEffort ?? currentModel?.reasoning?.defaultEffort ?? ''} disabled={busy} onChange={event => onEffort(event.target.value)}>{efforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}</select><Icon name="chevron-down" size={12} /></label>
                      )}
                    </Row>
                    <Row title={tr('Permission mode', '权限模式')} detail={codexPermissionDetail(running, effectivePermission, permission, tr)}>
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

            {section === 'archived' && (
              <section className="settings-page">
                <div className="settings-page-heading"><p>{tr('HISTORY', '历史记录')}</p><h3>{tr('Archived chats', '已归档对话')}</h3><span>{tr('Archived sessions stay out of the main sidebar.', '归档会话不会显示在主侧边栏。')}</span></div>
                <div className="settings-archive-list">
                  {archivedSessions.length === 0 ? <div className="settings-empty">{tr('No archived chats.', '暂无已归档对话。')}</div> : [...archivedSessions].sort((left, right) => right.updatedAt - left.updatedAt).map(session => (
                    <div className="settings-archive-row" key={session.sessionId}>
                      <button type="button" onClick={() => onArchivedSession(session.sessionId)}><Icon name="archive" size={14} /><span><strong>{archivedTitle(session)}</strong><small>{session.cwd ?? session.agentPreset ?? session.sessionId}</small></span></button>
                      <button type="button" className="icon-button quiet" onClick={() => onArchivedMenu(session)} aria-label={tr('Archived chat actions', '归档对话操作')}><Icon name="more" size={14} /></button>
                    </div>
                  ))}
                </div>
              </section>
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
