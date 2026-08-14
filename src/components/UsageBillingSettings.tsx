import { useCallback, useEffect, useMemo, useState } from 'react'
import { billingApi, codexApi, harnessApi, subscribeCodex } from '../lib/api.ts'
import type { CodexRateLimitWindow, CodexUsageSnapshot, CredentialView, DeepSeekBillingSnapshot } from '../lib/types.ts'
import { Icon } from './Icon.tsx'
import { WhaleLogo } from './WhaleLogo.tsx'

interface UsageBillingSettingsProps {
  active: boolean
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase())
}

function compactNumber(value: number | undefined): string {
  if (value === undefined) return '—'
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function durationLabel(minutes: number | undefined): string {
  if (minutes === undefined) return 'Rolling window'
  if (minutes % 10_080 === 0) return `${minutes / 10_080} week${minutes === 10_080 ? '' : 's'}`
  if (minutes % 1_440 === 0) return `${minutes / 1_440} day${minutes === 1_440 ? '' : 's'}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} minutes`
}

function resetLabel(timestamp: number | undefined): string {
  if (timestamp === undefined) return 'Reset time unavailable'
  const milliseconds = timestamp * 1_000 - Date.now()
  if (milliseconds <= 0) return 'Reset due'
  const minutes = Math.ceil(milliseconds / 60_000)
  if (minutes < 60) return `Resets in ${minutes} min`
  const hours = Math.ceil(minutes / 60)
  if (hours < 48) return `Resets in ${hours} hr`
  return `Resets in ${Math.ceil(hours / 24)} days`
}

function RateWindow({ label, window }: { label: string; window: CodexRateLimitWindow }) {
  return (
    <div className="usage-window">
      <div>
        <span>{label} · {durationLabel(window.windowDurationMins)}</span>
        <strong>{Math.round(window.remainingPercent)}% left</strong>
      </div>
      <div className="usage-progress" role="meter" aria-label={`${label} quota remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.remainingPercent}>
        <i style={{ width: `${window.remainingPercent}%` }} />
      </div>
      <small title={window.resetsAt === undefined ? undefined : new Date(window.resetsAt * 1_000).toLocaleString()}>{resetLabel(window.resetsAt)}</small>
    </div>
  )
}

export function UsageBillingSettings({ active }: UsageBillingSettingsProps) {
  const [codex, setCodex] = useState<CodexUsageSnapshot>()
  const [deepSeek, setDeepSeek] = useState<DeepSeekBillingSnapshot>()
  const [hostCredential, setHostCredential] = useState<CredentialView>()
  const [keyDraft, setKeyDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string>()

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setFailure(undefined)
    const [codexResult, deepSeekResult, hostResult] = await Promise.allSettled([
      codexApi.usage(),
      billingApi.deepSeek(),
      harnessApi.describeCredentials(['DEEPSEEK_API_KEY']),
    ])
    if (codexResult.status === 'fulfilled') setCodex(codexResult.value)
    else setCodex({ available: false, rateLimits: [], dailyUsageBuckets: [], updatedAt: Date.now(), error: errorText(codexResult.reason) })
    if (deepSeekResult.status === 'fulfilled') setDeepSeek(deepSeekResult.value)
    else setDeepSeek({ configured: false, writable: false, balances: [], updatedAt: Date.now(), error: errorText(deepSeekResult.reason) })
    if (hostResult.status === 'fulfilled') setHostCredential(hostResult.value.credentials['DEEPSEEK_API_KEY'])
    const rejected = [codexResult, deepSeekResult, hostResult].filter(result => result.status === 'rejected')
    if (rejected.length === 3) setFailure('Usage and billing sources are currently unavailable.')
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!active) return
    void load()
    const interval = window.setInterval(() => { void load() }, 60_000)
    let notificationTimer: number | undefined
    const unsubscribe = subscribeCodex(event => {
      if (event.type !== 'usage-updated') return
      if (notificationTimer !== undefined) window.clearTimeout(notificationTimer)
      notificationTimer = window.setTimeout(() => { void load() }, 500)
    })
    return () => {
      window.clearInterval(interval)
      if (notificationTimer !== undefined) window.clearTimeout(notificationTimer)
      unsubscribe()
    }
  }, [active, load])

  const latestUsage = useMemo(() => [...(codex?.dailyUsageBuckets ?? [])]
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .at(-1), [codex?.dailyUsageBuckets])

  const saveKey = async (): Promise<void> => {
    if (keyDraft.trim() === '') return
    setSaving(true)
    setFailure(undefined)
    try {
      setDeepSeek(await billingApi.setDeepSeekKey(keyDraft))
      setKeyDraft('')
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setSaving(false)
    }
  }

  const removeKey = async (): Promise<void> => {
    if (!window.confirm('Remove the locally saved DeepSeek billing credential?')) return
    setSaving(true)
    setFailure(undefined)
    try {
      setDeepSeek(await billingApi.removeDeepSeekKey())
      setKeyDraft('')
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings-page usage-settings-page">
      <div className="settings-page-heading harness-settings-heading">
        <div><p>ACCOUNT STATUS</p><h3>Usage &amp; billing</h3><span>Live subscription limits and API balance, kept separate from conversation content.</span></div>
        <button type="button" className="settings-button" onClick={() => { void load() }} disabled={loading}>
          <Icon name="refresh" size={14} />{loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {failure !== undefined && <div className="settings-note host-setting-error-note"><Icon name="activity" size={14} /><span>{failure}</span></div>}

      <article className="billing-provider-card">
        <header>
          <div className="billing-provider-icon"><Icon name="brain" size={19} /></div>
          <div><span>CHATGPT ACCOUNT</span><strong>Codex CLI</strong></div>
          <em data-state={codex?.available === true ? 'ready' : 'offline'}>{codex?.available === true ? titleCase(codex.planType ?? codex.accountType ?? 'Connected') : 'Unavailable'}</em>
        </header>
        {codex === undefined ? (
          <div className="billing-loading">Reading the current Codex login…</div>
        ) : !codex.available ? (
          <div className="billing-message"><strong>Subscription limits unavailable</strong><span>{codex.error ?? 'Sign in with Codex CLI to read this account.'}</span></div>
        ) : (
          <>
            <div className="usage-summary-grid">
              <div><span>Plan</span><strong>{titleCase(codex.planType ?? codex.accountType ?? 'Account')}</strong></div>
              <div><span>Lifetime tokens</span><strong>{compactNumber(codex.summary?.lifetimeTokens)}</strong></div>
              <div><span>Latest day</span><strong>{compactNumber(latestUsage?.tokens)}</strong><small>{latestUsage?.startDate ?? 'No daily data'}</small></div>
            </div>
            <div className="usage-limit-list">
              {codex.rateLimits.flatMap(bucket => [
                ...(bucket.primary === undefined ? [] : [<RateWindow key={`${bucket.id}-primary`} label={bucket.name} window={bucket.primary} />]),
                ...(bucket.secondary === undefined ? [] : [<RateWindow key={`${bucket.id}-secondary`} label={`${bucket.name} extended`} window={bucket.secondary} />]),
                ...(bucket.individualLimit === undefined ? [] : [
                  <div className="usage-window" key={`${bucket.id}-individual`}>
                    <div><span>Spend control</span><strong>{Math.round(bucket.individualLimit.remainingPercent)}% left</strong></div>
                    <div className="usage-progress"><i style={{ width: `${bucket.individualLimit.remainingPercent}%` }} /></div>
                    <small>{bucket.individualLimit.used} used of {bucket.individualLimit.limit} · {resetLabel(bucket.individualLimit.resetsAt)}</small>
                  </div>,
                ]),
              ])}
              {codex.rateLimits.every(bucket => bucket.primary === undefined && bucket.secondary === undefined && bucket.individualLimit === undefined)
                && <div className="billing-message compact"><span>This account did not return a metered quota window.</span></div>}
            </div>
          </>
        )}
      </article>

      <article className="billing-provider-card">
        <header>
          <div className="billing-provider-icon whale"><WhaleLogo size={22} /></div>
          <div><span>API ACCOUNT</span><strong>DeepSeek balance</strong></div>
          <em data-state={deepSeek?.balanceAvailable === true ? 'ready' : deepSeek?.configured === true ? 'warning' : 'offline'}>
            {deepSeek?.balanceAvailable === true ? 'Available' : deepSeek?.configured === true ? 'Check needed' : 'Not connected'}
          </em>
        </header>

        {deepSeek?.balances !== undefined && deepSeek.balances.length > 0 && (
          <div className="deepseek-balance-grid">
            {deepSeek.balances.map(balance => (
              <div key={balance.currency}>
                <span>{balance.currency} balance</span><strong>{balance.totalBalance}</strong>
                <small>{balance.toppedUpBalance} topped up · {balance.grantedBalance} granted</small>
              </div>
            ))}
          </div>
        )}

        {deepSeek?.error !== undefined && <div className="billing-message compact"><strong>Balance check</strong><span>{deepSeek.error}</span></div>}

        <div className="billing-key-panel">
          <div>
            <strong>Billing API key</strong>
            <span>{deepSeek?.source === 'environment'
              ? 'Owned by the app environment; it cannot be changed here.'
              : deepSeek?.source === 'secure-storage'
                ? 'Encrypted with macOS secure storage. The key is never shown again.'
                : hostCredential?.configured === true
                  ? 'The Host has a value-free credential reference. Add the same key once for this isolated balance connector.'
                  : 'Used only with the fixed DeepSeek balance endpoint.'}</span>
          </div>
          {deepSeek?.source !== 'environment' && (
            <div className="billing-key-controls">
              <input
                type="password"
                value={keyDraft}
                onChange={event => setKeyDraft(event.target.value)}
                placeholder={deepSeek?.configured === true ? 'Replace saved key…' : 'sk-…'}
                aria-label="DeepSeek billing API key"
                autoComplete="off"
                spellCheck={false}
                disabled={saving || deepSeek?.writable === false}
              />
              <button type="button" className="settings-button primary" disabled={saving || keyDraft.trim() === '' || deepSeek?.writable === false} onClick={() => { void saveKey() }}>
                {saving ? 'Checking…' : 'Save & check'}
              </button>
              {deepSeek?.source === 'secure-storage' && <button type="button" className="settings-button" disabled={saving} onClick={() => { void removeKey() }}>Remove</button>}
            </div>
          )}
        </div>
      </article>

      <div className="settings-note billing-boundary-note"><Icon name="lock" size={14} /><span>Codex data comes from the signed-in CLI account. DeepSeek exposes account balance, but detailed API-key usage is exported as CSV from its platform. Stored keys never enter the renderer or the local Harness Host.</span></div>
    </section>
  )
}
