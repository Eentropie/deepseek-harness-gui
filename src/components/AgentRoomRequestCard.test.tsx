import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../lib/i18n.tsx'
import { AgentRoomRequestCard } from './AgentRoomRequestCard.tsx'

const noop = (): void => undefined

afterEach(() => vi.unstubAllGlobals())

describe('AgentRoomRequestCard', () => {
  it('requires explicit confirmation for an assistant-requested audit', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: noop })
    const markup = renderToStaticMarkup(<I18nProvider><AgentRoomRequestCard
      request={{ id: 'request', kind: 'audit', text: 'Audit the permission bridge', autoRun: true }}
      onConfirm={noop}
      onDismiss={noop}
    /></I18nProvider>)

    expect(markup).toContain('Start an automatic Agent Room audit?')
    expect(markup).toContain('Nothing will run until you confirm')
    expect(markup).toContain('Audit the permission bridge')
    expect(markup).toContain('Start audit')
    expect(markup).toContain('Not now')
  })
})
