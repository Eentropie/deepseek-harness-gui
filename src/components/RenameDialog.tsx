import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n.tsx'
import { Icon } from './Icon.tsx'

interface RenameDialogProps {
  open: boolean
  kind: 'session' | 'workspace'
  initialValue: string
  busy: boolean
  error?: string
  onClose: () => void
  onSubmit: (value: string) => void
}

export function RenameDialog({ open, kind, initialValue, busy, error, onClose, onSubmit }: RenameDialogProps) {
  const { tr } = useI18n()
  const [value, setValue] = useState(initialValue)
  const dialogRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(busy)
  const closeRef = useRef(onClose)
  busyRef.current = busy
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown, true)
      previousFocus?.focus()
    }
  }, [initialValue, open])

  if (!open) return null
  const title = kind === 'session'
    ? tr('Rename session', '重命名会话')
    : tr('Rename work folder', '重命名工作文件夹')
  const normalized = value.trim()
  const valid = normalized !== '' && normalized !== initialValue.trim()

  return (
    <div className="goal-dialog-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <form ref={dialogRef} className="goal-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title" onSubmit={event => {
        event.preventDefault()
        if (valid && !busy) onSubmit(normalized)
      }}>
        <header>
          <div className="goal-dialog-icon"><Icon name="edit" size={17} /></div>
          <div><p>{kind === 'session' ? tr('SESSION', '会话') : tr('WORK FOLDER', '工作文件夹')}</p><h2 id="rename-dialog-title">{title}</h2></div>
          <button type="button" className="icon-button quiet" onClick={onClose} disabled={busy} aria-label={tr('Close', '关闭')}><Icon name="x" size={14} /></button>
        </header>
        <label>
          <span>{tr('Name', '名称')}</span>
          <input ref={inputRef} value={value} maxLength={160} onChange={event => setValue(event.target.value)} aria-label={title} />
        </label>
        {error !== undefined && <div className="goal-dialog-error" role="alert">{error}</div>}
        <footer>
          <button type="button" onClick={onClose} disabled={busy}>{tr('Cancel', '取消')}</button>
          <button type="submit" className="primary" disabled={!valid || busy}>{busy ? tr('Renaming…', '正在重命名…') : tr('Rename', '重命名')}</button>
        </footer>
      </form>
    </div>
  )
}
