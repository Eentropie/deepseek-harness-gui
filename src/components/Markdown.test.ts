import { describe, expect, it } from 'vitest'
import { streamingMarkdownChunks } from './Markdown.tsx'

describe('streamingMarkdownChunks', () => {
  it('freezes completed top-level blocks in a long streaming answer', () => {
    const first = `${'A'.repeat(1_200)}\n\n`
    expect(streamingMarkdownChunks(`${first}tail`)).toEqual([first, 'tail'])
  })

  it('does not split blank lines inside fenced code', () => {
    const fenced = `${'A'.repeat(1_200)}\n\n\`\`\`ts\nconst a = 1\n\nconst b = 2\n\`\`\`\n\ntail`
    const chunks = streamingMarkdownChunks(fenced)
    expect(chunks).toHaveLength(3)
    expect(chunks[1]).toContain('const a = 1\n\nconst b = 2')
  })
})
