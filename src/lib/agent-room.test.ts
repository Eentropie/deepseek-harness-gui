import { describe, expect, it } from 'vitest'
import {
  agentPermissionChoices,
  agentRoomEffortLabel,
  buildAgentRoomContext,
  configuredAgentGroups,
  independentAuditPrompt,
  judgmentPrompt,
  normalizeAgentRoom,
  nonGitAgentPermissionFallback,
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

  it('uses Thinking for Claude while preserving other effort labels', () => {
    expect(agentRoomEffortLabel('anthropic', { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }, { id: 'high', name: 'High' })).toBe('Thinking')
    expect(agentRoomEffortLabel('antigravity-cli', { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }, { id: 'thinking', name: 'Thinking' })).toBe('Thinking')
    expect(agentRoomEffortLabel('codex-cli', { id: 'gpt-5', name: 'GPT-5' }, { id: 'high', name: 'High' })).toBe('High')
  })

  it('uses the real Host permission for DeepSeek and a real read-only Codex sandbox', () => {
    expect(agentPermissionChoices('deepseek', 'workspace-write')[0]?.value).toBe('workspace-write')
    expect(agentPermissionChoices('deepseek', 'workspace-write')).toHaveLength(1)
    expect(agentPermissionChoices('codex-cli')[0]?.value).toBe('read-only')
    expect(agentPermissionChoices('codex-cli')[1]?.isolated).toBe(true)
    expect(agentPermissionChoices('antigravity-cli').map(choice => choice.value)).toEqual(['read-only', 'workspace-write', 'full-access'])
    expect(agentPermissionChoices('antigravity-cli')[1]?.isolated).toBe(true)
  })

  it('falls writable CLI audits back to real read-only mode outside Git', () => {
    const error = 'Writable Agent Room agents require a Git workspace'
    expect(nonGitAgentPermissionFallback('codex-cli', error)).toBe('read-only')
    expect(nonGitAgentPermissionFallback('antigravity-cli', error)).toBe('read-only')
    expect(nonGitAgentPermissionFallback('deepseek', error)).toBeUndefined()
    expect(nonGitAgentPermissionFallback('codex-cli', 'permission denied')).toBeUndefined()
  })

  it('freezes a bounded parent transcript for independent agents', () => {
    const context = buildAgentRoomContext('parent', [{
      id: 'm1', seq: 1, time: 1, role: 'user', blocks: [{ kind: 'text', text: 'Audit the permission bridge' }],
    }])
    expect(context.sourceSessionId).toBe('parent')
    expect(context.transcript).toContain('Audit the permission bridge')
    expect(independentAuditPrompt('Audit auth', reviewer, context)).toContain('<frozen_parent_context>')
    expect(independentAuditPrompt('Audit auth', reviewer, context)).toContain('Do not modify workspace files')
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
