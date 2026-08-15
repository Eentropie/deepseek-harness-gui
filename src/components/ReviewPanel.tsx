import { useCallback, useEffect, useState } from 'react'
import { reviewApi } from '../lib/api.ts'
import type { ReviewDocument, ReviewSnapshot } from '../lib/types.ts'
import { Icon } from './Icon.tsx'

interface ReviewPanelProps {
  sessionId?: string
  cwd?: string
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function ReviewPanel({ sessionId, cwd }: ReviewPanelProps) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>()
  const [document, setDocument] = useState<ReviewDocument>()
  const [draft, setDraft] = useState('')
  const [manualPath, setManualPath] = useState('')
  const [mode, setMode] = useState<'diff' | 'file'>('diff')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string>()

  const canDiscardDraft = (): boolean => document === undefined
    || draft === document.content
    || window.confirm('Discard the unsaved changes in this Review editor?')

  const openFile = useCallback(async (path: string): Promise<void> => {
    if (sessionId === undefined || cwd === undefined || path.trim() === '') return
    setLoading(true)
    setFailure(undefined)
    try {
      const next = await reviewApi.read({ sessionId, cwd, path: path.trim() })
      setDocument(next)
      setDraft(next.content)
      setManualPath(next.path)
      if (next.diff === '') setMode('file')
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setLoading(false)
    }
  }, [cwd, sessionId])

  const refresh = useCallback(async (): Promise<void> => {
    if (sessionId === undefined || cwd === undefined) {
      setSnapshot(undefined)
      setDocument(undefined)
      return
    }
    setLoading(true)
    setFailure(undefined)
    try {
      const next = await reviewApi.list({ sessionId, cwd })
      setSnapshot(next)
      if (document !== undefined) {
        await openFile(document.path)
      } else if (next.files[0] !== undefined) {
        await openFile(next.files[0].path)
      }
    } catch (reason) {
      setFailure(errorText(reason))
    } finally {
      setLoading(false)
    }
  }, [cwd, document, openFile, sessionId])

  useEffect(() => {
    setSnapshot(undefined)
    setDocument(undefined)
    setDraft('')
    setManualPath('')
    if (sessionId !== undefined && cwd !== undefined) void reviewApi.list({ sessionId, cwd }).then(next => {
      setSnapshot(next)
      if (next.files[0] !== undefined) void openFile(next.files[0].path)
    }).catch(reason => setFailure(errorText(reason)))
  }, [cwd, openFile, sessionId])

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

  if (sessionId === undefined || cwd === undefined) {
    return <div className="review-empty"><Icon name="document" size={18} /><strong>Open a session to review files</strong><span>Review is limited to the selected Harness work folder.</span></div>
  }

  return (
    <div className="workspace-review">
      <div className="review-toolbar">
        <div><strong>Workspace changes</strong><span>{snapshot?.files.length ?? 0}</span></div>
        <button type="button" className="icon-button quiet" onClick={() => { void refresh() }} disabled={loading} title="Refresh changed files"><Icon name="refresh" size={13} /></button>
      </div>
      <form className="review-open-path" onSubmit={event => { event.preventDefault(); if (canDiscardDraft()) void openFile(manualPath) }}><input value={manualPath} placeholder="Open relative file path…" onChange={event => setManualPath(event.target.value)} /><button type="submit" disabled={manualPath.trim() === '' || loading}>Open</button></form>
      {snapshot?.error !== undefined && <p className="review-notice">{snapshot.error}</p>}
      <div className="review-file-list">
        {snapshot?.files.map(file => <button type="button" data-active={document?.path === file.path} key={file.path} onClick={() => { if (canDiscardDraft()) void openFile(file.path) }}><code>{file.indexStatus}{file.worktreeStatus}</code><span title={file.path}>{file.path}</span></button>)}
        {snapshot !== undefined && snapshot.files.length === 0 && <p>No changed files. Enter a relative path above to read or edit another text file.</p>}
      </div>
      {document !== undefined && (
        <section className="review-document">
          <header><strong title={document.path}>{document.path}</strong><div><button type="button" data-active={mode === 'diff'} disabled={document.diff === ''} onClick={() => setMode('diff')}>Diff</button><button type="button" data-active={mode === 'file'} onClick={() => setMode('file')}>Edit</button></div></header>
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
