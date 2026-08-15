import { describe, expect, it } from 'vitest'
import {
  agentPermissionChoices,
  configuredAgentGroups,
  independentAuditPrompt,
  judgmentPrompt,
  normalizeAgentRoom,
  rebuttalPrompt,
  type AgentRoomAgent,
} from './agent-room.ts'

const reviewer: AgentRoomAgent = {
  id: 'reviewer-1',
  label: 'DeepSeek reviewer',
  provider: 'deepseek',
  model: 'deepseek-v4',
  effort: 'high',
  permission: 'read-only',
  network: 'off',
  role: 'reviewer',
}

describe('Agent Room', () => {
  it('only exposes live model groups without a provider failure', () => {
    expect(configuredAgentGroups({
      current: { provider: 'deepseek', model: 'deepseek-v4' },
      routable: true,
      groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-v4', name: 'V4' }] },
        { id: 'codex-cli', name: 'Codex', models: [{ id: 'gpt-5', name: 'GPT-5' }] },
        { id: 'unconfigured', name: 'Unavailable API', models: [{ id: 'ghost', name: 'Ghost' }] },
      ],
      failures: [{ id: 'unconfigured', name: 'Unavailable API', message: 'credential missing' }],
    }).map(group => group.id)).toEqual(['deepseek', 'codex-cli'])
  })

  it('defaults every provider family to an explicit read-only audit mode', () => {
    expect(agentPermissionChoices('deepseek')[0]?.value).toBe('read-only')
    expect(agentPermissionChoices('codex-cli')[0]?.value).toBe('read-only')
    expect(agentPermissionChoices('deepseek')[1]?.isolated).toBe(true)
    expect(agentPermissionChoices('codex-cli')[1]?.isolated).toBe(true)
  })

  it('builds the three evidence-separated audit phases', () => {
    expect(independentAuditPrompt('Audit auth', reviewer)).toContain('[Agent Room · Independent audit]')
    expect(rebuttalPrompt('Audit auth', reviewer, [{ label: 'Codex challenger', output: 'Finding A' }])).toContain('Finding A')
    expect(judgmentPrompt('Audit auth', [{ agent: reviewer.label, phase: 'independent', output: 'Finding B' }])).toContain('[Agent Room · Final judgment]')
  })

  it('recovers an interrupted persisted run as stopped', () => {
    const room = normalizeAgentRoom({
      agents: [reviewer],
      task: 'Audit auth',
      phase: 'rebuttal',
      running: true,
      artifacts: [{ id: 'a', phase: 'independent', agentId: reviewer.id, status: 'running', startedAt: 1 }],
      updatedAt: 2,
    })
    expect(room.running).toBe(false)
    expect(room.phase).toBe('stopped')
    expect(room.artifacts[0]?.status).toBe('stopped')
  })
})
