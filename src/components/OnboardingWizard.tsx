import { useCallback, useEffect, useMemo, useState } from 'react'
import { billingApi, harnessApi, setupApi, subscribeSetup } from '../lib/api.ts'
import type { CodexCatalog, SetupEvent, SetupSnapshot, WorkspaceSummary } from '../lib/types.ts'
import { Icon } from './Icon.tsx'
import { WhaleLogo } from './WhaleLogo.tsx'

interface OnboardingWizardProps {
  open: boolean
  codex: CodexCatalog
  workspaces: WorkspaceSummary[]
  onClose: () => void
  onComplete: () => void
  onHostReady: () => Promise<void>
  onRefreshCodex: () => Promise<void>
  onWorkspaceReady: (workspace: WorkspaceSummary) => void
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
  workspaces,
  onClose,
  onComplete,
  onHostReady,
  onRefreshCodex,
  onWorkspaceReady,
}: OnboardingWizardProps) {
  const [setup, setSetup] = useState<SetupSnapshot>()
  const [checking, setChecking] = useState(false)
  const [startingHost, setStartingHost] = useState(false)
  const [apiConfigured, setApiConfigured] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [openingFolder, setOpeningFolder] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [hostLog, setHostLog] = useState('')

  const inspect = useCallback(async (): Promise<void> => {
    setChecking(true)
    setFailure(undefined)
    try {
      const next = await setupApi.inspect()
      setSetup(next)
      if (next.host.online) {
        const result = await harnessApi.describeCredentials(['DEEPSEEK_API_KEY']).catch(() => undefined)
        setApiConfigured(result?.credentials['DEEPSEEK_API_KEY']?.configured === true)
      }
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

  const saveKey = async (): Promise<void> => {
    const key = apiKey.trim()
    if (key === '' || savingKey || setup?.host.online !== true) return
    setSavingKey(true)
    setFailure(undefined)
    try {
      await harnessApi.setCredential('DEEPSEEK_API_KEY', key)
      await billingApi.setDeepSeekKey(key).catch(() => undefined)
      setApiKey('')
      setApiConfigured(true)
      await onHostReady()
    } catch (reason) {
      setFailure(message(reason))
    } finally {
      setSavingKey(false)
    }
  }

  const chooseFolder = async (): Promise<void> => {
    setOpeningFolder(true)
    setFailure(undefined)
    try {
      const path = await harnessApi.pickDirectory()
      if (path === null) return
      const result = await harnessApi.createWorkspace(path)
      onWorkspaceReady(result.workspace)
    } catch (reason) {
      setFailure(message(reason))
    } finally {
      setOpeningFolder(false)
    }
  }

  const ready = setup?.host.online === true && apiConfigured && workspaces.length > 0
  const progress = useMemo(() => [setup?.host.online === true, apiConfigured, codex.available, workspaces.length > 0]
    .filter(Boolean).length, [apiConfigured, codex.available, setup?.host.online, workspaces.length])

  if (!open) return null

  return (
    <div className="onboarding-backdrop">
      <section className="onboarding-window" role="dialog" aria-modal="true" aria-label="First-run setup">
        <header className="onboarding-header">
          <div className="onboarding-whale"><WhaleLogo size={42} /></div>
          <div><p>DEEPSEEK HARNESS</p><h2>Set up your local workbench</h2><span>One guided pass for the Host, model access, Codex, and your first work folder.</span></div>
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

          <article className="onboarding-step" data-ready={apiConfigured}>
            <div className="onboarding-step-icon whale"><WhaleLogo size={19} /></div>
            <div className="onboarding-step-copy">
              <header><strong>DeepSeek API</strong><StatusMark ready={apiConfigured} /></header>
              <p>{apiConfigured ? 'DEEPSEEK_API_KEY is configured in the Local Host.' : 'Paste one key once. It is sent through the restricted credential bridge and is never shown again.'}</p>
              {!apiConfigured && <div className="onboarding-key"><input type="password" value={apiKey} disabled={setup?.host.online !== true} placeholder={setup?.host.online === true ? 'sk-…' : 'Start the Host first'} onChange={event => setApiKey(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveKey() }} /><button type="button" className="primary" disabled={apiKey.trim() === '' || savingKey || setup?.host.online !== true} onClick={() => { void saveKey() }}>{savingKey ? 'Saving…' : 'Save key'}</button></div>}
            </div>
            <div className="onboarding-step-actions"><button type="button" onClick={() => { void setupApi.openExternal('deepseek-key') }}>Open API keys</button></div>
          </article>

          <article className="onboarding-step" data-ready={codex.available}>
            <div className="onboarding-step-icon"><Icon name="brain" size={17} /></div>
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

          <article className="onboarding-step" data-ready={workspaces.length > 0}>
            <div className="onboarding-step-icon"><Icon name="folder" size={17} /></div>
            <div className="onboarding-step-copy">
              <header><strong>Work folder</strong><StatusMark ready={workspaces.length > 0} /></header>
              <p>{workspaces.length > 0 ? `${workspaces.length} local work folder${workspaces.length === 1 ? '' : 's'} available.` : 'Choose the directory that agents are allowed to inspect and edit.'}</p>
            </div>
            <div className="onboarding-step-actions"><button type="button" className={workspaces.length === 0 ? 'primary' : undefined} onClick={() => { void chooseFolder() }} disabled={openingFolder || setup?.host.online !== true}>{openingFolder ? 'Opening…' : 'Choose folder…'}</button></div>
          </article>
        </div>

        {failure !== undefined && <div className="onboarding-error"><Icon name="activity" size={13} /><span>{failure}</span></div>}

        <footer className="onboarding-footer">
          <span>{ready ? 'Environment ready. You can start a real session now.' : 'Codex is optional; Host, DeepSeek API, and a work folder are required.'}</span>
          <div><button type="button" onClick={onClose}>Finish later</button><button type="button" className="primary" disabled={!ready} onClick={onComplete}>Enter DeepSeek Harness</button></div>
        </footer>
      </section>
    </div>
  )
}
