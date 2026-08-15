import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OnboardingWizard } from './OnboardingWizard.tsx'

const noop = (): void => undefined
const asyncNoop = async (): Promise<void> => undefined

describe('OnboardingWizard', () => {
  it('keeps work-folder selection out of first-run setup', () => {
    const markup = renderToStaticMarkup(
      <OnboardingWizard
        open
        codex={{ available: false, authenticatedWith: 'ChatGPT', models: [] }}
        onClose={noop}
        onComplete={noop}
        onHostReady={asyncNoop}
        onRefreshCodex={asyncNoop}
      />,
    )

    expect(markup).toContain('Model APIs')
    expect(markup).toContain('any model providers you want to use')
    expect(markup).toContain('data-provider-logo="harness-chatgpt"')
    expect(markup).not.toContain('Work folder')
    expect(markup).not.toContain('Choose folder')
  })
})
