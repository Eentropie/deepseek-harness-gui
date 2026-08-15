import { useEffect, useState } from 'react'
import { Icon } from './Icon.tsx'

interface GoalDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initialObjective: string
  initialRounds: number
  busy: boolean
  error?: string
  onClose: () => void
  onSubmit: (objective: string, maxGoalRounds: number) => void
}

export function GoalDialog({ open, mode, initialObjective, initialRounds, busy, error, onClose, onSubmit }: GoalDialogProps) {
  const [objective, setObjective] = useState(initialObjective)
  const [rounds, setRounds] = useState(String(initialRounds))

  useEffect(() => {
    if (!open) return
    setObjective(initialObjective)
    setRounds(String(initialRounds))
  }, [initialObjective, initialRounds, open])

  if (!open) return null
  const parsedRounds = Number(rounds)
  const valid = objective.trim() !== '' && Number.isInteger(parsedRounds) && parsedRounds > 0 && parsedRounds <= 1_000

  return (
    <div className="goal-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <form className="goal-dialog" role="dialog" aria-modal="true" aria-label={mode === 'create' ? 'Set a goal' : 'Edit goal'} onSubmit={event => {
        event.preventDefault()
        if (valid && !busy) onSubmit(objective.trim(), parsedRounds)
      }}>
        <header><div className="goal-dialog-icon"><Icon name="sparkles" size={17} /></div><div><p>SESSION GOAL</p><h2>{mode === 'create' ? 'Set a goal' : 'Edit goal'}</h2></div><button type="button" className="icon-button quiet" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="x" size={14} /></button></header>
        <label><span>Objective</span><textarea autoFocus rows={4} value={objective} placeholder="Describe the concrete outcome this agent should pursue…" onChange={event => setObjective(event.target.value)} /></label>
        <label><span>Maximum goal rounds</span><input type="number" min={1} max={1000} step={1} value={rounds} onChange={event => setRounds(event.target.value)} /><small>The Host pauses the goal loop when this limit is reached.</small></label>
        {error !== undefined && <div className="goal-dialog-error">{error}</div>}
        <footer><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary" disabled={!valid || busy}>{busy ? 'Saving…' : mode === 'create' ? 'Create goal' : 'Save changes'}</button></footer>
      </form>
    </div>
  )
}
