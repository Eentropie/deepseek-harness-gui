import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../lib/i18n.tsx'
import { CopyTextButton } from './CopyTextButton.tsx'

const noop = (): void => undefined

afterEach(() => vi.unstubAllGlobals())

describe('CopyTextButton', () => {
  it('renders an explicit copy action for Agent Room output', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: noop })
    const markup = renderToStaticMarkup(<I18nProvider><CopyTextButton text="Finding" /></I18nProvider>)
    expect(markup).toContain('aria-label="Copy"')
    expect(markup).toContain('data-copy-state="idle"')
    expect(markup).toContain('Copy</span>')
  })
})
