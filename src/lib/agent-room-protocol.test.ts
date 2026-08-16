import { describe, expect, it } from 'vitest'
import {
  desktopAgentRoomCapability,
  parseAgentRoomDirective,
  stripAgentRoomDirective,
} from './agent-room-protocol.ts'

describe('Agent Room desktop protocol', () => {
  it('parses a terminal audit request and removes only its control frame', () => {
    const answer = [
      'I will ask the desktop Agent Room to run the audit.',
      '<dsh-agent-room>{"action":"audit","task":"Audit the permission bridge"}</dsh-agent-room>',
    ].join('\n')
    expect(parseAgentRoomDirective(answer)).toEqual({ action: 'audit', text: 'Audit the permission bridge' })
    expect(stripAgentRoomDirective(answer)).toBe('I will ask the desktop Agent Room to run the audit.')
  })

  it('does not execute examples embedded in prose or malformed payloads', () => {
    expect(parseAgentRoomDirective('Example: <dsh-agent-room>{"action":"audit","task":"x"}</dsh-agent-room> then continue.')).toBeUndefined()
    expect(parseAgentRoomDirective('<dsh-agent-room>{not-json}</dsh-agent-room>')).toBeUndefined()
    expect(parseAgentRoomDirective('<dsh-agent-room>{"action":"audit","task":""}</dsh-agent-room>')).toBeUndefined()
  })

  it('describes the desktop broker without claiming a native subagent tool', () => {
    const instruction = desktopAgentRoomCapability('Codex', 'GPT test')
    expect(instruction).toContain('desktop-managed orchestration capability')
    expect(instruction).toContain('rather than spawning native subagents yourself')
    expect(instruction).toContain('Codex (GPT test)')
  })
})
