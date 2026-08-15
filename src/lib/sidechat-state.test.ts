import { describe, expect, it } from 'vitest'
import { reconcileSidechatThreads } from './sidechat-state.ts'

describe('sidechat thread reconciliation', () => {
  it('removes a legacy named tab after its backing thread disappears', () => {
    const reconciled = reconcileSidechatThreads([
      { id: 'orphan', title: '你是什么模型' },
      { id: 'draft', title: 'Sidechat 2' },
    ], () => false)

    expect(reconciled).toEqual([{ id: 'draft', title: 'Sidechat 2' }])
  })

  it('keeps named tabs while their Host or Codex backing thread exists', () => {
    const reconciled = reconcileSidechatThreads([
      { id: 'host', title: 'Audit this patch', materialized: true },
      { id: 'codex', title: 'Second opinion' },
    ], thread => thread.id === 'host' || thread.id === 'codex')

    expect(reconciled).toHaveLength(2)
  })

  it('removes a materialized placeholder when its backing thread is gone', () => {
    expect(reconcileSidechatThreads([
      { id: 'lost', title: 'Sidechat 1', materialized: true },
    ], () => false)).toEqual([])
  })
})
