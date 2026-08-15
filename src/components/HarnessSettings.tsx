import { useEffect, useMemo, useState } from 'react'
import { harnessApi } from '../lib/api.ts'
import type { SettingsDescription, SettingsNamespaceView, SettingsPathOpView } from '../lib/types.ts'
import {
  asRecord,
  childSchemaNode,
  constChoices,
  encodeSettingValue,
  hasAt,
  humanizeSetting,
  metaDescription,
  parseSettingValue,
  rootSchemaNode,
  schemaEnvelope,
  type SerializedSchema,
  type SerializedSchemaNode,
  valueAt,
} from '../lib/settings-schema.ts'
import { Icon } from './Icon.tsx'
import { isAppLocale, useI18n } from '../lib/i18n.tsx'

const namespaceNames: Record<string, string> = {
  'ui-onboarding': 'Onboarding',
  'agent-presets': 'Agent presets',
  'llm-deepseek': 'DeepSeek provider',
  'web-search-deepseek': 'Web search',
  'ui-theme': 'Host appearance',
  locale: 'Language',
  'ui-conversation': 'Conversation',
  shell: 'Shell',
  'agent-loop': 'Agent loop',
  permission: 'Default permission',
  'llm-pi-ai': 'Additional providers',
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index])
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function fieldDescription(path: readonly string[], node: SerializedSchemaNode): string {
  const meta = metaDescription(node)
  const wire = path.join('.')
  return meta === '' ? wire : `${wire} · ${meta}`
}

export function choiceDraft(encoded: string, choices: unknown[]): string {
  const values = choices.map(choice => JSON.stringify(choice))
  return values.includes(encoded) ? encoded : values[0] ?? encoded
}

function SettingField({
  view,
  schema,
  node,
  path,
  writable,
  onMutate,
}: {
  view: SettingsNamespaceView
  schema: SerializedSchema
  node: SerializedSchemaNode
  path: string[]
  writable: boolean
  onMutate: (ops: SettingsPathOpView[]) => Promise<void>
}) {
  const { setLocale, tr } = useI18n()
  const choices = useMemo(() => constChoices(schema, node), [node, schema])
  const secret = view.secrets.find(slot => samePath(slot.path, path))
  const effective = secret === undefined ? valueAt(view.value, path) ?? node.meta?.default : undefined
  const overridden = secret?.set === true || hasAt(view.user, path)
  const encoded = secret === undefined
    ? choiceDraft(encodeSettingValue(effective, node), choices)
    : ''
  const [draft, setDraft] = useState(encoded)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()

  useEffect(() => {
    setDraft(secret === undefined ? choiceDraft(encodeSettingValue(effective, node), choices) : '')
    setFailure(undefined)
  }, [choices, node, secret, view.revision, effective])

  const instantLocale = view.ns === 'locale' && choices.length > 0

  const changeChoice = (next: string): void => {
    setDraft(next)
    if (!instantLocale) return
    setBusy(true)
    setFailure(undefined)
    void (async () => {
      try {
        const value = parseSettingValue(next, node, choices)
        if (typeof value === 'string' && isAppLocale(value)) setLocale(value)
        await onMutate([{ op: 'set', path, value }])
      } catch (reason) {
        setFailure(errorText(reason))
      } finally {
        setBusy(false)
      }
    })()
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const value = secret === undefined
        ? parseSettingValue(draft, node, choices)
        : draft
      if (secret !== undefined && draft.trim() === '') throw new Error('Enter a value before saving this secret.')
      await onMutate([{ op: 'set', path, value }])
      if (secret !== undefined) setDraft('')
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    if (secret?.set === true && !window.confirm(`Remove the stored secret for ${path.join('.')}?`)) return
    setBusy(true)
    setFailure(undefined)
    try {
      await onMutate([{ op: 'unset', path }])
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const structured = node.type === 'array'
    || node.type === 'dict'
    || node.type === 'object'
    || (node.type === 'union' && choices.length === 0)

  return (
    <div className="host-setting-field" data-structured={structured}>
      <div className="host-setting-copy">
        <strong>{humanizeSetting(path.at(-1) ?? view.ns)}</strong>
        <span>{fieldDescription(path, node)}</span>
      </div>
      <div className="host-setting-editor">
        {node.type === 'const' ? (
          <code>{JSON.stringify(node.value)}</code>
        ) : choices.length > 0 ? (
          <label className="settings-select host-setting-input">
            <select value={draft} disabled={!writable || busy} onChange={event => changeChoice(event.target.value)}>
              {choices.map(choice => {
                const value = JSON.stringify(choice)
                return <option key={value} value={value}>{String(choice)}</option>
              })}
            </select>
            <Icon name="chevron-down" size={12} />
          </label>
        ) : structured ? (
          <textarea
            value={draft}
            disabled={!writable || busy}
            aria-label={path.join('.')}
            spellCheck={false}
            onChange={event => setDraft(event.target.value)}
          />
        ) : node.type === 'boolean' ? (
          <label className="settings-select host-setting-input">
            <select value={draft} disabled={!writable || busy} onChange={event => setDraft(event.target.value)}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
            <Icon name="chevron-down" size={12} />
          </label>
        ) : (
          <input
            type={secret === undefined ? (node.type === 'number' ? 'number' : 'text') : 'password'}
            value={draft}
            disabled={!writable || busy}
            min={node.meta?.min}
            max={node.meta?.max}
            step={node.meta?.step}
            autoComplete="off"
            placeholder={secret === undefined ? '' : secret.set ? 'Configured · enter to replace' : 'Not configured'}
            aria-label={path.join('.')}
            onChange={event => setDraft(event.target.value)}
          />
        )}
        {node.type !== 'const' && !instantLocale && (
          <div className="host-setting-actions">
            <button type="button" className="settings-button primary" disabled={!writable || busy} onClick={() => { void save() }}>
              {busy ? tr('Saving…', '正在保存…') : tr('Save', '保存')}
            </button>
            {overridden && (
              <button type="button" className="settings-button" disabled={!writable || busy} onClick={() => { void reset() }}>
                {tr('Reset', '重置')}
              </button>
            )}
          </div>
        )}
        {failure !== undefined && <p className="host-setting-error">{failure}</p>}
      </div>
    </div>
  )
}

function SchemaFields({
  view,
  schema,
  node,
  path,
  depth,
  writable,
  onMutate,
}: {
  view: SettingsNamespaceView
  schema: SerializedSchema
  node: SerializedSchemaNode
  path: string[]
  depth: number
  writable: boolean
  onMutate: (ops: SettingsPathOpView[]) => Promise<void>
}) {
  if (node.type !== 'object' || node.dict === undefined) {
    return <SettingField view={view} schema={schema} node={node} path={path} writable={writable} onMutate={onMutate} />
  }

  return (
    <div className="host-settings-fields">
      {Object.keys(node.dict).map(key => {
        const child = childSchemaNode(schema, node, key)
        if (child === undefined) return null
        const nextPath = [...path, key]
        if (child.type === 'object' && depth < 3) {
          return (
            <details className="host-settings-group" key={key} open={depth === 0 && Object.keys(child.dict ?? {}).length <= 4}>
              <summary>
                <span>{humanizeSetting(key)}</span>
                <code>{nextPath.join('.')}</code>
                <Icon name="chevron-down" size={12} />
              </summary>
              <SchemaFields
                view={view}
                schema={schema}
                node={child}
                path={nextPath}
                depth={depth + 1}
                writable={writable}
                onMutate={onMutate}
              />
            </details>
          )
        }
        return <SettingField key={key} view={view} schema={schema} node={child} path={nextPath} writable={writable} onMutate={onMutate} />
      })}
    </div>
  )
}

export function HarnessSettings({ active }: { active: boolean }) {
  const [description, setDescription] = useState<SettingsDescription>()
  const [selectedNs, setSelectedNs] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string>()

  const load = async (): Promise<void> => {
    setLoading(true)
    setFailure(undefined)
    try {
      const next = await harnessApi.describeSettings()
      setDescription(next)
      setSelectedNs(current => next.namespaces.some(view => view.ns === current) ? current : next.namespaces[0]?.ns)
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (active) void load()
  }, [active])

  const selected = description?.namespaces.find(view => view.ns === selectedNs)
  const schema = schemaEnvelope(selected?.schema)
  const root = rootSchemaNode(schema)

  const mutate = async (ops: SettingsPathOpView[]): Promise<void> => {
    if (selected === undefined) return
    const next = await harnessApi.mutateSettings(selected.ns, ops, selected.revision)
    setDescription(current => current === undefined ? current : {
      ...current,
      namespaces: current.namespaces.map(view => view.ns === next.ns ? next : view),
    })
  }

  const resetNamespace = async (): Promise<void> => {
    if (selected === undefined || !window.confirm(`Reset every user override in ${selected.ns}? Stored secret fields in this namespace will also be removed.`)) return
    try {
      await mutate([{ op: 'unset', path: [] }])
    } catch (reason) {
      setFailure(errorText(reason))
    }
  }

  return (
    <section className="settings-page harness-settings-page">
      <div className="settings-page-heading harness-settings-heading">
        <div><p>HOST SCHEMAS</p><h3>Harness settings</h3><span>Every field is generated from the live, redacted Host schema.</span></div>
        <button type="button" className="settings-button" onClick={() => { void load() }} disabled={loading}>
          <Icon name="refresh" size={14} />{loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {failure !== undefined && <div className="settings-note host-setting-error-note"><Icon name="activity" size={14} /><span>{failure}</span></div>}
      {description === undefined ? (
        <div className="settings-empty">{loading ? 'Reading Host settings…' : 'Host settings are unavailable.'}</div>
      ) : (
        <div className="harness-settings-layout">
          <nav className="harness-namespace-list" aria-label="Host settings namespaces">
            {description.namespaces.map(view => (
              <button type="button" key={view.ns} data-active={view.ns === selectedNs} onClick={() => setSelectedNs(view.ns)}>
                <span>{namespaceNames[view.ns] ?? humanizeSetting(view.ns)}</span>
                <small>{view.applies}</small>
              </button>
            ))}
          </nav>

          <div className="harness-namespace-editor">
            {selected === undefined || schema === undefined || root === undefined ? (
              <div className="settings-empty">This namespace has no readable object schema.</div>
            ) : (
              <>
                <header>
                  <div><strong>{namespaceNames[selected.ns] ?? humanizeSetting(selected.ns)}</strong><code>{selected.ns}</code></div>
                  <span>Revision {selected.revision} · {selected.applies === 'live' ? 'applies live' : 'restart required'}</span>
                </header>
                <SchemaFields
                  view={selected}
                  schema={schema}
                  node={root}
                  path={[]}
                  depth={0}
                  writable={description.writable}
                  onMutate={mutate}
                />
                <footer>
                  <span>Secrets are write-only and never returned by the Host.</span>
                  {asRecord(selected.user) !== undefined && Object.keys(asRecord(selected.user) ?? {}).length > 0 && (
                    <button type="button" className="settings-button danger" disabled={!description.writable} onClick={() => { void resetNamespace() }}>
                      Reset namespace
                    </button>
                  )}
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
