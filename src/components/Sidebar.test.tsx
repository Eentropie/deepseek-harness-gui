import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar.tsx'
import type { SessionSummary, WorkspaceSummary } from '../lib/types.ts'
import { I18nProvider } from '../lib/i18n.tsx'

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
  it('keeps archived chats out of the main sidebar and omits deleted chats', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: noop })
    const markup = renderToStaticMarkup(
      <I18nProvider><Sidebar
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
      /></I18nProvider>,
    )

    expect(markup).toContain('active-preset')
    expect(markup).not.toContain('archived-preset')
    expect(markup).not.toContain('deleted-preset')
  })

  it('uses a compact button to open conversation search', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: noop })
    const markup = renderToStaticMarkup(
      <I18nProvider><Sidebar
        sessions={sessions}
        workspaces={workspaces}
        archivedSessionIds={[]}
        pinnedSessionIds={new Set()}
        unreadSessionIds={new Set()}
        deletedSessionIds={new Set()}
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
      /></I18nProvider>,
    )

    expect(markup).toContain('class="search-sessions"')
    expect(markup).toContain('Search conversations')
    expect(markup).not.toContain('class="search-box"')
  })
})
