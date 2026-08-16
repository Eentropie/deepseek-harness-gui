import { useState } from 'react'
import { Icon } from './Icon.tsx'
import type { QueueItem } from '../lib/types.ts'

interface QueueDockProps {
  items: QueueItem[]
  running: boolean
  disabled?: boolean
  onAction: (itemId: string, action: { kind: 'remove' | 'steer' } | { kind: 'edit'; text: string }) => void
}

export function QueueDock({ items, running, disabled = false, onAction }: QueueDockProps) {
  const queued = items.filter(item => item.placement === 'queued')
  const [expanded, setExpanded] = useState(queued.length < 2)
  const [editing, setEditing] = useState<{ id: string; text: string }>()
  if (queued.length === 0) return null

  return (
    <div className="queue-dock">
      {queued.length > 1 && (
        <button
          type="button"
          className="queue-header"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          disabled={editing !== undefined}
        >
          <Icon name="more" size={13} />
          <span>{queued.length} queued messages</span>
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />
        </button>
      )}
      {(expanded || queued.length === 1) && (
        <div className="queue-list">
          {queued.map(item => (
            <div className="queue-row" key={item.id}>
              {editing?.id === item.id ? (
                <input
                  autoFocus
                  value={editing.text}
                  aria-label="Edit queued message"
                  onChange={event => setEditing({ id: item.id, text: event.target.value })}
                  onKeyDown={event => {
                    if (event.key === 'Escape') setEditing(undefined)
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && editing.text.trim() !== '') {
                      event.preventDefault()
                      onAction(item.id, { kind: 'edit', text: editing.text })
                      setEditing(undefined)
                    }
                  }}
                />
              ) : (
                <span className="queue-preview" title={item.preview}>{item.preview || '[content]'}</span>
              )}
              {!disabled && (
                <span className="queue-actions">
                  {editing?.id === item.id ? (
                    <>
                      <button type="button" className="queue-action" aria-label="Save queued message" disabled={editing.text.trim() === ''} onClick={() => { onAction(item.id, { kind: 'edit', text: editing.text }); setEditing(undefined) }}><Icon name="check" size={13} /></button>
                      <button type="button" className="queue-action" aria-label="Cancel edit" onClick={() => setEditing(undefined)}><Icon name="x" size={13} /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="queue-action" aria-label="Edit queued message" title={item.text === null ? 'Only text messages can be edited' : undefined} disabled={item.text === null} onClick={() => setEditing({ id: item.id, text: item.text ?? '' })}><Icon name="edit" size={13} /></button>
                      <button type="button" className="queue-action" aria-label="Remove queued message" onClick={() => onAction(item.id, { kind: 'remove' })}><Icon name="trash" size={13} /></button>
                      <button
                        type="button"
                        className="queue-action"
                        aria-label={running ? 'Send queued message now' : 'Start queued message'}
                        title={running
                          ? item.source === 'antigravity' ? 'Antigravity will send this after the current response' : 'Send now in the current turn'
                          : item.source === 'antigravity' ? 'Start this queued Antigravity message' : item.source === 'codex' ? 'Start this queued Codex message' : 'Steering is available while the agent is running'}
                        disabled={running ? item.source === 'antigravity' : item.source !== 'codex' && item.source !== 'antigravity'}
                        onClick={() => onAction(item.id, { kind: 'steer' })}
                      ><Icon name="send" size={12} /></button>
                    </>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
