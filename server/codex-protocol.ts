import type {
  CodexCatalogModel,
  CodexRateLimitBucket,
  CodexRateLimitWindow,
  CodexUsageSnapshot,
  ConversationMessage,
  MessageBlock,
} from '../src/lib/types.ts'
import { visibleProviderBlocks, visibleProviderText } from '../src/lib/provider-handoff.ts'
import { composeTurnBlocks } from '../src/lib/thought-process.ts'

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

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function rateLimitWindow(value: unknown): CodexRateLimitWindow | undefined {
  const raw = record(value)
  const usedPercent = number(raw?.['usedPercent'])
  if (usedPercent === undefined) return undefined
  const used = clampPercent(usedPercent)
  const windowDurationMins = number(raw?.['windowDurationMins'])
  const resetsAt = number(raw?.['resetsAt'])
  return {
    usedPercent: used,
    remainingPercent: 100 - used,
    ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

function rateLimitBucket(value: unknown, fallbackId: string, fallbackPlan?: string): CodexRateLimitBucket | undefined {
  const raw = record(value)
  if (raw === undefined) return undefined
  const id = string(raw['limitId']) ?? fallbackId
  const name = string(raw['limitName']) ?? (id === 'codex' ? 'Codex' : id)
  const planType = string(raw['planType']) ?? fallbackPlan
  const primary = rateLimitWindow(raw['primary'])
  const secondary = rateLimitWindow(raw['secondary'])
  const rawCredits = record(raw['credits'])
  const hasCredits = boolean(rawCredits?.['hasCredits'])
  const unlimited = boolean(rawCredits?.['unlimited'])
  const balance = string(rawCredits?.['balance'])
  const rawIndividual = record(raw['individualLimit'])
  const limit = string(rawIndividual?.['limit'])
  const used = string(rawIndividual?.['used'])
  const remainingPercent = number(rawIndividual?.['remainingPercent'])
  const individualResetsAt = number(rawIndividual?.['resetsAt'])
  const spendControlReached = boolean(raw['spendControlReached'])
  const reachedType = string(raw['rateLimitReachedType'])
  return {
    id,
    name,
    ...(planType === undefined ? {} : { planType }),
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
    ...(hasCredits === undefined || unlimited === undefined
      ? {}
      : { credits: { hasCredits, unlimited, ...(balance === undefined ? {} : { balance }) } }),
    ...(limit === undefined || used === undefined || remainingPercent === undefined || individualResetsAt === undefined
      ? {}
      : { individualLimit: { limit, used, remainingPercent: clampPercent(remainingPercent), resetsAt: individualResetsAt } }),
    ...(spendControlReached === undefined ? {} : { spendControlReached }),
    ...(reachedType === undefined ? {} : { reachedType }),
  }
}

/** Project account-scoped quota data without exposing the account email or raw auth payload. */
export function normalizeCodexUsage(
  accountValue: unknown,
  rateLimitsValue: unknown,
  usageValue: unknown,
  updatedAt = Date.now(),
): CodexUsageSnapshot {
  const account = record(record(accountValue)?.['account'])
  const accountType = string(account?.['type'])
  if (accountType !== 'chatgpt' && accountType !== 'apiKey' && accountType !== 'amazonBedrock') {
    throw new Error('Codex CLI is not signed in')
  }
  const planType = string(account?.['planType'])
  const rateResponse = record(rateLimitsValue)
  const byId = record(rateResponse?.['rateLimitsByLimitId'])
  const rateLimits = byId === undefined
    ? [rateLimitBucket(rateResponse?.['rateLimits'], 'codex', planType)].filter((value): value is CodexRateLimitBucket => value !== undefined)
    : Object.entries(byId).flatMap(([id, value]) => {
        const bucket = rateLimitBucket(value, id, planType)
        return bucket === undefined ? [] : [bucket]
      })
  const usage = record(usageValue)
  const dailyUsageBuckets = Array.isArray(usage?.['dailyUsageBuckets'])
    ? usage['dailyUsageBuckets'].flatMap(value => {
        const bucket = record(value)
        const startDate = string(bucket?.['startDate'])
        const tokens = number(bucket?.['tokens'])
        return startDate === undefined || tokens === undefined ? [] : [{ startDate, tokens: Math.max(0, tokens) }]
      })
    : []
  const rawSummary = record(usage?.['summary'])
  const summaryEntries = {
    lifetimeTokens: number(rawSummary?.['lifetimeTokens']),
    currentStreakDays: number(rawSummary?.['currentStreakDays']),
    longestStreakDays: number(rawSummary?.['longestStreakDays']),
    peakDailyTokens: number(rawSummary?.['peakDailyTokens']),
    longestRunningTurnSec: number(rawSummary?.['longestRunningTurnSec']),
  }
  const summary = Object.fromEntries(Object.entries(summaryEntries).filter(([, value]) => value !== undefined))
  return {
    available: true,
    accountType,
    ...(planType === undefined ? {} : { planType }),
    rateLimits,
    dailyUsageBuckets,
    ...(Object.keys(summary).length === 0 ? {} : { summary }),
    updatedAt,
  }
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
  if (type === 'plan') return [{ kind: 'reasoning', text: string(item['text']) ?? '' }]
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
  for (const [turnIndex, rawTurn] of turns.entries()) {
    const turn = record(rawTurn)
    const startedAt = number(turn?.['startedAt'])
    const baseTime = startedAt === undefined ? Date.now() : startedAt * 1_000
    const items = turn?.['items']
    if (!Array.isArray(items)) continue
    const assistantSteps: MessageBlock[][] = []
    let assistantSeq = 0
    for (const rawItem of items) {
      const item = record(rawItem)
      if (item === undefined) continue
      seq += 1
      const id = string(item['id']) ?? `codex-${seq}`
      if (item['type'] === 'userMessage') {
        const text = visibleProviderText(userText(item['content']))
        if (text !== undefined && text !== '') messages.push({
          id,
          seq,
          time: baseTime + seq,
          role: 'user',
          blocks: [{ kind: 'text', text }],
        })
        continue
      }
      const blocks = visibleProviderBlocks(itemBlocks(item))
      if (blocks.length === 0) continue
      assistantSteps.push(blocks)
      assistantSeq = seq
    }
    const assistantBlocks = composeTurnBlocks(assistantSteps)
    if (assistantBlocks.length > 0) {
      const turnId = string(turn?.['id']) ?? String(turnIndex)
      messages.push({
        id: `codex-turn-${turnId}`,
        seq: assistantSeq,
        time: baseTime + assistantSeq,
        role: 'assistant',
        agent: 'Codex',
        blocks: assistantBlocks,
      })
    }
  }
  return messages
}
