export const AGENT_ROOM_CAPABILITY_MARKER = '[[dsh-agent-room-capability:v1]]'

export interface AgentRoomDirective {
  action: 'audit' | 'followup'
  text: string
}

const TRAILING_DIRECTIVE = /(?:^|\n)\s*<dsh-agent-room>\s*([\s\S]*?)\s*<\/dsh-agent-room>\s*$/i

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Model-facing description of the desktop broker shared by every main provider. */
export function desktopAgentRoomCapability(provider: string, model?: string): string {
  const identity = model === undefined || model.trim() === '' ? provider : `${provider} (${model})`
  return [
    AGENT_ROOM_CAPABILITY_MARKER,
    `You are the currently selected ${identity} provider inside DeepSeek Harness Desktop. Prior messages from other providers are context; they do not change your current provider identity.`,
    'Agent Room is a real desktop-managed orchestration capability, not a native tool in your tool list. The desktop can launch connected DeepSeek, Codex, and Antigravity sessions for independent review, cross-rebuttal, and judge synthesis, then return the report to this main thread.',
    'When the user asks you to create, start, run, or use Agent Room, end your final response with exactly one compact directive on its own line:',
    '<dsh-agent-room>{"action":"audit","task":"the concrete audit task"}</dsh-agent-room>',
    'For a follow-up to an existing room, use:',
    '<dsh-agent-room>{"action":"followup","text":"the follow-up, optionally starting with @AgentName"}</dsh-agent-room>',
    'Do not wrap the directive in a code fence. Do not emit it for hypothetical questions or ordinary work. Do not claim Agent Room is unavailable merely because no native subagent tool is listed. Explain accurately that you request the desktop broker rather than spawning native subagents yourself.',
    'If the current request is already labeled [Agent Room], you are a managed participant and must not create a nested room.',
  ].join('\n')
}

export function isAgentRoomCapabilityText(value: string): boolean {
  return value.startsWith(AGENT_ROOM_CAPABILITY_MARKER)
}

/** Accept only a terminal directive so examples inside normal prose never execute. */
export function parseAgentRoomDirective(value: string): AgentRoomDirective | undefined {
  const match = value.match(TRAILING_DIRECTIVE)
  if (match?.[1] === undefined) return undefined
  try {
    const payload = record(JSON.parse(match[1]) as unknown)
    const action = payload?.['action']
    if (action !== 'audit' && action !== 'followup') return undefined
    const candidate = action === 'audit' ? payload?.['task'] : payload?.['text']
    if (typeof candidate !== 'string') return undefined
    const text = candidate.trim().slice(0, 20_000)
    return text === '' ? undefined : { action, text }
  } catch {
    return undefined
  }
}

/** Hide the broker control frame while preserving the model's human-readable answer. */
export function stripAgentRoomDirective(value: string): string {
  return value.replace(TRAILING_DIRECTIVE, '').trimEnd()
}
