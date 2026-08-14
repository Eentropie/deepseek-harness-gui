import { describe, expect, it } from 'vitest'
import {
  childSchemaNode,
  constChoices,
  hasAt,
  humanizeSetting,
  parseSettingValue,
  rootSchemaNode,
  schemaEnvelope,
  valueAt,
} from './settings-schema.ts'

const schema = schemaEnvelope({
  uid: 4,
  refs: {
    1: { type: 'const', value: 'queue', meta: {} },
    2: { type: 'const', value: 'steer', meta: {} },
    3: { type: 'union', list: [1, 2], meta: {} },
    4: { type: 'object', dict: { busyEnter: 3 }, meta: { default: {} } },
  },
})

describe('settings schema helpers', () => {
  it('walks serialized object schemas and extracts enum choices', () => {
    const root = rootSchemaNode(schema)
    const child = childSchemaNode(schema, root, 'busyEnter')
    expect(child?.type).toBe('union')
    expect(child === undefined ? [] : constChoices(schema, child)).toEqual(['queue', 'steer'])
  })

  it('reads paths without confusing absent and falsy values', () => {
    const value = { enabled: false, nested: { count: 0 } }
    expect(hasAt(value, ['enabled'])).toBe(true)
    expect(valueAt(value, ['nested', 'count'])).toBe(0)
    expect(hasAt(value, ['missing'])).toBe(false)
  })

  it('parses scalar values with schema bounds', () => {
    expect(parseSettingValue('5', { type: 'number', meta: { min: 1 } }, [])).toBe(5)
    expect(() => parseSettingValue('0', { type: 'number', meta: { min: 1 } }, [])).toThrow(/at least/)
    expect(humanizeSetting('maxParallelToolCalls')).toBe('Max Parallel Tool Calls')
  })
})
