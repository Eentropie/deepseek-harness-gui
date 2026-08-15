import { useEffect, useState } from 'react'
import { Icon } from './Icon.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'
import { InteractionPanel, type QuestionAnswer } from './InteractionPanel.tsx'
import { ReviewPanel } from './ReviewPanel.tsx'
import { SidechatPanel } from './SidechatPanel.tsx'
import type { ActivityItem } from '../lib/history.ts'
import type {
  ApprovalRequest,
  ConversationMessage,
  GoalProjection,
  HostDescription,
  QuestionRequest,
  SessionModels,
  SessionSummary,
  SkillEntry,
  SubagentCatalog,
  SubagentEntry,
  WorkspaceSummary,
} from '../lib/types.ts'
import { platformBasename } from '../lib/platform.ts'
import type { ApprovalChoice } from '../lib/approval.ts'

type InspectorView = 'context' | 'review' | 'sidechat' | 'agents'

interface InspectorProps {
  host?: HostDescription
  session?: SessionSummary
  workspace?: WorkspaceSummary
  models?: SessionModels
  activity: ActivityItem[]
  skills: SkillEntry[]
  subagents?: SubagentCatalog
  subagentView?: { id: string; label: string }
  approvals: ApprovalRequest[]
  questions: QuestionRequest[]
  sidechat: {
    owner?: string
    parentTitle?: string
    threads: import('../lib/types.ts').SidechatThreadSummary[]
    activeThreadId?: string
    provider: string
    models?: SessionModels
    permissionOptions: import('../lib/types.ts').PermissionOption[]
    permission?: string
    network: import('../lib/types.ts').NetworkMode
    messages: ConversationMessage[]
    running: boolean
    error?: string
  }
  onUseSkill: (name: string) => void
  onOpenSubagent: (entry: Extract<SubagentEntry, { kind: 'child' }>) => void
  onExitSubagent: () => void
  onApproval: (request: ApprovalRequest, outcome: ApprovalChoice) => void
  onQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
  onSidechatSend: (text: string) => void
  onSidechatStop: () => void
  onSidechatNew: () => void
  onSidechatThread: (threadId: string) => void
  onSidechatClose: (threadId: string) => void
  onSidechatModel: (provider: string, model: string) => void
  onSidechatEffort: (effort: string) => void
  onSidechatPermission: (permission: string) => void
  onSidechatNetwork: (network: import('../lib/types.ts').NetworkMode) => void
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

const viewLabels: Record<InspectorView, string> = {
  context: 'Context',
  review: 'Review',
  sidechat: 'Sidechat',
  agents: 'Subagents',
}

export function Inspector({
  host,
  session,
  workspace,
  models,
  activity,
  skills,
  subagents,
  subagentView,
  approvals,
  questions,
  sidechat,
  onUseSkill,
  onOpenSubagent,
  onExitSubagent,
  onApproval,
  onQuestion,
  onSidechatSend,
  onSidechatStop,
  onSidechatNew,
  onSidechatThread,
  onSidechatClose,
  onSidechatModel,
  onSidechatEffort,
  onSidechatPermission,
  onSidechatNetwork,
  onGoalAction,
  onClose,
  onRefresh,
}: InspectorProps) {
  const [view, setView] = useState<InspectorView>('context')
  const reviewCount = approvals.length + questions.length
  const values = session?.projections?.values
  const pressure = values?.contextPressure
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens ?? 0
  const capacity = pressure?.contextWindow ?? 0
  const percent = capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0
  const tokens = values?.tokenUsage
  const stats = values?.sessionStats
  const runtimeProvider = models?.current.provider ?? host?.provider
  const runtimeModel = models?.current.model ?? host?.model

  useEffect(() => {
    if (reviewCount > 0) setView('review')
  }, [reviewCount])

  return (
    <aside className="inspector" aria-label="Session side panel">
      <div className="inspector-header">
        <div>
          <p>SIDE PANEL</p>
          <h2>{viewLabels[view]}</h2>
        </div>
        <div className="inspector-actions">
          {subagentView !== undefined && <button type="button" className="inspector-back" onClick={onExitSubagent}><Icon name="chevron-right" size={13} /> Parent</button>}
          <button type="button" className="icon-button quiet" onClick={onRefresh} aria-label="Refresh"><Icon name="refresh" size={15} /></button>
          <button type="button" className="icon-button quiet" onClick={onClose} aria-label="Close side panel"><Icon name="panel-right" size={15} /></button>
        </div>
      </div>

      <nav className="inspector-tabs" aria-label="Side panel views">
        <button type="button" data-active={view === 'context'} onClick={() => setView('context')} title="Context"><Icon name="sliders" size={14} /><span>Context</span></button>
        <button type="button" data-active={view === 'review'} onClick={() => setView('review')} title="Review"><Icon name="document" size={14} /><span>Review</span>{reviewCount > 0 && <b>{reviewCount}</b>}</button>
        <button type="button" data-active={view === 'sidechat'} onClick={() => setView('sidechat')} title="Sidechat"><Icon name="sparkles" size={14} /><span>Sidechat</span></button>
        <button type="button" data-active={view === 'agents'} onClick={() => setView('agents')} title="Subagents"><Icon name="agent" size={14} /><span>Agents</span>{(subagents?.entries.length ?? 0) > 0 && <b>{subagents?.entries.length}</b>}</button>
      </nav>

      {view === 'review' && (
        <div className="inspector-scroll inspector-review">
          <section className="review-approvals" data-empty={reviewCount === 0}>
            <div className="review-heading"><strong>Approvals</strong><span>{reviewCount === 0 ? 'Nothing waiting' : `${reviewCount} waiting`}</span></div>
            {reviewCount === 0 && <p><Icon name="check" size={12} /> No approvals waiting</p>}
            {approvals[0] !== undefined && <InteractionPanel approval={approvals[0]} onApproval={onApproval} onQuestion={onQuestion} />}
            {questions[0] !== undefined && <InteractionPanel question={questions[0]} onApproval={onApproval} onQuestion={onQuestion} />}
            {reviewCount > 2 && <p className="review-more">{reviewCount - 2} more request{reviewCount - 2 === 1 ? '' : 's'} will follow.</p>}
          </section>
          <ReviewPanel
            sessionId={session?.sessionId}
            cwd={workspace?.path ?? session?.cwd ?? host?.cwd}
          />
        </div>
      )}

      {view === 'sidechat' && (
        <SidechatPanel
          owner={sidechat.owner}
          parentTitle={sidechat.parentTitle}
          threads={sidechat.threads}
          activeThreadId={sidechat.activeThreadId}
          provider={sidechat.provider}
          models={sidechat.models}
          permissionOptions={sidechat.permissionOptions}
          permission={sidechat.permission}
          network={sidechat.network}
          messages={sidechat.messages}
          running={sidechat.running}
          error={sidechat.error}
          onSend={onSidechatSend}
          onStop={onSidechatStop}
          onNewThread={onSidechatNew}
          onThread={onSidechatThread}
          onCloseThread={onSidechatClose}
          onModel={onSidechatModel}
          onEffort={onSidechatEffort}
          onPermission={onSidechatPermission}
          onNetwork={onSidechatNetwork}
        />
      )}

      {view === 'agents' && (
        <div className="inspector-scroll inspector-agents">
          <div className="review-heading"><strong>Subagents</strong><span>{subagents?.entries.length ?? 0} direct</span></div>
          {subagentView !== undefined && <div className="active-subagent"><Icon name="agent" size={15} /><div><strong>{subagentView.label}</strong><span>{subagentView.id.slice(0, 12)}</span></div><button type="button" onClick={onExitSubagent}>Back to parent</button></div>}
          {subagents !== undefined && !subagents.parentAvailable && <p className="empty-activity">Parent runtime is unavailable; transcripts remain readable.</p>}
          <div className="subagent-list">
            {subagents === undefined || subagents.entries.length === 0 ? <div className="review-empty"><Icon name="agent" size={18} /><strong>No subagents yet</strong><span>Direct child agents created by this session will appear here with live status.</span></div> : subagents.entries.map(entry => (
              entry.kind === 'diagnostic' ? (
                <div className="subagent-row diagnostic" key={entry.id}><span><strong>{entry.id.slice(0, 8)}</strong><small>{entry.reason}</small></span></div>
              ) : (
                <button type="button" className="subagent-row" data-running={entry.activity === 'running'} key={entry.id} onClick={() => onOpenSubagent(entry)}>
                  <i />
                  <span><strong>{entry.label ?? 'One-shot subagent'}</strong><small>{entry.mode} · {entry.activity}{entry.hasChildren ? ' · nested' : ''}</small></span>
                  <Icon name="chevron-right" size={12} />
                </button>
              )
            ))}
          </div>
        </div>
      )}

      {view === 'context' && (
        <div className="inspector-scroll">
          <section className="inspector-section">
            <div className="section-heading"><span>Runtime</span><span className="status-chip" data-online={host !== undefined}>Local</span></div>
            <div className="runtime-card">
              <div className="runtime-line"><span className="runtime-logo"><ProviderLogo provider={runtimeProvider} name={runtimeModel} size={17} /></span><div><strong>{runtimeModel ?? 'Harness Host'}</strong><small>{runtimeProvider ?? 'Connecting…'}</small></div></div>
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
              <div><dt>Directory</dt><dd title={session?.cwd}>{platformBasename(session?.cwd) ?? platformBasename(host?.cwd) ?? '—'}</dd></div>
              <div><dt>Turns</dt><dd>{stats?.turns ?? 0}</dd></div>
              <div><dt>Steps</dt><dd>{stats?.steps ?? 0}</dd></div>
              <div><dt>Model time</dt><dd>{duration(stats?.llmMs ?? 0)}</dd></div>
              <div><dt>Tool time</dt><dd>{duration(stats?.toolMs ?? 0)}</dd></div>
            </dl>
          </section>

          {Array.isArray(values?.todos) && values.todos.length > 0 && (
            <section className="inspector-section">
              <div className="section-heading"><span>Tasks</span><span>{values.todos.length}</span></div>
              <div className="todo-list">{values.todos.map((todo, index) => <div className="todo-row" data-status={todo.status} key={`${todo.content}-${index}`}><span><Icon name={todo.status === 'completed' ? 'check' : 'chevron-right'} size={12} /></span><p>{todo.content}</p></div>)}</div>
            </section>
          )}

          <GoalSection goal={values?.goal} onAction={onGoalAction} />

          {skills.length > 0 && (
            <section className="inspector-section">
              <div className="section-heading"><span>Skills</span><span>{skills.length}</span></div>
              <div className="skill-list">{skills.slice(0, 12).map(skill => <button type="button" className="skill-row" key={skill.name} onClick={() => onUseSkill(skill.name)} title={skill.whenToUse ?? skill.description}><span><code>/{skill.name}</code><small>{skill.description}</small></span><Icon name="chevron-right" size={12} /></button>)}</div>
            </section>
          )}

          <section className="inspector-section activity-section">
            <div className="section-heading"><span>Recent activity</span><Icon name="activity" size={14} /></div>
            {activity.length === 0 ? <p className="empty-activity">No activity in this session yet.</p> : <div className="activity-list">{activity.map(item => <div className="activity-row" key={item.id}><i data-tone={item.tone} /><div><strong>{item.label}</strong><span>{item.detail}</span></div><time>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(item.time)}</time></div>)}</div>}
          </section>
        </div>
      )}
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
