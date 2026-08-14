import type { AgentPresetEntry } from './types.ts'

export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

const builtInCopy: Record<string, { name: string; description: string }> = {
  standard: {
    name: 'Standard mode',
    description: 'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  },
  code: {
    name: 'Code mode',
    description: 'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations.',
  },
  minimal: {
    name: 'Minimal mode',
    description: 'Two-tool coding agent with persistent bash and str_replace_editor.',
  },
  cordis: {
    name: 'Creator mode',
    description: 'Built for creating custom agent presets, with Standard capabilities plus runtime inspection and preset-authoring guidance.',
  },
}

export function presetDisplay(entry: Pick<AgentPresetEntry, 'id' | 'trust' | 'name' | 'description'>): {
  name: string
  description?: string
} {
  const localized = entry.trust === 'system' ? builtInCopy[entry.id] : undefined
  return {
    name: localized?.name ?? entry.name ?? entry.id,
    ...(localized?.description ?? entry.description) === undefined
      ? {}
      : { description: localized?.description ?? entry.description },
  }
}

export function copyDraftError(id: string, rows: readonly Pick<AgentPresetEntry, 'id'>[]): string | undefined {
  if (id === '') return 'Enter an identifier.'
  if (!PRESET_ID.test(id)) return 'Use lowercase letters, numbers, and hyphens; start with a letter or number.'
  if (rows.some(row => row.id === id)) return 'That identifier already exists.'
  return undefined
}
