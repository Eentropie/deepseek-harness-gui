import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRoom } from './AgentRoom.tsx'
import { I18nProvider } from '../lib/i18n.tsx'

const noop = (): void => undefined

afterEach(() => vi.unstubAllGlobals())

describe('AgentRoom connected sources', () => {
  it('shows only model sources supplied as live by the session catalog', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: noop, length: 0, key: () => null })
    const markup = renderToStaticMarkup(<I18nProvider><AgentRoom
      hidden={false}
      parentSessionId="parent"
      parentTitle="Audit"
      cwd="/tmp/workspace"
      models={{
        current: { provider: 'deepseek', model: 'deepseek-v4' },
        routable: true,
        groups: [
          { id: 'deepseek', name: 'DeepSeek API', models: [{ id: 'deepseek-v4', name: 'DeepSeek V4' }] },
          { id: 'codex-cli', name: 'ChatGPT subscription', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
        ],
        failures: [],
      }}
      parentMessages={[]}
      onOpenNative={noop}
      onExitNative={noop}
      onManagedHostSessions={noop}
      onRequestHandled={noop}
      onDeliverReport={async () => undefined}
    /></I18nProvider>)

    expect(markup).toContain('Agent Room')
    expect(markup).toContain('DeepSeek API')
    expect(markup).toContain('ChatGPT subscription')
    expect(markup).toContain('Claude Code is not enabled')
    expect(markup).not.toContain('Claude Code CLI')
  })
})
