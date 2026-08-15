import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { reviewApi } from '../lib/api.ts'
import { platformBasename } from '../lib/platform.ts'
import type { ReviewDirectorySnapshot, ReviewDocument, ReviewSnapshot, ReviewTreeEntry } from '../lib/types.ts'
import { Icon } from './Icon.tsx'

interface ReviewPanelProps {
  sessionId?: string
  cwd?: string
}

interface DirectoryState {
  snapshot?: ReviewDirectorySnapshot
  loading?: boolean
  error?: string
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function childStyle(depth: number): CSSProperties {
  return { '--tree-depth': depth } as CSSProperties
}

export function ReviewPanel({ sessionId, cwd }: ReviewPanelProps) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>()
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [document, setDocument] = useState<ReviewDocument>()
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'diff' | 'file'>('diff')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [openingPath, setOpeningPath] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const workspaceKey = `${sessionId ?? ''}\u0000${cwd ?? ''}`
  const workspaceRef = useRef(workspaceKey)
  workspaceRef.current = workspaceKey

  const changedFiles = useMemo(() => new Map(
    (snapshot?.files ?? []).map(file => [file.path, `${file.indexStatus}${file.worktreeStatus}`] as const),
  ), [snapshot?.files])
  const changedDirectories = useMemo(() => {
    const result = new Set<string>([''])
    for (const file of snapshot?.files ?? []) {
      const parts = file.path.split('/')
      let path = ''
      for (const part of parts.slice(0, -1)) {
        path = path === '' ? part : `${path}/${part}`
        result.add(path)
      }
    }
    return result
  }, [snapshot?.files])

  const canDiscardDraft = (): boolean => document === undefined
    || draft === document.content
    || window.confirm('Discard the unsaved changes in this Review editor?')

  const openFile = useCallback(async (path: string): Promise<void> => {
    if (sessionId === undefined || cwd === undefined || path === '') return
    setLoading(true)
    setFailure(undefined)
    try {
      const next = await reviewApi.read({ sessionId, cwd, path })
      if (workspaceRef.current !== `${sessionId}\u0000${cwd}`) return
      setDocument(next)
      setDraft(next.content)
      setMode(next.diff === '' ? 'file' : 'diff')
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      if (workspaceRef.current === `${sessionId}\u0000${cwd}`) setLoading(false)
    }
  }, [cwd, sessionId])

  const openExternal = useCallback(async (path: string): Promise<void> => {
    if (sessionId === undefined || cwd === undefined || path === '' || openingPath !== undefined) return
    setOpeningPath(path)
    setFailure(undefined)
    try {
      await reviewApi.open({ sessionId, cwd, path })
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setOpeningPath(undefined)
    }
  }, [cwd, openingPath, sessionId])

  const loadDirectory = useCallback(async (path: string): Promise<void> => {
    if (sessionId === undefined || cwd === undefined) return
    const key = `${sessionId}\u0000${cwd}`
    setDirectories(current => ({ ...current, [path]: { ...current[path], loading: true, error: undefined } }))
    try {
      const next = await reviewApi.directory({ sessionId, cwd, path })
      if (workspaceRef.current !== key) return
      setDirectories(current => ({ ...current, [path]: { snapshot: next } }))
    } catch (reason) {
      if (workspaceRef.current !== key) return
      setDirectories(current => ({ ...current, [path]: { error: errorText(reason) } }))
    }
  }, [cwd, sessionId])

  const refresh = useCallback(async (): Promise<void> => {
    if (sessionId === undefined || cwd === undefined) return
    const key = `${sessionId}\u0000${cwd}`
    const paths = [...new Set(['', ...expanded])]
    setLoading(true)
    setFailure(undefined)
    try {
      const [nextSnapshot, ...nextDirectories] = await Promise.all([
        reviewApi.list({ sessionId, cwd }),
        ...paths.map(path => reviewApi.directory({ sessionId, cwd, path })),
      ])
      if (workspaceRef.current !== key) return
      setSnapshot(nextSnapshot as ReviewSnapshot)
      setDirectories(Object.fromEntries((nextDirectories as ReviewDirectorySnapshot[]).map(value => [value.path, { snapshot: value }])))
      if (document !== undefined && draft === document.content) await openFile(document.path)
    } catch (reason) {
      if (workspaceRef.current === key) setFailure(errorText(reason))
    } finally {
      if (workspaceRef.current === key) setLoading(false)
    }
  }, [cwd, document, draft, expanded, openFile, sessionId])

  useEffect(() => {
    setSnapshot(undefined)
    setDirectories({})
    setExpanded(new Set(['']))
    setDocument(undefined)
    setDraft('')
    setFailure(undefined)
    if (sessionId === undefined || cwd === undefined) return
    const key = `${sessionId}\u0000${cwd}`
    setLoading(true)
    void Promise.all([
      reviewApi.list({ sessionId, cwd }),
      reviewApi.directory({ sessionId, cwd, path: '' }),
    ]).then(([nextSnapshot, root]) => {
      if (workspaceRef.current !== key) return
      setSnapshot(nextSnapshot)
      setDirectories({ '': { snapshot: root } })
    }).catch(reason => {
      if (workspaceRef.current === key) setFailure(errorText(reason))
    }).finally(() => {
      if (workspaceRef.current === key) setLoading(false)
    })
  }, [cwd, sessionId])

  const toggleDirectory = (path: string): void => {
    const opening = !expanded.has(path)
    setExpanded(current => {
      const next = new Set(current)
      if (opening) next.add(path)
      else next.delete(path)
      return next
    })
    if (opening && directories[path]?.snapshot === undefined && directories[path]?.loading !== true) void loadDirectory(path)
  }

  const selectFile = (path: string): void => {
    if (document?.path === path || !canDiscardDraft()) return
    void openFile(path)
  }

  const save = async (): Promise<void> => {
    if (sessionId === undefined || cwd === undefined || document === undefined || draft === document.content || saving) return
    setSaving(true)
    setFailure(undefined)
    try {
      const next = await reviewApi.write({
        sessionId,
        cwd,
        path: document.path,
        content: draft,
        expectedHash: document.hash,
      })
      setDocument(next)
      setDraft(next.content)
      setSnapshot(await reviewApi.list({ sessionId, cwd }))
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setSaving(false)
    }
  }

  const renderDirectory = (path: string, depth: number): ReactNode => {
    const state = directories[path]
    if (state?.loading === true) return <div className="review-tree-message" style={childStyle(depth)}>Loading folder…</div>
    if (state?.error !== undefined) return <div className="review-tree-message error" style={childStyle(depth)}>{state.error}</div>
    if (state?.snapshot === undefined) return null
    return <>{state.snapshot.entries.map(entry => renderEntry(entry, depth))}{state.snapshot.truncated && <div className="review-tree-message" style={childStyle(depth)}>Only the first 1,000 items are shown.</div>}</>
  }

  const renderEntry = (entry: ReviewTreeEntry, depth: number): ReactNode => {
    const isDirectory = entry.kind === 'directory'
    const isExpanded = isDirectory && expanded.has(entry.path)
    const status = changedFiles.get(entry.path)
    const hasChanges = isDirectory && changedDirectories.has(entry.path)
    return <div className="review-tree-branch" key={entry.path}>
      <div
        className="review-tree-row"
        data-active={!isDirectory && document?.path === entry.path}
        data-hidden={entry.hidden}
        role="treeitem"
        aria-level={depth + 1}
        {...(isDirectory ? { 'aria-expanded': isExpanded } : {})}
        style={childStyle(depth)}
      >
        <button
          type="button"
          className="review-tree-select"
          title={isDirectory ? `${isExpanded ? 'Collapse' : 'Expand'} ${entry.name}` : 'Select for Review; double-click to open with the system app'}
          onClick={() => { if (isDirectory) toggleDirectory(entry.path); else selectFile(entry.path) }}
          onDoubleClick={() => { if (!isDirectory) void openExternal(entry.path) }}
        >
          <span className="review-tree-disclosure" data-open={isExpanded}>{isDirectory && <Icon name="chevron-right" size={10} />}</span>
          <Icon name={isDirectory ? 'folder' : 'document'} size={13} />
          <span>{entry.name}</span>
          {entry.symlink === true && <small title="Symbolic link">↗</small>}
          {status !== undefined && <code title="Git status">{status}</code>}
          {status === undefined && hasChanges && <i title="Contains changed files" />}
        </button>
        {!isDirectory && <button type="button" className="review-tree-open" disabled={openingPath !== undefined} title={`Open ${entry.name} with the system default app`} aria-label={`Open ${entry.name} with the system default app`} onClick={() => { void openExternal(entry.path) }}><Icon name="external-link" size={11} /></button>}
      </div>
      {isExpanded && renderDirectory(entry.path, depth + 1)}
    </div>
  }

  if (sessionId === undefined || cwd === undefined) {
    return <div className="review-empty"><Icon name="document" size={18} /><strong>Open a session to review files</strong><span>Review is limited to the selected Harness work folder.</span></div>
  }

  const rootExpanded = expanded.has('')
  return (
    <div className="workspace-review">
      <div className="review-toolbar">
        <div><strong>Workspace</strong><span title="Changed files">{snapshot?.files.length ?? 0}</span></div>
        <button type="button" className="icon-button quiet" onClick={() => { void refresh() }} disabled={loading} title="Refresh workspace files" aria-label="Refresh workspace files"><Icon name="refresh" size={13} /></button>
      </div>
      {snapshot?.error !== undefined && <p className="review-notice">{snapshot.error}</p>}
      <div className="review-tree" role="tree" aria-label={`Files in ${platformBasename(cwd)}`}>
        <div className="review-tree-row review-tree-root" role="treeitem" aria-level={1} aria-expanded={rootExpanded}>
          <button type="button" className="review-tree-select" title={rootExpanded ? 'Collapse work folder' : 'Expand work folder'} onClick={() => toggleDirectory('')}>
            <span className="review-tree-disclosure" data-open={rootExpanded}><Icon name="chevron-right" size={10} /></span>
            <Icon name="folder" size={14} />
            <strong title={cwd}>{platformBasename(cwd)}</strong>
            {changedDirectories.has('') && (snapshot?.files.length ?? 0) > 0 && <i title="Contains changed files" />}
          </button>
        </div>
        {rootExpanded && renderDirectory('', 1)}
      </div>
      <p className="review-tree-hint">Select a text file to review it. Double-click or use <Icon name="external-link" size={9} /> to open it in the system app.</p>
      {document !== undefined && (
        <section className="review-document">
          <header>
            <div className="review-document-location"><strong title={document.path}>{document.path}</strong><button type="button" className="icon-button quiet" disabled={openingPath !== undefined} title="Open with the system default app" aria-label="Open current file with the system default app" onClick={() => { void openExternal(document.path) }}><Icon name="external-link" size={11} /></button></div>
            <div><button type="button" data-active={mode === 'diff'} disabled={document.diff === ''} onClick={() => setMode('diff')}>Diff</button><button type="button" data-active={mode === 'file'} onClick={() => setMode('file')}>Edit</button></div>
          </header>
          {mode === 'diff'
            ? <pre className="review-diff">{document.diff === '' ? 'No Git diff for this file.' : document.diff}</pre>
            : <textarea className="review-editor" value={draft} spellCheck={false} onChange={event => setDraft(event.target.value)} />}
          <footer><span>{draft === document.content ? 'Saved on disk' : 'Unsaved changes'}</span><button type="button" className="primary" disabled={draft === document.content || saving} onClick={() => { void save() }}>{saving ? 'Saving…' : 'Save file'}</button></footer>
        </section>
      )}
      {failure !== undefined && <div className="sidechat-error">{failure}</div>}
    </div>
  )
}
