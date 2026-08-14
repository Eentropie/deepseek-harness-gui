import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon.tsx'
import type { JobView } from '../lib/types.ts'

interface JobDockProps {
  jobs: JobView[]
}

function live(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

function statusLabel(status: JobView['status']): string {
  switch (status) {
    case 'running': return 'Running'
    case 'stopping': return 'Stopping'
    case 'completed': return 'Completed'
    case 'killed': return 'Killed'
    case 'failed': return 'Failed'
  }
}

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function JobDock({ jobs }: JobDockProps) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const ordered = useMemo(() => [...jobs].sort((left, right) => {
    if (live(left) !== live(right)) return live(left) ? -1 : 1
    return (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
  }), [jobs])
  const running = jobs.filter(live).length

  useEffect(() => {
    if (!open || running === 0) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [open, running])

  useEffect(() => {
    if (jobs.length === 0) setOpen(false)
  }, [jobs.length])

  if (jobs.length === 0) return null
  return (
    <div className="job-dock">
      <button type="button" className="job-trigger" aria-expanded={open} aria-label={`${jobs.length} background jobs`} onClick={() => setOpen(value => !value)}>
        <i data-running={running > 0} />
        <Icon name="activity" size={13} />
        <span>{running > 0 ? `${running} running` : `${jobs.length} jobs`}</span>
        <Icon name="chevron-down" size={11} />
      </button>
      {open && (
        <div className="job-menu" role="dialog" aria-label="Background jobs">
          {ordered.map(job => {
            const end = job.finishedAt ?? now
            return (
              <div className="job-row" data-status={job.status} key={job.id}>
                <i />
                <div><strong>{job.label}</strong><small>{job.kind} · {job.detail ?? statusLabel(job.status)}</small></div>
                <time>{duration(end - job.startedAt)}</time>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
