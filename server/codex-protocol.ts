import type {
  CodexCatalogModel,
  ConversationMessage,
  MessageBlock,
} from '../src/lib/types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function displayEffort(value: string): string {
  const labels: Record<string, string> = {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'X-High',
    max: 'Max',
    ultra: 'Ultra',
  }
  return labels[value] ?? value
}

/** Normalize the account-scoped App Server model catalog without exposing raw protocol data. */
export function normalizeCodexModels(value: unknown): CodexCatalogModel[] {
  const data = record(value)?.['data']
  if (!Array.isArray(data)) throw new Error('Codex App Server returned an invalid model catalog')
  const models: CodexCatalogModel[] = []
  for (const raw of data) {
    const model = record(raw)
    const id = string(model?.['id'])
    const name = string(model?.['displayName'])
    const defaultEffort = string(model?.['defaultReasoningEffort'])
    if (id === undefined || name === undefined || defaultEffort === undefined) continue
    if (boolean(model?.['hidden']) === true) continue
    const efforts = Array.isArray(model?.['supportedReasoningEfforts'])
      ? model['supportedReasoningEfforts'].flatMap(rawEffort => {
          const effort = record(rawEffort)
          const effortId = string(effort?.['reasoningEffort'])
          if (effortId === undefined) return []
          return [{
            id: effortId,
            name: displayEffort(effortId),
            ...(string(effort?.['description']) === undefined
              ? {}
              : { description: string(effort?.['description']) }),
          }]
        })
      : []
    if (!efforts.some(effort => effort.id === defaultEffort)) continue
    models.push({
      id,
      name,
      ...(string(model?.['description']) === undefined ? {} : { description: string(model?.['description']) }),
      defaultEffort,
      efforts,
      isDefault: boolean(model?.['isDefault']) === true,
    })
  }
  return models
}

function userText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap(item => {
    const input = record(item)
    return input?.['type'] === 'text' && typeof input['text'] === 'string' ? [input['text']] : []
  }).join('\n\n')
}

function itemBlocks(item: Record<string, unknown>): MessageBlock[] {
  const type = string(item['type'])
  if (type === 'agentMessage') return [{ kind: 'text', text: string(item['text']) ?? '' }]
  if (type === 'plan') return [{ kind: 'text', text: string(item['text']) ?? '' }]
  if (type === 'reasoning') {
    const summary = Array.isArray(item['summary']) ? item['summary'].filter((part): part is string => typeof part === 'string') : []
    const content = Array.isArray(item['content']) ? item['content'].filter((part): part is string => typeof part === 'string') : []
    const text = [...summary, ...content].join('\n\n')
    return text === '' ? [] : [{ kind: 'reasoning', text }]
  }
  if (type === 'commandExecution') {
    const command = string(item['command']) ?? ''
    const output = string(item['aggregatedOutput'])
    return [{ kind: 'tool', name: 'Terminal', arguments: output === undefined ? command : `${command}\n\n${output}` }]
  }
  if (type === 'fileChange') return [{ kind: 'tool', name: 'File changes', arguments: 'Codex updated workspace files.' }]
  if (type === 'mcpToolCall') {
    return [{
      kind: 'tool',
      name: `${string(item['server']) ?? 'MCP'} · ${string(item['tool']) ?? 'tool'}`,
      arguments: JSON.stringify(item['arguments'] ?? {}, null, 2),
    }]
  }
  if (type === 'dynamicToolCall') {
    return [{
      kind: 'tool',
      name: string(item['tool']) ?? 'Tool',
      arguments: JSON.stringify(item['arguments'] ?? {}, null, 2),
    }]
  }
  if (type === 'webSearch') return [{ kind: 'tool', name: 'Web search', arguments: '' }]
  if (type === 'imageView') return [{ kind: 'tool', name: 'View image', arguments: string(item['path']) ?? '' }]
  return []
}

/** Project a persisted Codex thread onto the renderer's provider-neutral transcript. */
export function projectCodexThread(value: unknown): ConversationMessage[] {
  const thread = record(record(value)?.['thread'])
  const turns = thread?.['turns']
  if (!Array.isArray(turns)) throw new Error('Codex App Server returned an invalid thread')
  const messages: ConversationMessage[] = []
  let seq = 0
  for (const rawTurn of turns) {
    const turn = record(rawTurn)
    const startedAt = number(turn?.['startedAt'])
    const baseTime = startedAt === undefined ? Date.now() : startedAt * 1_000
    const items = turn?.['items']
    if (!Array.isArray(items)) continue
    for (const rawItem of items) {
      const item = record(rawItem)
      if (item === undefined) continue
      seq += 1
      const id = string(item['id']) ?? `codex-${seq}`
      if (item['type'] === 'userMessage') {
        const text = userText(item['content'])
        if (text !== '') messages.push({
          id,
          seq,
          time: baseTime + seq,
          role: 'user',
          blocks: [{ kind: 'text', text }],
        })
        continue
      }
      const blocks = itemBlocks(item)
      if (blocks.length === 0) continue
      messages.push({
        id,
        seq,
        time: baseTime + seq,
        role: 'assistant',
        agent: 'Codex',
        blocks,
      })
    }
  }
  return messages
}
