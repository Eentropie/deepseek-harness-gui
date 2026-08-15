import type { EffectiveNetworkMode, NetworkMode } from './types.ts'

export const NETWORK_POLICY_MARKER = '[[dsh-network-policy:v1]]'

export function isNetworkMode(value: unknown): value is NetworkMode {
  return value === 'off' || value === 'auto' || value === 'ask'
}

export function codexWebSearchMode(mode: EffectiveNetworkMode): 'disabled' | 'live' {
  return mode === 'off' ? 'disabled' : 'live'
}

/** This hidden turn policy constrains the tools already exposed by the selected Host preset. */
export function deepSeekNetworkPolicy(mode: EffectiveNetworkMode): string {
  return mode === 'off'
    ? `${NETWORK_POLICY_MARKER}\nFor this turn, do not call web_search or web_fetch. Work only from the conversation and local workspace.`
    : `${NETWORK_POLICY_MARKER}\nFor this turn, web_search and web_fetch may be used when they materially improve accuracy. Cite the source URLs in the final answer. Do not browse unnecessarily.`
}

export function isNetworkPolicyText(value: string): boolean {
  return value.startsWith(NETWORK_POLICY_MARKER)
}
