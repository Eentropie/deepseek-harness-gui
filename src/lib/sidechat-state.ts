import type { SidechatThreadSummary } from './types.ts'

const PLACEHOLDER_TITLE = /^Sidechat \d+$/

export function isPlaceholderSidechatTitle(title: string): boolean {
  return PLACEHOLDER_TITLE.test(title)
}

export function reconcileSidechatThreads(
  threads: SidechatThreadSummary[],
  hasBackingThread: (thread: SidechatThreadSummary) => boolean,
): SidechatThreadSummary[] {
  return threads.filter(thread => hasBackingThread(thread)
    || (thread.materialized !== true && isPlaceholderSidechatTitle(thread.title)))
}
