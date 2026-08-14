const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

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

/**
 * Extra payload policy for privileged preset/settings methods. The renderer
 * keeps a generic allowlisted RPC bridge, so settings.update is narrowed here
 * to the one namespace and field this desktop client owns.
 */
export function assertPresetRpcPayload(method: string, payload: unknown): void {
  if (method === 'agentPreset.list' || method === 'settings.describe' || method === 'settings.openDocument') {
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
      || value['ns'] !== 'agent-presets'
      || patch === undefined
      || !exactKeys(patch, ['default'])
      || !presetId(patch['default'])
      || (value['expectedRevision'] !== undefined
        && (typeof value['expectedRevision'] !== 'number' || !Number.isInteger(value['expectedRevision'])))
    ) throw new Error('settings.update is restricted to agent-presets.default')
  }
}
