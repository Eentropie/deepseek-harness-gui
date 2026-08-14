import { useEffect, useMemo, useState } from 'react'
import { harnessApi } from '../lib/api.ts'
import { apiKeyFailure, deriveCredentialRef } from '../lib/provider-settings.ts'
import { asRecord, hasAt, valueAt } from '../lib/settings-schema.ts'
import type {
  ConfigurableProviderView,
  CredentialView,
  DiscoveredModelView,
  HostModelCatalog,
  SettingsDescription,
  SettingsNamespaceView,
  SettingsPathOpView,
} from '../lib/types.ts'
import { Icon } from './Icon.tsx'

interface ModelsSnapshot {
  providers: ConfigurableProviderView[]
  settings: SettingsDescription
  catalog: HostModelCatalog
  credentials: Record<string, CredentialView>
  credentialError?: string
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function providerNamespace(snapshot: ModelsSnapshot, entry: ConfigurableProviderView): SettingsNamespaceView | undefined {
  return snapshot.settings.namespaces.find(view => view.ns === entry.settingsNs)
}

function profileOf(namespace: SettingsNamespaceView | undefined, entry: ConfigurableProviderView): Record<string, unknown> | undefined {
  if (namespace === undefined) return undefined
  const value = entry.settingsPath.length === 0 ? namespace.value : valueAt(namespace.value, entry.settingsPath)
  return asRecord(value)
}

function userProfileOf(namespace: SettingsNamespaceView | undefined, entry: ConfigurableProviderView): Record<string, unknown> | undefined {
  if (namespace === undefined) return undefined
  const value = entry.settingsPath.length === 0 ? namespace.user : valueAt(namespace.user, entry.settingsPath)
  return asRecord(value)
}

function credentialRefOf(namespace: SettingsNamespaceView | undefined, entry: ConfigurableProviderView): string {
  const named = profileOf(namespace, entry)?.['apiKeyEnv']
  return typeof named === 'string' && named !== '' ? named : deriveCredentialRef(entry.provider)
}

function ProviderEditor({ snapshot, entry, onChanged }: {
  snapshot: ModelsSnapshot
  entry: ConfigurableProviderView
  onChanged: () => Promise<void>
}) {
  const namespace = providerNamespace(snapshot, entry)
  const profile = profileOf(namespace, entry)
  const userProfile = userProfileOf(namespace, entry)
  const credentialRef = credentialRefOf(namespace, entry)
  const credential = snapshot.credentials[credentialRef]
  const effectiveBaseURL = typeof profile?.['baseURL'] === 'string' ? profile['baseURL'] : undefined
  const userBaseURL = typeof userProfile?.['baseURL'] === 'string' ? userProfile['baseURL'] : undefined
  const api = typeof profile?.['api'] === 'string' ? profile['api'] : undefined
  const configured = entry.settingsPath.length === 0 || profile !== undefined
  const modelGroup = snapshot.catalog.groups.find(group => group.id === entry.provider)
  const [baseURL, setBaseURL] = useState(userBaseURL ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [status, setStatus] = useState<string>()
  const [discovered, setDiscovered] = useState<DiscoveredModelView[]>()

  useEffect(() => {
    setBaseURL(userBaseURL ?? '')
    setKeyDraft('')
    setFailure(undefined)
    setStatus(undefined)
    setDiscovered(undefined)
  }, [entry.provider, namespace?.revision, userBaseURL])

  const save = async (): Promise<void> => {
    if (namespace === undefined) return
    const keyError = apiKeyFailure(keyDraft)
    if (keyError !== undefined) {
      setFailure(keyError)
      return
    }
    setBusy(true)
    setFailure(undefined)
    setStatus(undefined)
    try {
      const ops: SettingsPathOpView[] = []
      const trimmedBaseURL = baseURL.trim()
      const trimmedKey = keyDraft.trim()
      if (!configured && entry.settingsPath.length > 0) {
        const next: Record<string, unknown> = {}
        if (trimmedBaseURL !== '') next['baseURL'] = trimmedBaseURL
        if (trimmedKey !== '') next['apiKeyEnv'] = credentialRef
        ops.push({ op: 'set', path: entry.settingsPath, value: next })
      } else {
        const basePath = [...entry.settingsPath, 'baseURL']
        if (trimmedBaseURL !== '' && trimmedBaseURL !== userBaseURL) {
          ops.push({ op: 'set', path: basePath, value: trimmedBaseURL })
        } else if (trimmedBaseURL === '' && userBaseURL !== undefined) {
          ops.push({ op: 'unset', path: basePath })
        }
        if (trimmedKey !== '' && typeof profile?.['apiKeyEnv'] !== 'string' && entry.settingsPath.length > 0) {
          ops.push({ op: 'set', path: [...entry.settingsPath, 'apiKeyEnv'], value: credentialRef })
        }
      }
      if (ops.length > 0) await harnessApi.mutateSettings(namespace.ns, ops, namespace.revision)
      if (trimmedKey !== '') await harnessApi.setCredential(credentialRef, trimmedKey)
      setKeyDraft('')
      setStatus(configured ? 'Provider settings saved.' : 'Provider activated.')
      await onChanged()
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const discover = async (): Promise<void> => {
    const keyError = apiKeyFailure(keyDraft)
    if (keyError !== undefined) {
      setFailure(keyError)
      return
    }
    setBusy(true)
    setFailure(undefined)
    setStatus(undefined)
    try {
      const result = await harnessApi.discoverModels({
        settingsNs: entry.settingsNs,
        provider: entry.provider,
        ...(baseURL.trim() !== '' ? { baseURL: baseURL.trim() } : effectiveBaseURL === undefined ? {} : { baseURL: effectiveBaseURL }),
        ...(api === undefined ? {} : { api }),
        ...(keyDraft.trim() === '' ? {} : { apiKey: keyDraft.trim() }),
      })
      setDiscovered(result.models)
      setStatus(`${result.models.length} model${result.models.length === 1 ? '' : 's'} discovered. Nothing was changed.`)
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const removeCredential = async (): Promise<void> => {
    if (!window.confirm(`Remove the stored credential ${credentialRef}?`)) return
    setBusy(true)
    setFailure(undefined)
    try {
      await harnessApi.unsetCredential(credentialRef)
      setStatus('Stored credential removed.')
      await onChanged()
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const deactivate = async (): Promise<void> => {
    if (namespace === undefined || !window.confirm(`Deactivate ${entry.displayName}? Its stored credential will be retained.`)) return
    setBusy(true)
    setFailure(undefined)
    try {
      await harnessApi.mutateSettings(namespace.ns, [{ op: 'unset', path: entry.settingsPath }], namespace.revision)
      await onChanged()
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  if (namespace === undefined) return <div className="settings-note"><Icon name="activity" size={14} /><span>Provider settings namespace is unavailable.</span></div>

  return (
    <div className="provider-editor-card">
      <header>
        <div className="provider-avatar"><Icon name="brain" size={17} /></div>
        <div><strong>{entry.displayName}</strong><code>{entry.provider}</code></div>
        <span className="provider-state" data-active={entry.active}>{entry.active ? 'Active' : configured ? 'Configured' : 'Available'}</span>
      </header>

      <div className="provider-form-grid">
        <label>
          <span>API key</span>
          <input
            type="password"
            value={keyDraft}
            autoComplete="off"
            disabled={busy || credential?.writable === false || !snapshot.settings.writable}
            placeholder={credential?.configured === true ? `Configured via ${credential.source ?? 'credential store'}` : 'Enter to configure'}
            onChange={event => setKeyDraft(event.target.value)}
          />
          <small>{credentialRef} · values are never read back</small>
        </label>
        <label>
          <span>Base URL override</span>
          <input
            type="url"
            value={baseURL}
            disabled={busy || !snapshot.settings.writable}
            placeholder={effectiveBaseURL ?? 'Use provider default'}
            onChange={event => setBaseURL(event.target.value)}
          />
          <small>Leave blank to inherit the adapter default.</small>
        </label>
      </div>

      <div className="provider-facts">
        <span><i data-ok={credential?.configured === true} />{credential?.configured === true ? 'Credential configured' : 'Credential optional or missing'}</span>
        <span>{modelGroup?.models.length ?? 0} live models</span>
        <span>{entry.settingsNs}</span>
      </div>

      {discovered !== undefined && (
        <div className="discovered-models">
          {discovered.length === 0 ? <span>No models were advertised.</span> : discovered.map(model => (
            <div key={model.id}><strong>{model.name ?? model.id}</strong><code>{model.id}</code><span>{model.contextWindow === undefined ? '' : `${model.contextWindow.toLocaleString()} ctx`}</span></div>
          ))}
        </div>
      )}

      {failure !== undefined && <p className="host-setting-error">{failure}</p>}
      {status !== undefined && <p className="provider-success" role="status">{status}</p>}

      <footer>
        <button type="button" className="settings-button primary" disabled={busy || !snapshot.settings.writable} onClick={() => { void save() }}>
          {busy ? 'Working…' : configured ? 'Save changes' : 'Activate provider'}
        </button>
        <button type="button" className="settings-button" disabled={busy} onClick={() => { void discover() }}>
          <Icon name="search" size={13} />Discover models
        </button>
        {credential?.configured === true && credential.writable && (
          <button type="button" className="settings-button" disabled={busy} onClick={() => { void removeCredential() }}>Remove key</button>
        )}
        {entry.settingsPath.length > 0 && hasAt(namespace.user, entry.settingsPath) && (
          <button type="button" className="settings-button danger provider-deactivate" disabled={busy} onClick={() => { void deactivate() }}>Deactivate</button>
        )}
      </footer>
    </div>
  )
}

export function ModelsCredentialsSettings({ active }: { active: boolean }) {
  const [snapshot, setSnapshot] = useState<ModelsSnapshot>()
  const [selectedProvider, setSelectedProvider] = useState<string>()
  const [addProvider, setAddProvider] = useState('')
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string>()

  const load = async (): Promise<void> => {
    setLoading(true)
    setFailure(undefined)
    try {
      const [providerResult, settings, catalog] = await Promise.all([
        harnessApi.llmProviders(),
        harnessApi.describeSettings(),
        harnessApi.llmModels(),
      ])
      const refs = [...new Set(providerResult.providers.map(entry => {
        const namespace = settings.namespaces.find(view => view.ns === entry.settingsNs)
        return credentialRefOf(namespace, entry)
      }))]
      let credentials: Record<string, CredentialView> = {}
      let credentialError: string | undefined
      try {
        credentials = refs.length === 0 ? {} : (await harnessApi.describeCredentials(refs)).credentials
      } catch (reason) {
        credentialError = errorText(reason)
      }
      const next: ModelsSnapshot = { providers: providerResult.providers, settings, catalog, credentials, ...(credentialError === undefined ? {} : { credentialError }) }
      setSnapshot(next)
      setSelectedProvider(current => providerResult.providers.some(entry => entry.provider === current)
        ? current
        : providerResult.providers.find(entry => entry.active)?.provider ?? providerResult.providers[0]?.provider)
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (active) void load()
  }, [active])

  const visibleProviders = useMemo(() => snapshot?.providers.filter(entry => {
    const namespace = snapshot === undefined ? undefined : providerNamespace(snapshot, entry)
    return entry.active || profileOf(namespace, entry) !== undefined
  }) ?? [], [snapshot])
  const availableProviders = useMemo(() => snapshot?.providers.filter(entry => !visibleProviders.some(visible => visible.provider === entry.provider)) ?? [], [snapshot, visibleProviders])
  const selected = snapshot?.providers.find(entry => entry.provider === selectedProvider)

  return (
    <section className="settings-page models-settings-page">
      <div className="settings-page-heading harness-settings-heading">
        <div><p>HOST CONFIGURATION</p><h3>Models & credentials</h3><span>Configure local Harness providers without exposing stored API keys.</span></div>
        <button type="button" className="settings-button" onClick={() => { void load() }} disabled={loading}>
          <Icon name="refresh" size={14} />{loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {failure !== undefined && <div className="settings-note host-setting-error-note"><Icon name="activity" size={14} /><span>{failure}</span></div>}
      {snapshot?.credentialError !== undefined && <div className="settings-note"><Icon name="lock" size={14} /><span>Credential status unavailable: {snapshot.credentialError}</span></div>}

      {snapshot === undefined ? (
        <div className="settings-empty">{loading ? 'Reading providers and models…' : 'Provider configuration is unavailable.'}</div>
      ) : (
        <>
          <div className="provider-summary-grid">
            <div><strong>{snapshot.providers.filter(entry => entry.active).length}</strong><span>Active routes</span></div>
            <div><strong>{snapshot.catalog.groups.reduce((count, group) => count + group.models.length, 0)}</strong><span>Live models</span></div>
            <div><strong>{Object.values(snapshot.credentials).filter(value => value.configured).length}</strong><span>Credentials set</span></div>
          </div>

          <div className="provider-browser">
            <nav aria-label="Configured providers">
              {visibleProviders.map(entry => {
                const namespace = providerNamespace(snapshot, entry)
                const ref = credentialRefOf(namespace, entry)
                return (
                  <button type="button" key={entry.provider} data-active={entry.provider === selectedProvider} onClick={() => setSelectedProvider(entry.provider)}>
                    <i data-live={entry.active} />
                    <span><strong>{entry.displayName}</strong><small>{snapshot.credentials[ref]?.configured ? 'Credential configured' : entry.active ? 'Active route' : 'Configured'}</small></span>
                    <Icon name="chevron-right" size={12} />
                  </button>
                )
              })}
              {visibleProviders.length === 0 && <p>No providers configured.</p>}
            </nav>
            <div>
              {selected === undefined ? <div className="settings-empty">Choose a provider.</div> : (
                <ProviderEditor snapshot={snapshot} entry={selected} onChanged={load} />
              )}
            </div>
          </div>

          <div className="provider-add-card">
            <div><strong>Add a provider</strong><span>Activate one of the adapter routes already shipped by the local Host.</span></div>
            <label className="settings-select">
              <select value={addProvider} onChange={event => setAddProvider(event.target.value)}>
                <option value="">Choose provider…</option>
                {availableProviders.map(entry => <option key={entry.provider} value={entry.provider}>{entry.displayName}</option>)}
              </select>
              <Icon name="chevron-down" size={12} />
            </label>
            <button type="button" className="settings-button" disabled={addProvider === ''} onClick={() => {
              setSelectedProvider(addProvider)
              setAddProvider('')
            }}>Configure</button>
          </div>

          <div className="settings-note"><Icon name="brain" size={14} /><span>Codex CLI models remain account-scoped and use the existing Codex login. Host providers configured here are separate routes owned by DeepSeek Harness.</span></div>
        </>
      )}
    </section>
  )
}
