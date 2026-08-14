import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar.tsx'
import type { SessionSummary, WorkspaceSummary } from '../lib/types.ts'

const sessions: SessionSummary[] = [
  { sessionId: 'active', updatedAt: 3, running: false, blank: false, agentPreset: 'active-preset' },
  { sessionId: 'archived', updatedAt: 2, running: false, blank: false, agentPreset: 'archived-preset' },
  { sessionId: 'deleted', updatedAt: 1, running: false, blank: false, agentPreset: 'deleted-preset' },
]

const workspaces: WorkspaceSummary[] = [{
  workspaceId: 'workspace',
  path: '/tmp/workspace',
  title: 'Workspace',
  sessionIds: sessions.map(session => session.sessionId),
  createdAt: '2026-08-15T00:00:00Z',
  updatedAt: '2026-08-15T00:00:00Z',
}]

const noop = (): void => undefined

describe('Sidebar archived sessions', () => {
  it('shows archived chats in their own collapsed group and omits deleted chats', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        sessions={sessions}
        workspaces={workspaces}
        archivedSessionIds={['archived']}
        pinnedSessionIds={new Set()}
        unreadSessionIds={new Set()}
        deletedSessionIds={new Set(['deleted'])}
        collapsed={false}
        onSelect={noop}
        onNew={noop}
        onOpenFolder={noop}
        onWorkspace={noop}
        onToggle={noop}
        onPlugins={noop}
        onSettings={noop}
        searchHits={[]}
        searching={false}
        onSearch={noop}
        onSessionMenu={noop}
        onWorkspaceMenu={noop}
        onMoveWorkspace={noop}
        onMoveSession={noop}
      />,
    )

    expect(markup).toContain('Archived')
    expect(markup).toContain('active-preset')
    expect(markup).not.toContain('archived-preset')
    expect(markup).not.toContain('deleted-preset')
    expect(markup).toContain('aria-expanded="false"')
  })
})
