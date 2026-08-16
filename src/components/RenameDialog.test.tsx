import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../lib/i18n.tsx'
import { RenameDialog } from './RenameDialog.tsx'

describe('RenameDialog', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: () => undefined })
    vi.stubGlobal('navigator', { language: 'en' })
  })

  it('renders an in-app session rename dialog with the current title', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <RenameDialog open kind="session" initialValue="Current title" busy={false} onClose={() => undefined} onSubmit={() => undefined} />
      </I18nProvider>,
    )
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Rename session')
    expect(markup).toContain('value="Current title"')
    expect(markup).not.toContain('prompt(')
  })
})
