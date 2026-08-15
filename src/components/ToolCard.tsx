import type { ProcessBlock, WebToolView } from '../lib/types.ts'
import { isWebToolName } from '../lib/web-tools.ts'
import { Icon } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'

type ToolBlock = Extract<ProcessBlock, { kind: 'tool' }>

function safeUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  } catch {
    return undefined
  }
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

function webArgument(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== 'object' || parsed === null) return value
    const candidate = parsed as Record<string, unknown>
    return typeof candidate['query'] === 'string'
      ? candidate['query']
      : typeof candidate['url'] === 'string' ? candidate['url'] : value
  } catch {
    return value
  }
}

function duration(block: ToolBlock): string | undefined {
  if (block.startedAt === undefined || block.finishedAt === undefined) return undefined
  const milliseconds = Math.max(0, block.finishedAt - block.startedAt)
  return milliseconds < 1_000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1_000).toFixed(1)} s`
}

function statusLabel(block: ToolBlock, view: WebToolView): string {
  if (block.status === 'running') return view.kind === 'search' ? 'Searching' : 'Fetching'
  if (block.status === 'failed') return 'Failed'
  if (block.status === 'cancelled') return 'Cancelled'
  return view.kind === 'search' ? `${view.sources.length} source${view.sources.length === 1 ? '' : 's'}` : 'Fetched'
}

function WebCard({ block, view }: { block: ToolBlock; view: WebToolView }) {
  const query = view.kind === 'search' ? view.query ?? view.title ?? block.arguments : view.title ?? view.url ?? block.arguments
  const fetchUrl = view.kind === 'fetch' ? safeUrl(view.url) : undefined
  const elapsed = duration(block)
  return (
    <details className="web-tool-card" data-status={block.status ?? 'succeeded'} open={block.status === 'running'}>
      <summary>
        <span className="web-tool-icon"><Icon name="globe" size={14} /></span>
        <span className="web-tool-summary">
          <strong>{view.kind === 'search' ? 'Web search' : 'Web page'}</strong>
          <span>{query || (view.kind === 'search' ? 'Searching the web' : 'Fetching page')}</span>
        </span>
        <span className="web-tool-status"><i />{statusLabel(block, view)}{elapsed === undefined ? '' : ` · ${elapsed}`}</span>
        <Icon name="chevron-down" size={12} />
      </summary>
      <div className="web-tool-body">
        {view.kind === 'search' && view.answer !== undefined && <div className="web-tool-answer"><Markdown>{view.answer}</Markdown></div>}
        {view.kind === 'search' && view.sources.length > 0 && (
          <ol className="web-source-list">
            {view.sources.map((source, index) => {
              const href = safeUrl(source.url)
              return (
                <li key={`${source.url}-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    {href === undefined
                      ? <strong>{source.title ?? hostname(source.url)}</strong>
                      : <a href={href} target="_blank" rel="noreferrer">{source.title ?? hostname(source.url)}</a>}
                    <small>{hostname(source.url)}{source.publishedAt === undefined ? '' : ` · ${source.publishedAt}`}</small>
                    {source.snippet !== undefined && <p>{source.snippet}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {view.kind === 'search' && view.sources.length === 0 && block.status === 'succeeded' && (
          <p className="web-tool-empty">Source links are included in the assistant response when available.</p>
        )}
        {view.kind === 'fetch' && (
          <div className="web-fetch-meta">
            {fetchUrl === undefined ? <span>{view.url ?? 'Page URL unavailable'}</span> : <a href={fetchUrl} target="_blank" rel="noreferrer">{view.url}</a>}
            {view.statusCode !== undefined && <code>HTTP {view.statusCode}</code>}
          </div>
        )}
        {block.result !== undefined && (block.status === 'failed' || block.status === 'cancelled' || view.kind === 'fetch') && (
          <details className="web-tool-output"><summary>{block.status === 'failed' ? 'Error details' : 'Fetched content'}</summary><Markdown>{block.result}</Markdown></details>
        )}
        {view.truncated && <span className="web-tool-truncated">Result truncated by provider</span>}
      </div>
    </details>
  )
}

export function ToolCard({ block, compact = false }: { block: ToolBlock; compact?: boolean }) {
  if (block.view?.card === 'web' || isWebToolName(block.name)) {
    const argument = webArgument(block.arguments)
    const fallback: WebToolView = block.name.toLowerCase().includes('fetch')
      ? { card: 'web', kind: 'fetch', url: argument, truncated: false }
      : { card: 'web', kind: 'search', query: argument, sources: [], truncated: false }
    return <WebCard block={block} view={block.view ?? fallback} />
  }
  return (
    <div className={compact ? 'sidechat-tool' : 'tool-block'} data-status={block.status}>
      <div className={compact ? undefined : 'tool-heading'}>
        <Icon name="terminal" size={compact ? 12 : 14} />
        <span>{block.name || 'Tool call'}</span>
        {block.callId !== undefined && <code>{block.callId.slice(0, 8)}</code>}
      </div>
      {block.arguments !== '' && (compact ? <code>{block.arguments}</code> : <pre>{block.arguments}</pre>)}
    </div>
  )
}
