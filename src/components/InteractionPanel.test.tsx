import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InteractionPanel } from './InteractionPanel.tsx'

const noop = (): void => undefined

describe('InteractionPanel approvals', () => {
  it('offers Always allow for Codex and Host sandbox escalations', () => {
    const codex = renderToStaticMarkup(<InteractionPanel
      approval={{ rpcId: 'c', sessionId: 's', approvalId: 'a', toolName: 'command', source: 'codex', codexRequestId: 1 }}
      onApproval={noop}
      onQuestion={noop}
    />)
    const host = renderToStaticMarkup(<InteractionPanel
      approval={{ rpcId: 'h', sessionId: 's', approvalId: 'a', toolName: 'bash', reason: 'escalate sandbox to danger-full-access' }}
      onApproval={noop}
      onQuestion={noop}
    />)
    expect(codex).toContain('Always allow')
    expect(host).toContain('Always allow')
  })

  it('does not promise persistence for unsupported Host approvals', () => {
    const markup = renderToStaticMarkup(<InteractionPanel
      approval={{ rpcId: 'h', sessionId: 's', approvalId: 'a', toolName: 'custom-tool', reason: 'Needs a one-off decision' }}
      onApproval={noop}
      onQuestion={noop}
    />)
    expect(markup).not.toContain('Always allow')
  })
})
