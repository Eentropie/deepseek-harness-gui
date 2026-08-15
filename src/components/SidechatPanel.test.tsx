import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidechatPanel } from './SidechatPanel.tsx'

const noop = (): void => undefined

afterEach(() => vi.unstubAllGlobals())

function render(threads: Array<{ id: string; title: string }>, owner?: string): string {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: noop,
  })
  return renderToStaticMarkup(<SidechatPanel
    owner={owner}
    parentTitle="Main audit"
    threads={threads}
    activeThreadId={threads[0]?.id}
    provider="DeepSeek"
    permissionOptions={[]}
    network="auto"
    messages={[]}
    running={false}
    onSend={noop}
    onStop={noop}
    onNewThread={noop}
    onThread={noop}
    onCloseThread={noop}
    onModel={noop}
    onEffort={noop}
    onPermission={noop}
    onNetwork={noop}
  />)
}

describe('SidechatPanel thread controls', () => {
  it('renders a close control for every sidechat tab', () => {
    const markup = render([{ id: 'one', title: 'First review' }, { id: 'two', title: 'Second review' }], 'sidechat:main:one')

    expect(markup).toContain('aria-label="Close First review"')
    expect(markup).toContain('aria-label="Close Second review"')
  })

  it('offers a new sidechat after the last tab is closed', () => {
    const markup = render([])

    expect(markup).toContain('No sidechats open')
    expect(markup).toContain('New sidechat')
    expect(markup).not.toContain('sidechat-composer')
  })
})
