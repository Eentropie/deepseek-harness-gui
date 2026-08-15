import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToolCard } from './ToolCard.tsx'

describe('ToolCard', () => {
  it('renders searchable source cards with safe external links', () => {
    const markup = renderToStaticMarkup(<ToolCard block={{
      kind: 'tool', name: 'web_search', arguments: 'query', status: 'succeeded',
      view: { card: 'web', kind: 'search', query: 'query', truncated: false, sources: [
        { url: 'https://example.com/current', title: 'Current source', snippet: 'A result.' },
        { url: 'javascript:alert(1)', title: 'Unsafe' },
      ] },
    }} />)
    expect(markup).toContain('Web search')
    expect(markup).toContain('Current source')
    expect(markup).toContain('href="https://example.com/current"')
    expect(markup).not.toContain('href="javascript:')
  })
})
