const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/
const SETTINGS_NAMESPACE = /^[a-z0-9][a-z0-9-]{0,127}$/
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,127}$/
const MAX_WRITE_BYTES = 1_000_000

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function presetId(value: unknown): value is string {
  return typeof value === 'string' && PRESET_ID.test(value)
}

function emptyPayload(payload: unknown): boolean {
  const value = record(payload)
  return value !== undefined && Object.keys(value).length === 0
}

function revision(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
}

function namespace(value: unknown): value is string {
  return typeof value === 'string' && SETTINGS_NAMESPACE.test(value)
}

function credentialRef(value: unknown): value is string {
  return typeof value === 'string' && CREDENTIAL_REF.test(value)
}

function path(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 16
    && value.every(part => typeof part === 'string' && part.length <= 160 && !/[\u0000-\u001f]/.test(part))
}

function boundedJson(value: unknown): boolean {
  try {
    const encoded = JSON.stringify(value)
    return encoded !== undefined && encoded.length <= MAX_WRITE_BYTES
  } catch {
    return false
  }
}

function optionalString(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= max && !value.includes('\u0000'))
}

/**
 * Extra payload policy for privileged preset/settings methods. The renderer
 * keeps a generic allowlisted RPC bridge, so settings.update is narrowed here
 * to the one namespace and field this desktop client owns.
 */
export function assertDesktopRpcPayload(method: string, payload: unknown): void {
  if (
    method === 'agentPreset.list'
    || method === 'settings.describe'
    || method === 'settings.openDocument'
    || method === 'llm.providers'
    || method === 'llm.models'
  ) {
    if (!emptyPayload(payload)) throw new Error(`${method} accepts only an empty payload`)
    return
  }

  if (method === 'agentPreset.read' || method === 'agentPreset.openDocument' || method === 'agentPreset.remove') {
    const value = record(payload)
    if (value === undefined || !exactKeys(value, ['agentPreset']) || !presetId(value['agentPreset'])) {
      throw new Error(`${method} requires one safe agentPreset id`)
    }
    return
  }

  if (method === 'agentPreset.select') {
    const value = record(payload)
    if (
      value === undefined
      || !exactKeys(value, ['sessionId', 'agentPreset'])
      || typeof value['sessionId'] !== 'string'
      || value['sessionId'] === ''
      || !presetId(value['agentPreset'])
    ) throw new Error('agentPreset.select requires a session id and one safe preset id')
    return
  }

  if (method === 'agentPreset.copy') {
    const value = record(payload)
    if (
      value === undefined
      || !exactKeys(value, ['from', 'agentPreset', 'name'])
      || !presetId(value['from'])
      || !presetId(value['agentPreset'])
      || (value['name'] !== undefined && (typeof value['name'] !== 'string' || value['name'].length > 200))
    ) throw new Error('agentPreset.copy requires safe source and destination ids')
    return
  }

  if (method === 'settings.update') {
    const value = record(payload)
    const patch = record(value?.['patch'])
    if (
      value === undefined
      || !exactKeys(value, ['ns', 'patch', 'expectedRevision'])
      || !namespace(value['ns'])
      || patch === undefined
      || !boundedJson(patch)
      || !revision(value['expectedRevision'])
      || (value['ns'] === 'agent-presets'
        && (!exactKeys(patch, ['default']) || !presetId(patch['default'])))
    ) throw new Error('settings.update requires a safe namespace, patch, and revision')
    return
  }

  if (method === 'settings.replace') {
    const value = record(payload)
    const section = record(value?.['section'])
    if (
      value === undefined
      || !exactKeys(value, ['ns', 'section', 'expectedRevision'])
      || !namespace(value['ns'])
      || section === undefined
      || !boundedJson(section)
      || !revision(value['expectedRevision'])
    ) throw new Error('settings.replace requires a safe namespace, section, and revision')
    return
  }

  if (method === 'settings.mutate') {
    const value = record(payload)
    const ops = value?.['ops']
    if (
      value === undefined
      || !exactKeys(value, ['ns', 'ops', 'expectedRevision'])
      || !namespace(value['ns'])
      || !Array.isArray(ops)
      || ops.length === 0
      || ops.length > 100
      || !revision(value['expectedRevision'])
      || !ops.every(raw => {
        const op = record(raw)
        if (op === undefined || !path(op['path'])) return false
        if (op['op'] === 'unset') return exactKeys(op, ['op', 'path'])
        return op['op'] === 'set'
          && exactKeys(op, ['op', 'path', 'value'])
          && boundedJson(op['value'])
      })
    ) throw new Error('settings.mutate requires safe path operations')
    return
  }

  if (method === 'credentials.describe') {
    const value = record(payload)
    const refs = value?.['refs']
    if (
      value === undefined
      || !exactKeys(value, ['refs'])
      || !Array.isArray(refs)
      || refs.length === 0
      || refs.length > 100
      || !refs.every(credentialRef)
    ) throw new Error('credentials.describe requires safe credential references')
    return
  }

  if (method === 'credentials.set') {
    const value = record(payload)
    if (
      value === undefined
      || !exactKeys(value, ['ref', 'value'])
      || !credentialRef(value['ref'])
      || typeof value['value'] !== 'string'
      || value['value'].length === 0
      || value['value'].length > 65_536
      || value['value'].includes('\u0000')
    ) throw new Error('credentials.set requires one safe reference and value')
    return
  }

  if (method === 'credentials.unset') {
    const value = record(payload)
    if (value === undefined || !exactKeys(value, ['ref']) || !credentialRef(value['ref'])) {
      throw new Error('credentials.unset requires one safe credential reference')
    }
    return
  }

  if (method === 'llm.discoverModels') {
    const value = record(payload)
    const baseURL = value?.['baseURL']
    let validURL = true
    if (baseURL !== undefined) {
      try {
        const parsed = new URL(String(baseURL))
        validURL = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.href.length <= 2_048
      } catch {
        validURL = false
      }
    }
    if (
      value === undefined
      || !exactKeys(value, ['settingsNs', 'provider', 'baseURL', 'api', 'apiKey'])
      || !namespace(value['settingsNs'])
      || (value['provider'] !== undefined
        && (typeof value['provider'] !== 'string' || !PROVIDER_ID.test(value['provider'])))
      || !validURL
      || !optionalString(value['api'], 160)
      || !optionalString(value['apiKey'], 65_536)
    ) throw new Error('llm.discoverModels requires a safe provider draft')
  }
}
