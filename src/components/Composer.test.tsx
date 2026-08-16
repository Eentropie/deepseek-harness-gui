import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Composer, hasExternalEditableFocus } from './Composer.tsx'

const noop = (): void => undefined

function renderComposer(value: string, disabled = false): string {
  return renderToStaticMarkup(
    <Composer
      value={value}
      onChange={noop}
      onSend={noop}
      onStop={noop}
      disabled={disabled}
      running={false}
      busy={false}
      permissionOptions={[]}
      onModel={noop}
      onEffort={noop}
      onPermission={noop}
      networkMode="auto"
      networkAvailable
      networkOnline
      onNetworkMode={noop}
      onExitPlan={noop}
      attachments={[]}
      onAddFiles={noop}
      onRemoveAttachment={noop}
      queue={[]}
      onQueueAction={noop}
    />,
  )
}

describe('Composer send control', () => {
  it('keeps the empty-state control interactive so it can focus the textarea', () => {
    const markup = renderComposer('')
    const button = markup.match(/<button type="button" class="send-button"[^>]*>/)?.[0]

    expect(button).toBeDefined()
    expect(button).toContain('data-empty="true"')
    expect(button).toContain('aria-label="Focus message input"')
    expect(button).not.toContain('disabled')
    expect(markup).toContain('Type a message to begin')
  })

  it('only locks the send control when the composer itself is unavailable', () => {
    const markup = renderComposer('Ready to send', true)
    const button = markup.match(/<button type="button" class="send-button"[^>]*>/)?.[0]

    expect(button).toContain('disabled')
  })

  it('keeps model, effort, and permission controls hot-swappable while running', () => {
    const markup = renderToStaticMarkup(
      <Composer
        value=""
        onChange={noop}
        onSend={noop}
        onStop={noop}
        disabled={false}
        running
        busy={false}
        models={{
          current: { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' },
          routable: true,
          groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{
            id: 'v4',
            name: 'V4',
            reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
          }] }],
          failures: [],
        }}
        permissionOptions={[{ value: 'workspace-write', name: 'Workspace write' }]}
        permission="workspace-write"
        onModel={noop}
        onEffort={noop}
        onPermission={noop}
        networkMode="auto"
        networkAvailable
        networkOnline
        onNetworkMode={noop}
        onExitPlan={noop}
        attachments={[]}
        onAddFiles={noop}
        onRemoveAttachment={noop}
        queue={[]}
        onQueueAction={noop}
      />,
    )
    const selects = markup.match(/<select[^>]*>/g) ?? []
    expect(selects).toHaveLength(4)
    expect(selects.every(select => !select.includes('disabled'))).toBe(true)
    expect(markup).toContain('applies from the next model step or turn')
    expect(markup).toContain('aria-label="Web access"')
  })

  it('shows separate queue and send-now controls while the agent is running', () => {
    const markup = renderToStaticMarkup(
      <Composer
        value="Follow up"
        onChange={noop}
        onSend={noop}
        onStop={noop}
        disabled={false}
        running
        busy={false}
        permissionOptions={[]}
        onModel={noop}
        onEffort={noop}
        onPermission={noop}
        networkMode="auto"
        networkAvailable
        networkOnline
        onNetworkMode={noop}
        onExitPlan={noop}
        attachments={[]}
        onAddFiles={noop}
        onRemoveAttachment={noop}
        queue={[]}
        onQueueAction={noop}
      />,
    )
    expect(markup).toContain('aria-label="Stop"')
    expect(markup).toContain('aria-label="Queue message"')
    expect(markup).toContain('aria-label="Choose message delivery"')
    expect(markup).toContain('Enter to queue')
    expect(markup).toContain('Enter to send now')
  })
})

describe('Composer focus ownership', () => {
  const inside = {} as Element
  const root = {
    contains: (candidate: Element) => candidate === inside,
  } as unknown as HTMLElement

  it('does not treat controls inside the main composer as competing editors', () => {
    expect(hasExternalEditableFocus(inside, root)).toBe(false)
  })

  it('preserves focus in an editor outside the main composer', () => {
    const externalTextarea = {
      matches: (selector: string) => selector.includes('textarea'),
      closest: () => null,
    } as unknown as Element
    expect(hasExternalEditableFocus(externalTextarea, root)).toBe(true)
  })

  it('does not steal focus from a modal even when its active control is a button', () => {
    const modalButton = {
      matches: () => false,
      closest: (selector: string) => selector.includes('[role="dialog"]') ? {} : null,
    } as unknown as Element
    expect(hasExternalEditableFocus(modalButton, root)).toBe(true)
  })
})
