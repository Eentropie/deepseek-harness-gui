import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InteractionDock } from './InteractionDock.tsx'

const noop = (): void => undefined

describe('InteractionDock', () => {
  it('renders the next approval in the main conversation dock', () => {
    const markup = renderToStaticMarkup(<InteractionDock
      approvals={[{ rpcId: 'approval', sessionId: 'session', approvalId: 'a', toolName: 'bash' }]}
      questions={[]}
      onApproval={noop}
      onQuestion={noop}
    />)
    expect(markup).toContain('main-interaction-dock')
    expect(markup).toContain('Approval required')
  })

  it('handles one interaction at a time and reports the remaining queue', () => {
    const markup = renderToStaticMarkup(<InteractionDock
      approvals={[{ rpcId: 'approval', sessionId: 'session', approvalId: 'a', toolName: 'bash' }]}
      questions={[{ rpcId: 'question', sessionId: 'session', questions: [{ id: 'q', question: 'Continue?' }] }]}
      onApproval={noop}
      onQuestion={noop}
    />)
    expect(markup).toContain('1 more waiting')
    expect(markup).not.toContain('Continue?')
  })
})
