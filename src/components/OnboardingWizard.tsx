import { useCallback, useEffect, useMemo, useState } from 'react'
import { setupApi, subscribeSetup } from '../lib/api.ts'
import type { AntigravityCatalog, CodexCatalog, SetupEvent, SetupSnapshot } from '../lib/types.ts'
import { Icon } from './Icon.tsx'
import { ModelsCredentialsSettings, type ProviderAccessSummary } from './ModelsCredentialsSettings.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'
import { WhaleLogo } from './WhaleLogo.tsx'

interface OnboardingWizardProps {
  open: boolean
  codex: CodexCatalog
  antigravity: AntigravityCatalog
  onClose: () => void
  onComplete: () => void
  onHostReady: () => Promise<void>
  onRefreshCodex: () => Promise<void>
  onRefreshAntigravity: () => Promise<void>
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function StatusMark({ ready, optional = false }: { ready: boolean; optional?: boolean }) {
  return <span className="onboarding-status" data-ready={ready}>{ready ? <Icon name="check" size={12} /> : optional ? 'Optional' : 'Action needed'}</span>
}

export function OnboardingWizard({
  open,
  codex,
  antigravity,
  onClose,
  onComplete,
  onHostReady,
  onRefreshCodex,
  onRefreshAntigravity,
}: OnboardingWizardProps) {
  const [setup, setSetup] = useState<SetupSnapshot>()
  const [checking, setChecking] = useState(false)
  const [startingHost, setStartingHost] = useState(false)
  const [providerAccess, setProviderAccess] = useState<ProviderAccessSummary>({ configuredCredentials: 0, activeProviders: 0, liveModels: 0 })
  const [failure, setFailure] = useState<string>()
  const [hostLog, setHostLog] = useState('')

  const inspect = useCallback(async (): Promise<void> => {
    setChecking(true)
    setFailure(undefined)
    try {
      const next = await setupApi.inspect()
      setSetup(next)
      if (!next.host.online) setProviderAccess({ configuredCredentials: 0, activeProviders: 0, liveModels: 0 })
    } catch (reason) {
      setFailure(message(reason))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void inspect()
    return subscribeSetup((event: SetupEvent) => {
      if (event.type === 'host-log') {
        setHostLog(current => `${current}${event.data}`.slice(-12_000))
      } else if (!event.running && !event.message.startsWith('Stopping')) {
        setFailure(event.message)
      }
    })
  }, [inspect, open])

  const startHost = async (): Promise<void> => {
    setStartingHost(true)
    setFailure(undefined)
    setHostLog('')
    try {
      const next = await setupApi.startHost()
      setSetup(next)
      await onHostReady()
      await inspect()
    } catch (reason) {
      setFailure(message(reason))
    } finally {
      setStartingHost(false)
    }
  }

  const hostModelReady = providerAccess.configuredCredentials > 0
  const modelAccessReady = hostModelReady || codex.available || antigravity.available
  const ready = setup?.host.online === true && modelAccessReady
  const progress = useMemo(() => [setup?.host.online === true, hostModelReady, codex.available, antigravity.available]
    .filter(Boolean).length, [antigravity.available, codex.available, hostModelReady, setup?.host.online])

  if (!open) return null

  return (
    <div className="onboarding-backdrop">
      <section className="onboarding-window" role="dialog" aria-modal="true" aria-label="First-run setup">
        <header className="onboarding-header">
          <div className="onboarding-whale"><WhaleLogo size={42} /></div>
          <div><p>DEEPSEEK HARNESS</p><h2>Set up your local workbench</h2><span>Connect the Local Host and any model providers you want to use.</span></div>
          <button type="button" className="icon-button quiet" onClick={onClose} aria-label="Close setup"><Icon name="x" size={15} /></button>
        </header>

        <div className="onboarding-progress"><i style={{ width: `${progress * 25}%` }} /><span>{progress} of 4 checks ready</span></div>

        <div className="onboarding-steps">
          <article className="onboarding-step" data-ready={setup?.host.online === true}>
            <div className="onboarding-step-icon"><Icon name="terminal" size={17} /></div>
            <div className="onboarding-step-copy">
              <header><strong>Local Host</strong><StatusMark ready={setup?.host.online === true} /></header>
              <p>{setup?.host.online === true
                ? `Connected${setup.host.version === undefined ? '' : ` · ${setup.host.version}`}${setup.host.managed ? ' · started by this app' : ''}`
                : setup?.host.candidateLabel ?? 'Detect an existing checkout, installed dsh, or install the official npm package.'}</p>
              {setup?.host.online !== true && setup?.node.available === false && <p className="onboarding-warning">Node.js 22+ is required before the Host can be installed.</p>}
              {hostLog !== '' && <details className="onboarding-log"><summary>Host setup log</summary><pre>{hostLog}</pre></details>}
            </div>
            <div className="onboarding-step-actions">
              {setup?.host.online === true
                ? <button type="button" onClick={() => { void inspect() }} disabled={checking}>Recheck</button>
                : <>
                    <button type="button" className="primary" onClick={() => { void startHost() }} disabled={startingHost || setup === undefined}>{startingHost ? 'Starting…' : setup?.host.candidate === 'npx' ? 'Install & start Host' : 'Start Host'}</button>
                    {setup?.node.available === false && <button type="button" onClick={() => { void setupApi.openExternal('node') }}>Get Node.js</button>}
                  </>}
            </div>
          </article>

          <article className="onboarding-step onboarding-model-step" data-ready={hostModelReady}>
            <div className="onboarding-step-icon"><Icon name="brain" size={18} /></div>
            <div className="onboarding-step-copy">
              <header><strong>Model APIs</strong><StatusMark ready={hostModelReady} optional={codex.available || antigravity.available} /></header>
              <p>{hostModelReady
                ? `${providerAccess.configuredCredentials} Host credential${providerAccess.configuredCredentials === 1 ? '' : 's'} configured · ${providerAccess.liveModels} live models.`
                : codex.available || antigravity.available ? 'Optional when a subscription CLI is available. Add DeepSeek or another Host provider now or later.' : 'Configure DeepSeek or any other provider exposed by the Local Host. Stored keys are never read back.'}</p>
              <ModelsCredentialsSettings active={setup?.host.online === true} compact onSummary={setProviderAccess} />
            </div>
          </article>

          <article className="onboarding-step" data-ready={codex.available}>
            <div className="onboarding-step-icon"><ProviderLogo provider="codex-cli" size={20} /></div>
            <div className="onboarding-step-copy">
              <header><strong>ChatGPT · Codex CLI</strong><StatusMark ready={codex.available} optional /></header>
              <p>{codex.available ? `${codex.models.length} account-scoped models discovered.` : codex.error ?? 'Install Codex CLI and sign in with your own ChatGPT account.'}</p>
            </div>
            <div className="onboarding-step-actions">
              {!codex.available && <button type="button" onClick={() => { void setupApi.openExternal('codex-install') }}>Install guide</button>}
              <button type="button" onClick={() => { void setupApi.openCodexLogin().catch(reason => setFailure(message(reason))) }}>Open login</button>
              <button type="button" onClick={() => { void onRefreshCodex() }}>Recheck</button>
            </div>
          </article>

          <article className="onboarding-step" data-ready={antigravity.available}>
            <div className="onboarding-step-icon"><ProviderLogo provider="antigravity-cli" name={antigravity.models[0]?.name ?? 'Gemini'} size={20} /></div>
            <div className="onboarding-step-copy">
              <header><strong>Google · Antigravity CLI</strong><StatusMark ready={antigravity.available} optional /></header>
              <p>{antigravity.available ? `${antigravity.models.length} subscription models discovered${antigravity.version === undefined ? '' : ` · ${antigravity.version}`}.` : antigravity.error ?? 'Install Antigravity CLI and complete Google sign-in in agy.'}</p>
            </div>
            <div className="onboarding-step-actions">
              {!antigravity.available && <button type="button" onClick={() => { void setupApi.openExternal('antigravity-install') }}>Install guide</button>}
              <button type="button" onClick={() => { void onRefreshAntigravity() }}>Recheck</button>
            </div>
          </article>

        </div>

        {failure !== undefined && <div className="onboarding-error"><Icon name="activity" size={13} /><span>{failure}</span></div>}

        <footer className="onboarding-footer">
          <span>{ready ? 'Environment ready. Add or switch work folders from the main window when needed.' : 'The Local Host and at least one model connection are required.'}</span>
          <div><button type="button" onClick={onClose}>Finish later</button><button type="button" className="primary" disabled={!ready} onClick={onComplete}>Enter DeepSeek Harness</button></div>
        </footer>
      </section>
    </div>
  )
}
