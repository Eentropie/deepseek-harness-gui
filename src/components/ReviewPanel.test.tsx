import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReviewPanel } from './ReviewPanel.tsx'

describe('ReviewPanel workspace browser', () => {
  it('shows the selected session folder as a tree without a manual path field', () => {
    const markup = renderToStaticMarkup(<ReviewPanel sessionId="session" cwd="/tmp/audit-workspace" />)

    expect(markup).toContain('role="tree"')
    expect(markup).toContain('Files in audit-workspace')
    expect(markup).toContain('audit-workspace')
    expect(markup).toContain('Double-click')
    expect(markup).not.toContain('<input')
    expect(markup).not.toContain('Open relative file path')
  })
})
