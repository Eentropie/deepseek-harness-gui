import { Icon } from './Icon.tsx'
import type { ActivityItem } from '../lib/history.ts'
import type {
  GoalProjection,
  HostDescription,
  SessionModels,
  SessionSummary,
  SkillEntry,
  SubagentCatalog,
  SubagentEntry,
  WorkspaceSummary,
} from '../lib/types.ts'

interface InspectorProps {
  host?: HostDescription
  session?: SessionSummary
  workspace?: WorkspaceSummary
  models?: SessionModels
  activity: ActivityItem[]
  skills: SkillEntry[]
  subagents?: SubagentCatalog
  subagentView?: { id: string; label: string }
  onUseSkill: (name: string) => void
  onOpenSubagent: (entry: Extract<SubagentEntry, { kind: 'child' }>) => void
  onExitSubagent: () => void
  onGoalAction: (action: 'create' | 'edit' | 'pause' | 'resume' | 'complete' | 'clear') => void
  onClose: () => void
  onRefresh: () => void
}

function compact(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function duration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`
}

export function Inspector({ host, session, workspace, models, activity, skills, subagents, subagentView, onUseSkill, onOpenSubagent, onExitSubagent, onGoalAction, onClose, onRefresh }: InspectorProps) {
  const values = session?.projections?.values
  const pressure = values?.contextPressure
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens ?? 0
  const capacity = pressure?.contextWindow ?? 0
  const percent = capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0
  const tokens = values?.tokenUsage
  const stats = values?.sessionStats

  return (
    <aside className="inspector" aria-label="Session inspector">
      <div className="inspector-header">
        <div>
          <p>SESSION</p>
          <h2>Context</h2>
        </div>
        <div className="inspector-actions">
          {subagentView !== undefined && <button type="button" className="inspector-back" onClick={onExitSubagent}><Icon name="chevron-right" size={13} /> Parent</button>}
          <button type="button" className="icon-button quiet" onClick={onRefresh} aria-label="Refresh">
            <Icon name="refresh" size={15} />
          </button>
          <button type="button" className="icon-button quiet" onClick={onClose} aria-label="Close inspector">
            <Icon name="panel-right" size={15} />
          </button>
        </div>
      </div>

      <div className="inspector-scroll">
        <section className="inspector-section">
          <div className="section-heading"><span>Runtime</span><span className="status-chip" data-online={host !== undefined}>Local</span></div>
          <div className="runtime-card">
            <div className="runtime-line">
              <span className="runtime-logo"><Icon name="terminal" size={15} /></span>
              <div><strong>{host?.model ?? models?.current.model ?? 'Harness Host'}</strong><small>{host?.provider ?? 'Connecting…'}</small></div>
            </div>
            <dl className="detail-list">
              <div><dt>Host</dt><dd>127.0.0.1:3080</dd></div>
              <div><dt>Version</dt><dd>{host?.version ?? '—'}</dd></div>
              <div><dt>Preset</dt><dd>{session?.agentPreset ?? '—'}</dd></div>
            </dl>
          </div>
        </section>

        <section className="inspector-section">
          <div className="section-heading"><span>Context window</span><span>{capacity > 0 ? `${percent.toFixed(1)}%` : '—'}</span></div>
          <div className="meter"><i style={{ width: `${percent}%` }} /></div>
          <div className="metric-grid">
            <div><span>Input</span><strong>{compact(tokens?.uncachedInputTokens ?? 0)}</strong></div>
            <div><span>Output</span><strong>{compact(tokens?.outputTokens ?? 0)}</strong></div>
            <div><span>Cached</span><strong>{compact(tokens?.cacheReadTokens ?? 0)}</strong></div>
            <div><span>Window</span><strong>{capacity > 0 ? compact(capacity) : '—'}</strong></div>
          </div>
        </section>

        <section className="inspector-section">
          <div className="section-heading"><span>Session</span></div>
          <dl className="detail-list roomy">
            <div><dt>Workspace</dt><dd title={workspace?.path}>{workspace?.title ?? 'Ungrouped'}</dd></div>
            <div><dt>Directory</dt><dd title={session?.cwd}>{session?.cwd?.split('/').at(-1) ?? host?.cwd.split('/').at(-1) ?? '—'}</dd></div>
            <div><dt>Turns</dt><dd>{stats?.turns ?? 0}</dd></div>
            <div><dt>Steps</dt><dd>{stats?.steps ?? 0}</dd></div>
            <div><dt>Model time</dt><dd>{duration(stats?.llmMs ?? 0)}</dd></div>
            <div><dt>Tool time</dt><dd>{duration(stats?.toolMs ?? 0)}</dd></div>
          </dl>
        </section>

        {Array.isArray(values?.todos) && values.todos.length > 0 && (
          <section className="inspector-section">
            <div className="section-heading"><span>Tasks</span><span>{values.todos.length}</span></div>
            <div className="todo-list">
              {values.todos.map((todo, index) => (
                <div className="todo-row" data-status={todo.status} key={`${todo.content}-${index}`}>
                  <span><Icon name={todo.status === 'completed' ? 'check' : 'chevron-right'} size={12} /></span>
                  <p>{todo.content}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <GoalSection goal={values?.goal} onAction={onGoalAction} />

        {skills.length > 0 && (
          <section className="inspector-section">
            <div className="section-heading"><span>Skills</span><span>{skills.length}</span></div>
            <div className="skill-list">
              {skills.slice(0, 12).map(skill => (
                <button type="button" className="skill-row" key={skill.name} onClick={() => onUseSkill(skill.name)} title={skill.whenToUse ?? skill.description}>
                  <span><code>/{skill.name}</code><small>{skill.description}</small></span>
                  <Icon name="chevron-right" size={12} />
                </button>
              ))}
            </div>
          </section>
        )}

        {subagents !== undefined && (
          <section className="inspector-section">
            <div className="section-heading"><span>Subagents</span><span>{subagents.entries.length}</span></div>
            {!subagents.parentAvailable && <p className="empty-activity">Parent runtime is unavailable; transcripts remain readable.</p>}
            <div className="subagent-list">
              {subagents.entries.length === 0 ? <p className="empty-activity">No direct subagents in this session.</p> : subagents.entries.map(entry => (
                entry.kind === 'diagnostic' ? (
                  <div className="subagent-row diagnostic" key={entry.id}><span><strong>{entry.id.slice(0, 8)}</strong><small>{entry.reason}</small></span></div>
                ) : (
                  <button type="button" className="subagent-row" key={entry.id} onClick={() => onOpenSubagent(entry)}>
                    <span><strong>{entry.label ?? 'One-shot subagent'}</strong><small>{entry.mode} · {entry.activity}</small></span>
                    <Icon name="chevron-right" size={12} />
                  </button>
                )
              ))}
            </div>
          </section>
        )}

        <section className="inspector-section activity-section">
          <div className="section-heading"><span>Recent activity</span><Icon name="activity" size={14} /></div>
          {activity.length === 0 ? (
            <p className="empty-activity">No activity in this session yet.</p>
          ) : (
            <div className="activity-list">
              {activity.map(item => (
                <div className="activity-row" key={item.id}>
                  <i data-tone={item.tone} />
                  <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                  <time>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(item.time)}</time>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}

function GoalSection({ goal, onAction }: { goal?: GoalProjection | null; onAction: InspectorProps['onGoalAction'] }) {
  const current = goal?.goal
  return (
    <section className="inspector-section goal-section">
      <div className="section-heading"><span>Goal</span><span className="status-chip" data-online={current?.phase === 'active'}>{current?.phase ?? 'none'}</span></div>
      {current === undefined ? (
        <button type="button" className="inspector-action-button" onClick={() => onAction('create')}><Icon name="plus" size={13} /> Set a goal</button>
      ) : (
        <>
          <p className="goal-objective">{current.objective}</p>
          <div className="goal-meta">{goal?.roundsStarted ?? 0} / {current.maxGoalRounds} rounds · revision {current.revision}</div>
          {current.blockedReason !== undefined && <p className="goal-blocked">{current.blockedReason.message}</p>}
          <div className="goal-actions">
            {(current.phase === 'active' || current.phase === 'paused') && <button type="button" className="inspector-action-button" onClick={() => onAction(current.phase === 'active' ? 'pause' : 'resume')}>{current.phase === 'active' ? 'Pause' : 'Resume'}</button>}
            {current.phase !== 'complete' && <button type="button" className="inspector-action-button" onClick={() => onAction('edit')}>Edit</button>}
            <button type="button" className="inspector-action-button danger" onClick={() => onAction(current.phase === 'complete' ? 'clear' : 'complete')}>{current.phase === 'complete' ? 'Clear' : 'Complete'}</button>
          </div>
        </>
      )}
    </section>
  )
}
