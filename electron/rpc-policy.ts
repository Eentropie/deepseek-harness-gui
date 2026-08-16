import { isAbsolute } from 'node:path'

const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const SETTINGS_NAMESPACE = /^[a-z0-9][a-z0-9-]{0,127}$/
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,127}$/
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const DANGEROUS_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor'])
const WRITABLE_SETTINGS_NAMESPACES = new Set([
  'ui-onboarding', 'agent-presets', 'llm-deepseek', 'web-search-deepseek',
  'ui-theme', 'locale', 'ui-conversation', 'shell', 'agent-loop',
  'permission', 'llm-pi-ai',
])
const MAX_SETTINGS_BYTES = 1_000_000
const MAX_RPC_BYTES = 32_000_000

export const DESKTOP_RPC_METHODS = [
  'host.describe', 'host.openPath', 'session.list', 'session.search',
  'workspace.list', 'workspace.create', 'workspace.rename', 'workspace.insertBefore',
  'workspace.insertSessionBefore', 'workspace.delete', 'workspace.archiveSession',
  'session.history', 'session.attachment', 'session.updateQueue', 'session.rename',
  'session.fork', 'session.models', 'session.create', 'session.prompt', 'session.cancel',
  'session.selectModel', 'subagent.list', 'subagent.history', 'subagent.prompt',
  'subagent.interrupt', 'skill.list', 'goal.create', 'goal.edit', 'goal.pause',
  'goal.resume', 'goal.complete', 'goal.clear', 'agentPreset.list', 'agentPreset.select',
  'agentPreset.read', 'agentPreset.copy', 'agentPreset.openDocument', 'agentPreset.remove',
  'settings.describe', 'settings.update', 'settings.replace', 'settings.mutate',
  'settings.openDocument', 'credentials.describe', 'credentials.set', 'credentials.unset',
  'llm.providers', 'llm.models', 'llm.discoverModels',
] as const

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function requiredRecord(payload: unknown, allowed: readonly string[], message: string): Record<string, unknown> {
  const value = record(payload)
  if (value === undefined || !exactKeys(value, allowed)) throw new Error(message)
  return value
}

function presetId(value: unknown): value is string {
  return typeof value === 'string' && PRESET_ID.test(value)
}

function safeString(value: unknown, max = 240, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= max
    && (allowEmpty || value.length > 0)
    && !/[\u0000-\u001f]/.test(value)
}

function boundedText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= max
    && (allowEmpty || value.trim().length > 0)
    && !value.includes('\u0000')
}

function optionalSafeString(value: unknown, max = 240): boolean {
  return value === undefined || safeString(value, max)
}

function identifier(value: unknown): value is string {
  return safeString(value, 240)
}

function absolutePath(value: unknown): value is string {
  return safeString(value, 4_096) && isAbsolute(value)
}

function emptyPayload(payload: unknown): boolean {
  const value = record(payload)
  return value !== undefined && Object.keys(value).length === 0
}

function revision(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
}

function nonNegativeInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
}

function namespace(value: unknown): value is string {
  return typeof value === 'string' && SETTINGS_NAMESPACE.test(value)
}

function writableNamespace(value: unknown): value is string {
  return namespace(value) && WRITABLE_SETTINGS_NAMESPACES.has(value)
}

function credentialRef(value: unknown): value is string {
  return typeof value === 'string' && CREDENTIAL_REF.test(value)
}

function settingsPath(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 16
    && value.every(part => safeString(part, 160) && !DANGEROUS_PATH_PARTS.has(part))
}

function boundedJson(value: unknown, max = MAX_RPC_BYTES): boolean {
  try {
    const encoded = JSON.stringify(value)
    return encoded !== undefined && encoded.length <= max
  } catch {
    return false
  }
}

function optionalString(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max && !value.includes('\u0000'))
}

function promptContent(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) return false
  return value.every(raw => {
    const part = record(raw)
    if (part === undefined) return false
    if (part['type'] === 'text') {
      return exactKeys(part, ['type', 'text'])
        && typeof part['text'] === 'string'
        && part['text'].length <= 1_000_000
    }
    return part['type'] === 'image'
      && exactKeys(part, ['type', 'mediaType', 'data', 'name'])
      && IMAGE_MEDIA_TYPES.has(String(part['mediaType']))
      && typeof part['data'] === 'string'
      && part['data'].length > 0
      && part['data'].length <= 24_000_000
      && optionalString(part['name'], 255)
  })
}

function goalRef(value: unknown): boolean {
  const ref = record(value)
  return ref !== undefined
    && exactKeys(ref, ['id', 'revision'])
    && identifier(ref['id'])
    && nonNegativeInteger(ref['revision'])
}

function assertSessionIdPayload(method: string, payload: unknown): void {
  const value = requiredRecord(payload, ['sessionId'], `${method} requires one session id`)
  if (!identifier(value['sessionId'])) throw new Error(`${method} requires one session id`)
}

/** Strict renderer-to-Host payload policy. Every allowlisted method is covered. */
export function assertDesktopRpcPayload(method: string, payload: unknown): void {
  if (!boundedJson(payload)) throw new Error(`${method} payload is too large or not serializable`)

  if (
    method === 'host.describe' || method === 'session.list' || method === 'workspace.list'
    || method === 'agentPreset.list' || method === 'settings.describe'
    || method === 'settings.openDocument' || method === 'llm.providers' || method === 'llm.models'
  ) {
    if (!emptyPayload(payload)) throw new Error(`${method} accepts only an empty payload`)
    return
  }

  if (method === 'host.openPath' || method === 'workspace.create') {
    const value = requiredRecord(payload, ['path'], `${method} requires one absolute path`)
    if (!absolutePath(value['path'])) throw new Error(`${method} requires one absolute path`)
    return
  }

  if (method === 'session.search') {
    const value = requiredRecord(payload, ['query'], 'session.search requires one bounded query')
    if (!safeString(value['query'], 1_000)) throw new Error('session.search requires one bounded query')
    return
  }

  if (method === 'workspace.rename') {
    const value = requiredRecord(payload, ['workspaceId', 'title'], 'workspace.rename payload is invalid')
    if (!identifier(value['workspaceId']) || !safeString(value['title'], 300)) throw new Error('workspace.rename payload is invalid')
    return
  }

  if (method === 'workspace.insertBefore') {
    const value = requiredRecord(payload, ['workspaceId', 'beforeWorkspaceId'], 'workspace.insertBefore payload is invalid')
    if (!identifier(value['workspaceId']) || !optionalSafeString(value['beforeWorkspaceId'])) throw new Error('workspace.insertBefore payload is invalid')
    return
  }

  if (method === 'workspace.insertSessionBefore') {
    const value = requiredRecord(payload, ['workspaceId', 'sessionId', 'beforeSessionId'], 'workspace.insertSessionBefore payload is invalid')
    if (!identifier(value['workspaceId']) || !identifier(value['sessionId']) || !optionalSafeString(value['beforeSessionId'])) {
      throw new Error('workspace.insertSessionBefore payload is invalid')
    }
    return
  }

  if (method === 'workspace.delete') {
    const value = requiredRecord(payload, ['workspaceId'], 'workspace.delete requires one workspace id')
    if (!identifier(value['workspaceId'])) throw new Error('workspace.delete requires one workspace id')
    return
  }

  if (method === 'workspace.archiveSession' || method === 'session.models' || method === 'session.cancel' || method === 'skill.list') {
    assertSessionIdPayload(method, payload)
    return
  }

  if (method === 'session.history') {
    const value = requiredRecord(payload, ['sessionId', 'maxMessages', 'beforeSeq'], 'session.history payload is invalid')
    if (!identifier(value['sessionId']) || !nonNegativeInteger(value['maxMessages'], 500)
      || (value['beforeSeq'] !== undefined && !nonNegativeInteger(value['beforeSeq']))) {
      throw new Error('session.history payload is invalid')
    }
    return
  }

  if (method === 'session.attachment') {
    const value = requiredRecord(payload, ['sessionId', 'attachmentId'], 'session.attachment payload is invalid')
    if (!identifier(value['sessionId']) || !identifier(value['attachmentId'])) throw new Error('session.attachment payload is invalid')
    return
  }

  if (method === 'session.updateQueue') {
    const value = requiredRecord(payload, ['sessionId', 'itemId', 'action'], 'session.updateQueue payload is invalid')
    const action = record(value['action'])
    const validAction = action !== undefined && (
      ((action['kind'] === 'remove' || action['kind'] === 'steer') && exactKeys(action, ['kind']))
      || (action['kind'] === 'edit' && exactKeys(action, ['kind', 'content']) && promptContent(action['content']))
    )
    if (!identifier(value['sessionId']) || !identifier(value['itemId']) || !validAction) throw new Error('session.updateQueue payload is invalid')
    return
  }

  if (method === 'session.rename') {
    const value = requiredRecord(payload, ['sessionId', 'title'], 'session.rename payload is invalid')
    if (!identifier(value['sessionId']) || !safeString(value['title'], 500)) throw new Error('session.rename payload is invalid')
    return
  }

  if (method === 'session.fork') {
    const value = requiredRecord(payload, ['sessionId', 'atSeq'], 'session.fork payload is invalid')
    if (!identifier(value['sessionId']) || (value['atSeq'] !== undefined && !nonNegativeInteger(value['atSeq']))) throw new Error('session.fork payload is invalid')
    return
  }

  if (method === 'session.create') {
    const value = requiredRecord(payload, ['workspaceId', 'cwd', 'agentPreset'], 'session.create payload is invalid')
    if (!optionalSafeString(value['workspaceId']) || (value['cwd'] !== undefined && !absolutePath(value['cwd']))
      || (value['agentPreset'] !== undefined && !presetId(value['agentPreset']))) {
      throw new Error('session.create payload is invalid')
    }
    return
  }

  if (method === 'session.prompt') {
    const value = requiredRecord(payload, ['sessionId', 'mode', 'content', 'clientTimeZone'], 'session.prompt payload is invalid')
    if (!identifier(value['sessionId']) || (value['mode'] !== 'queue' && value['mode'] !== 'steer')
      || !promptContent(value['content']) || !safeString(value['clientTimeZone'], 120)) {
      throw new Error('session.prompt payload is invalid')
    }
    return
  }

  if (method === 'session.selectModel') {
    const value = requiredRecord(payload, ['sessionId', 'provider', 'model', 'reasoningEffort'], 'session.selectModel payload is invalid')
    if (!identifier(value['sessionId']) || !safeString(value['provider'], 160) || !safeString(value['model'], 240)
      || !optionalSafeString(value['reasoningEffort'], 80)) throw new Error('session.selectModel payload is invalid')
    return
  }

  if (method === 'subagent.list') {
    const value = requiredRecord(payload, ['parentSessionId'], 'subagent.list payload is invalid')
    if (!identifier(value['parentSessionId'])) throw new Error('subagent.list payload is invalid')
    return
  }

  if (method === 'subagent.history') {
    const value = requiredRecord(payload, ['parentSessionId', 'childSessionId', 'mode', 'maxMessages', 'beforeSeq'], 'subagent.history payload is invalid')
    if (!identifier(value['parentSessionId']) || !identifier(value['childSessionId'])
      || (value['mode'] !== 'one-shot' && value['mode'] !== 'continuable') || !nonNegativeInteger(value['maxMessages'], 500)
      || (value['beforeSeq'] !== undefined && !nonNegativeInteger(value['beforeSeq']))) throw new Error('subagent.history payload is invalid')
    return
  }

  if (method === 'subagent.prompt') {
    const value = requiredRecord(payload, ['parentSessionId', 'childSessionId', 'mode', 'content', 'clientTimeZone'], 'subagent.prompt payload is invalid')
    if (!identifier(value['parentSessionId']) || !identifier(value['childSessionId']) || value['mode'] !== 'continuable'
      || !promptContent(value['content']) || !safeString(value['clientTimeZone'], 120)) throw new Error('subagent.prompt payload is invalid')
    return
  }

  if (method === 'subagent.interrupt') {
    const value = requiredRecord(payload, ['parentSessionId', 'childSessionId', 'mode'], 'subagent.interrupt payload is invalid')
    if (!identifier(value['parentSessionId']) || !identifier(value['childSessionId']) || value['mode'] !== 'continuable') {
      throw new Error('subagent.interrupt payload is invalid')
    }
    return
  }

  if (method === 'goal.create') {
    const value = requiredRecord(payload, ['sessionId', 'objective', 'maxGoalRounds'], 'goal.create payload is invalid')
    if (!identifier(value['sessionId']) || !boundedText(value['objective'], 20_000)
      || (value['maxGoalRounds'] !== undefined && !nonNegativeInteger(value['maxGoalRounds'], 10_000))) throw new Error('goal.create payload is invalid')
    return
  }

  if (method === 'goal.edit') {
    const value = requiredRecord(payload, ['sessionId', 'ref', 'objective', 'maxGoalRounds'], 'goal.edit payload is invalid')
    if (!identifier(value['sessionId']) || !goalRef(value['ref'])
      || (value['objective'] !== undefined && !boundedText(value['objective'], 20_000))
      || (value['maxGoalRounds'] !== undefined && !nonNegativeInteger(value['maxGoalRounds'], 10_000))) throw new Error('goal.edit payload is invalid')
    return
  }

  if (method === 'goal.pause' || method === 'goal.resume' || method === 'goal.complete' || method === 'goal.clear') {
    const value = requiredRecord(payload, ['sessionId', 'ref'], `${method} payload is invalid`)
    if (!identifier(value['sessionId']) || !goalRef(value['ref'])) throw new Error(`${method} payload is invalid`)
    return
  }

  if (method === 'agentPreset.read' || method === 'agentPreset.openDocument' || method === 'agentPreset.remove') {
    const value = requiredRecord(payload, ['agentPreset'], `${method} requires one safe agentPreset id`)
    if (!presetId(value['agentPreset'])) throw new Error(`${method} requires one safe agentPreset id`)
    return
  }

  if (method === 'agentPreset.select') {
    const value = requiredRecord(payload, ['sessionId', 'agentPreset'], 'agentPreset.select payload is invalid')
    if (!identifier(value['sessionId']) || !presetId(value['agentPreset'])) throw new Error('agentPreset.select payload is invalid')
    return
  }

  if (method === 'agentPreset.copy') {
    const value = requiredRecord(payload, ['from', 'agentPreset', 'name'], 'agentPreset.copy payload is invalid')
    if (!presetId(value['from']) || !presetId(value['agentPreset']) || !optionalSafeString(value['name'], 200)) throw new Error('agentPreset.copy payload is invalid')
    return
  }

  if (method === 'settings.update') {
    const value = requiredRecord(payload, ['ns', 'patch', 'expectedRevision'], 'settings.update payload is invalid')
    const patch = record(value['patch'])
    if (value['ns'] !== 'agent-presets' || patch === undefined || !exactKeys(patch, ['default'])
      || !presetId(patch['default']) || !revision(value['expectedRevision']) || !boundedJson(patch, MAX_SETTINGS_BYTES)) {
      throw new Error('settings.update only supports the desktop agent preset default')
    }
    return
  }

  if (method === 'settings.replace') {
    const value = requiredRecord(payload, ['ns', 'section', 'expectedRevision'], 'settings.replace payload is invalid')
    const section = record(value['section'])
    if (!writableNamespace(value['ns']) || section === undefined || !boundedJson(section, MAX_SETTINGS_BYTES) || !revision(value['expectedRevision'])) {
      throw new Error('settings.replace requires a supported namespace, section, and revision')
    }
    return
  }

  if (method === 'settings.mutate') {
    const value = requiredRecord(payload, ['ns', 'ops', 'expectedRevision'], 'settings.mutate payload is invalid')
    const ops = value['ops']
    if (!writableNamespace(value['ns']) || !Array.isArray(ops) || ops.length === 0 || ops.length > 100
      || !revision(value['expectedRevision']) || !ops.every(raw => {
        const op = record(raw)
        if (op === undefined || !settingsPath(op['path'])) return false
        if (op['op'] === 'unset') return exactKeys(op, ['op', 'path'])
        return op['op'] === 'set' && exactKeys(op, ['op', 'path', 'value']) && boundedJson(op['value'], MAX_SETTINGS_BYTES)
      })) throw new Error('settings.mutate requires safe operations in a supported namespace')
    return
  }

  if (method === 'credentials.describe') {
    const value = requiredRecord(payload, ['refs'], 'credentials.describe payload is invalid')
    const refs = value['refs']
    if (!Array.isArray(refs) || refs.length === 0 || refs.length > 100 || !refs.every(credentialRef)) throw new Error('credentials.describe requires safe credential references')
    return
  }

  if (method === 'credentials.set') {
    const value = requiredRecord(payload, ['ref', 'value'], 'credentials.set payload is invalid')
    if (!credentialRef(value['ref']) || typeof value['value'] !== 'string' || value['value'].length === 0
      || value['value'].length > 65_536 || value['value'].includes('\u0000')) throw new Error('credentials.set requires one safe reference and value')
    return
  }

  if (method === 'credentials.unset') {
    const value = requiredRecord(payload, ['ref'], 'credentials.unset payload is invalid')
    if (!credentialRef(value['ref'])) throw new Error('credentials.unset requires one safe credential reference')
    return
  }

  if (method === 'llm.discoverModels') {
    const value = requiredRecord(payload, ['settingsNs', 'provider', 'baseURL', 'api', 'apiKey'], 'llm.discoverModels payload is invalid')
    const baseURL = value['baseURL']
    let validURL = true
    if (baseURL !== undefined) {
      try {
        const parsed = new URL(String(baseURL))
        validURL = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.href.length <= 2_048
      } catch {
        validURL = false
      }
    }
    if (!namespace(value['settingsNs']) || !String(value['settingsNs']).startsWith('llm-')
      || (value['provider'] !== undefined && (typeof value['provider'] !== 'string' || !PROVIDER_ID.test(value['provider'])))
      || !validURL || !optionalString(value['api'], 160) || !optionalString(value['apiKey'], 65_536)) {
      throw new Error('llm.discoverModels requires a safe provider draft')
    }
    return
  }

  throw new Error(`Desktop RPC policy has no payload schema for ${method}`)
}
