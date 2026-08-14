import { describe, expect, it } from 'vitest'
import {
  parseManagedOverrides,
  protectionReason,
  renderManagedOverrides,
  type HostPluginEntry,
} from './plugin-control.ts'

const optionalPlugin: HostPluginEntry = {
  entryId: 'include:agent-presets:tool-web',
  moduleName: '@deepseek-ai/dsh-tool-web',
  enabled: true,
  fiberPhase: 'active',
}

describe('managed plugin switches', () => {
  it('replaces an empty profile layer while preserving its comments', () => {
    const overrides = new Map([
      [optionalPlugin.entryId, {
        id: optionalPlugin.entryId,
        name: optionalPlugin.moduleName,
        disabled: true,
      }],
    ])
    const rendered = renderManagedOverrides('# user comments\n[]\n', overrides)
    expect(rendered).toContain('# user comments')
    expect(rendered).not.toContain('\n[]\n')
    expect(parseManagedOverrides(rendered).get(optionalPlugin.entryId)).toEqual({
      id: optionalPlugin.entryId,
      name: optionalPlugin.moduleName,
      disabled: true,
    })
  })

  it('preserves arbitrary user YAML and replaces only its managed block', () => {
    const source = [
      '- id: include:llm-deepseek',
      '  config:',
      '    apiKey: !!js dshHomePath("credentials")',
      '',
      '# >>> DeepSeek Workbench managed plugin switches',
      '- {"id":"include:skill-badge","name":"@deepseek-ai/dsh-skill-badge","disabled":true}',
      '# <<< DeepSeek Workbench managed plugin switches',
      '',
    ].join('\n')
    const overrides = parseManagedOverrides(source)
    overrides.set('include:skill-badge', {
      id: 'include:skill-badge',
      name: '@deepseek-ai/dsh-skill-badge',
      disabled: false,
    })
    const rendered = renderManagedOverrides(source, overrides)
    expect(rendered).toContain('apiKey: !!js dshHomePath("credentials")')
    expect(rendered.match(/managed plugin switches/g)).toHaveLength(2)
    expect(parseManagedOverrides(rendered).get('include:skill-badge')?.disabled).toBe(false)
  })

  it('locks the control path and runtime-generated entries', () => {
    expect(protectionReason(optionalPlugin)).toBeUndefined()
    expect(protectionReason({ ...optionalPlugin, entryId: 'include:plugin-inventory' })).toMatch(/清单/)
    expect(protectionReason({ ...optionalPlugin, entryId: 'c9f5e537' })).toMatch(/稳定配置 ID/)
  })
})
