import type { ProcessBlock, ToolStatus, WebSource, WebToolView } from './types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function source(value: unknown): WebSource | undefined {
  const item = record(value)
  const url = string(item?.['url']) ?? string(item?.['link'])
  if (url === undefined) return undefined
  const title = string(item?.['title']) ?? string(item?.['name'])
  const snippet = string(item?.['snippet']) ?? string(item?.['description']) ?? string(item?.['text'])
  const publishedAt = string(item?.['publishedAt']) ?? string(item?.['published_at']) ?? string(item?.['date'])
  return {
    url,
    ...(title === undefined ? {} : { title }),
    ...(snippet === undefined ? {} : { snippet }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

export function isWebToolName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[\s.-]+/g, '_')
  return normalized === 'web_search' || normalized === 'web_fetch' || normalized === 'websearch'
}

/** Normalize the Host's presentation payload while ignoring unknown future cards. */
export function webToolView(value: unknown, fallbackQuery?: string): WebToolView | undefined {
  const wrapper = record(value)
  const raw = record(wrapper?.['view']) ?? wrapper
  if (raw?.['card'] !== 'web') return undefined
  const kind = string(raw['kind'])
  if (kind === 'search') {
    const sources = Array.isArray(raw['sources'])
      ? raw['sources'].flatMap(item => {
          const parsed = source(item)
          return parsed === undefined ? [] : [parsed]
        })
      : []
    const title = string(raw['title'])
    const query = string(raw['query']) ?? fallbackQuery
    const answer = string(raw['answer'])
    return {
      card: 'web',
      kind: 'search',
      ...(title === undefined ? {} : { title }),
      ...(query === undefined ? {} : { query }),
      sources,
      ...(answer === undefined ? {} : { answer }),
      truncated: boolean(raw['truncated']) ?? false,
    }
  }
  if (kind === 'fetch') {
    const title = string(raw['title'])
    const url = string(raw['url'])
    const statusCode = number(raw['statusCode'])
    return {
      card: 'web',
      kind: 'fetch',
      ...(title === undefined ? {} : { title }),
      ...(url === undefined ? {} : { url }),
      ...(statusCode === undefined ? {} : { statusCode }),
      truncated: boolean(raw['truncated']) ?? false,
    }
  }
  return undefined
}

function actionText(action: Record<string, unknown> | undefined, fallback: string): string {
  if (action === undefined) return fallback
  const type = string(action['type'])
  if (type === 'search') {
    const queries = Array.isArray(action['queries'])
      ? action['queries'].filter((item): item is string => typeof item === 'string')
      : []
    return string(action['query']) ?? (queries.join('\n') || fallback)
  }
  if (type === 'openPage') return string(action['url']) ?? fallback
  if (type === 'findInPage') return [string(action['url']), string(action['pattern'])].filter(Boolean).join(' · ') || fallback
  return fallback
}

/** Convert a Codex webSearch ThreadItem into the same neutral tool card as Host events. */
export function codexWebToolBlock(
  value: unknown,
  status: ToolStatus,
  timestamp?: number,
): Extract<ProcessBlock, { kind: 'tool' }> | undefined {
  const item = record(value)
  if (item?.['type'] !== 'webSearch') return undefined
  const action = record(item['action'])
  const actionType = string(action?.['type'])
  const query = string(item['query']) ?? actionText(action, 'Web search')
  const results = Array.isArray(item['results']) ? item['results'] : []
  const sources = results.flatMap(result => {
    const parsed = source(result)
    return parsed === undefined ? [] : [parsed]
  })
  const fetch = actionType === 'openPage' || actionType === 'findInPage'
  const url = string(action?.['url'])
  const view: WebToolView = fetch
    ? { card: 'web', kind: 'fetch', ...(url === undefined ? {} : { url }), truncated: false }
    : { card: 'web', kind: 'search', query, sources, truncated: false }
  return {
    kind: 'tool',
    name: fetch ? 'web_fetch' : 'web_search',
    arguments: actionText(action, query),
    ...(string(item['id']) === undefined ? {} : { callId: string(item['id']) }),
    status,
    ...(status === 'running' && timestamp !== undefined ? { startedAt: timestamp } : {}),
    ...(status !== 'running' && timestamp !== undefined ? { finishedAt: timestamp } : {}),
    view,
  }
}
