import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider, useI18n } from './i18n.tsx'

function Probe() {
  const { tr } = useI18n()
  return <span>{tr('Settings', '设置')}</span>
}

describe('I18nProvider', () => {
  it('hydrates the stored Chinese locale without a restart', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'zh', setItem: () => undefined })
    expect(renderToStaticMarkup(<I18nProvider><Probe /></I18nProvider>)).toContain('设置')
    vi.unstubAllGlobals()
  })
})
