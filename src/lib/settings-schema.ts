export interface SerializedSchemaNode {
  type?: string
  meta?: {
    default?: unknown
    min?: number
    max?: number
    step?: number
    required?: boolean
    role?: string
  }
  dict?: Record<string, number>
  list?: number[]
  inner?: number
  sKey?: number
  value?: unknown
}

export interface SerializedSchema {
  uid?: number
  refs?: Record<string, SerializedSchemaNode>
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function schemaEnvelope(value: unknown): SerializedSchema | undefined {
  const source = asRecord(value)
  if (source === undefined || typeof source['uid'] !== 'number') return undefined
  const refs = asRecord(source['refs'])
  if (refs === undefined) return undefined
  return { uid: source['uid'], refs: refs as Record<string, SerializedSchemaNode> }
}

export function schemaNode(schema: SerializedSchema | undefined, id: number | undefined): SerializedSchemaNode | undefined {
  return id === undefined ? undefined : schema?.refs?.[String(id)]
}

export function rootSchemaNode(schema: SerializedSchema | undefined): SerializedSchemaNode | undefined {
  return schemaNode(schema, schema?.uid)
}

export function childSchemaNode(
  schema: SerializedSchema | undefined,
  parent: SerializedSchemaNode | undefined,
  key: string,
): SerializedSchemaNode | undefined {
  if (parent?.type === 'object') return schemaNode(schema, parent.dict?.[key])
  if (parent?.type === 'dict' || parent?.type === 'array') return schemaNode(schema, parent.inner)
  return undefined
}

export function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const part of path) {
    const source = asRecord(current)
    if (source === undefined || !(part in source)) return undefined
    current = source[part]
  }
  return current
}

export function hasAt(value: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return value !== undefined
  let current = value
  for (const [index, part] of path.entries()) {
    const source = asRecord(current)
    if (source === undefined || !(part in source)) return false
    if (index === path.length - 1) return true
    current = source[part]
  }
  return false
}

export function constChoices(schema: SerializedSchema | undefined, node: SerializedSchemaNode): unknown[] {
  if (node.type !== 'union' || node.list === undefined) return []
  const members = node.list.map(id => schemaNode(schema, id))
  return members.every(member => member?.type === 'const')
    ? members.map(member => member?.value)
    : []
}

export function humanizeSetting(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, letter => letter.toUpperCase())
}

export function metaDescription(node: SerializedSchemaNode): string {
  const facts: string[] = []
  if (node.meta?.required === true) facts.push('Required')
  if (node.meta?.min !== undefined) facts.push(`min ${node.meta.min}`)
  if (node.meta?.max !== undefined && Number.isFinite(node.meta.max)) facts.push(`max ${node.meta.max}`)
  if (node.meta?.default !== undefined) {
    const encoded = typeof node.meta.default === 'string'
      ? node.meta.default
      : JSON.stringify(node.meta.default)
    if (encoded.length <= 80) facts.push(`default ${encoded}`)
  }
  return facts.join(' · ')
}

export function encodeSettingValue(value: unknown, node: SerializedSchemaNode): string {
  if (value === undefined) return ''
  if (node.type === 'string') return typeof value === 'string' ? value : String(value)
  if (node.type === 'number') return typeof value === 'number' ? String(value) : ''
  if (node.type === 'boolean') return value === true ? 'true' : 'false'
  return JSON.stringify(value, null, 2)
}

export function parseSettingValue(raw: string, node: SerializedSchemaNode, choices: unknown[]): unknown {
  if (choices.length > 0) return JSON.parse(raw) as unknown
  if (node.type === 'string') return raw
  if (node.type === 'number') {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) throw new Error('Enter a valid number.')
    if (node.meta?.min !== undefined && parsed < node.meta.min) throw new Error(`Value must be at least ${node.meta.min}.`)
    if (node.meta?.max !== undefined && parsed > node.meta.max) throw new Error(`Value must be at most ${node.meta.max}.`)
    return parsed
  }
  if (node.type === 'boolean') return raw === 'true'
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('Enter valid JSON for this structured setting.')
  }
}
