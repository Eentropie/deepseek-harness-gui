import type { AntigravityCatalogModel, ModelEffort } from '../src/lib/types.ts'

const EFFORT_ORDER = ['low', 'medium', 'high'] as const

function effortName(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function parsedVariant(id: string, name: string): { baseId: string; baseName: string; effort: string } {
  const match = id.match(/-(low|medium|high)$/)
  if (match === null) return { baseId: id, baseName: name.replace(/\s*\(Thinking\)\s*$/i, ''), effort: 'high' }
  return {
    baseId: id.slice(0, -match[0].length),
    baseName: name.replace(/\s*\((?:Low|Medium|High)\)\s*$/i, ''),
    effort: match[1] ?? 'medium',
  }
}

/** Collapse AGY's effort-specific model IDs into one model with hot-swappable efforts. */
export function parseAntigravityModels(output: string): AntigravityCatalogModel[] {
  const groups = new Map<string, { name: string; variants: Array<{ effort: string; model: string }> }>()
  output.split(/\r?\n/).forEach(line => {
    const [rawId, ...nameParts] = line.trim().split('\t')
    const id = rawId?.trim()
    const name = nameParts.join('\t').trim()
    if (id === undefined || id === '' || name === '') return
    const variant = parsedVariant(id, name)
    const current = groups.get(variant.baseId) ?? { name: variant.baseName, variants: [] }
    if (!current.variants.some(item => item.model === id)) current.variants.push({ effort: variant.effort, model: id })
    groups.set(variant.baseId, current)
  })

  return [...groups.entries()].map(([id, group], index) => {
    group.variants.sort((left, right) => EFFORT_ORDER.indexOf(left.effort as typeof EFFORT_ORDER[number]) - EFFORT_ORDER.indexOf(right.effort as typeof EFFORT_ORDER[number]))
    const efforts: ModelEffort[] = group.variants.map(item => ({ id: item.effort, name: effortName(item.effort) }))
    const defaultEffort = group.variants.some(item => item.effort === 'medium')
      ? 'medium'
      : group.variants.at(-1)?.effort ?? 'high'
    return {
      id,
      name: group.name,
      defaultEffort,
      efforts,
      variants: group.variants,
      isDefault: index === 0,
    }
  })
}

export function antigravityVariant(model: AntigravityCatalogModel, effort: string): string | undefined {
  return model.variants.find(item => item.effort === effort)?.model
}

export function antigravityNetworkInstruction(network: 'off' | 'auto'): string {
  return network === 'off'
    ? '[DeepSeek Harness network policy] Do not use search_web, read_url_content, browser tools, or any network-capable MCP tool during this turn.'
    : '[DeepSeek Harness network policy] Web and browser tools may be used when they materially improve the answer. Cite source URLs in the final response.'
}
