import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ConversationMessage } from '../lib/types.ts'
import { SidechatPanel } from './SidechatPanel.tsx'

const noop = (): void => undefined

afterEach(() => vi.unstubAllGlobals())

function render(threads: Array<{ id: string; title: string }>, owner?: string, messages: ConversationMessage[] = [], running = false): string {
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
    messages={messages}
    running={running}
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

  it('shows the live thought process while a sidechat turn is running', () => {
    const markup = render([{ id: 'one', title: 'Live review' }], 'sidechat:main:one', [{
      id: 'assistant-live',
      seq: 2,
      time: 1,
      role: 'assistant',
      streaming: true,
      blocks: [{ kind: 'reasoning', text: 'Inspecting the workspace' }],
    }], true)

    expect(markup).toContain('<details class="sidechat-thought" open="">')
    expect(markup).toContain('<summary>Thinking</summary>')
    expect(markup).toContain('Inspecting the workspace')
  })
})
