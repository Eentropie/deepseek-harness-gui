import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './Markdown.tsx'

describe('Markdown code blocks', () => {
  it('adds a copy control to fenced code blocks', () => {
    const markup = renderToStaticMarkup(<Markdown>{'```sh\npnpm test\n```'}</Markdown>)
    expect(markup).toContain('class="markdown-code-block"')
    expect(markup).toContain('aria-label="Copy code"')
    expect(markup).toContain('class="markdown-code-language">sh</span>')
    expect(markup).toContain('pnpm test')
  })

  it('keeps inline code inline without a copy control', () => {
    const markup = renderToStaticMarkup(<Markdown>{'Run `pnpm test` now.'}</Markdown>)
    expect(markup).toContain('class="inline-code"')
    expect(markup).not.toContain('markdown-code-copy')
  })
})
