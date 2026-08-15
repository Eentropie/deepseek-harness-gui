import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agentWorkspaceApi, codexApi, harnessApi, subscribeCodex } from '../lib/api.ts'
import {
  AGENT_ROOM_CODEX_PROVIDER,
  AGENT_ROOM_ROLES,
  agentPermissionChoices,
  agentRoomOwnerId,
  configuredAgentGroups,
  independentAuditPrompt,
  judgmentPrompt,
  managedAgentHostSessionIds,
  readAgentRoom,
  rebuttalPrompt,
  writeAgentRoom,
  type AgentRoomAgent,
  type AgentRoomArtifact,
  type AgentRoomArtifactPhase,
  type AgentRoomRole,
  type AgentRoomSnapshot,
  EMPTY_AGENT_ROOM,
} from '../lib/agent-room.ts'
import { projectConversation } from '../lib/history.ts'
import { deepSeekNetworkPolicy } from '../lib/network-mode.ts'
import type { CodexEvent, ConversationMessage, NetworkMode, SessionModels, SubagentCatalog, SubagentEntry } from '../lib/types.ts'
import { Icon } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'

interface AgentRoomProps {
  hidden: boolean
  parentSessionId?: string
  parentTitle?: string
  cwd?: string
  agentPreset?: string
  models?: SessionModels
  nativeSubagents?: SubagentCatalog
  subagentView?: { id: string; label: string }
  onOpenNative: (entry: Extract<SubagentEntry, { kind: 'child' }>) => void
  onExitNative: () => void
  onManagedHostSessions: (sessionIds: string[]) => void
}

interface AgentDraft {
  provider: string
  model: string
  effort?: string
  permission: string
  network: NetworkMode
  role: AgentRoomRole
  label: string
}

interface ActiveRun {
  kind: 'host' | 'codex'
  hostSessionId?: string
  threadId?: string
  turnId?: string
}

const sleep = (milliseconds: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, milliseconds))

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function finalAssistantText(messages: ConversationMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const text = message.blocks.flatMap(block => block.kind === 'text' ? [block.text.trim()] : []).filter(Boolean).join('\n\n')
    if (text !== '') return text
  }
  return undefined
}

function resolvedNetwork(mode: NetworkMode): 'off' | 'auto' {
  if (mode !== 'ask') return mode
  return window.confirm('Allow this Agent Room participant to use web search for the next round?') ? 'auto' : 'off'
}

function phaseLabel(phase: AgentRoomSnapshot['phase']): string {
  if (phase === 'independent') return 'Independent review'
  if (phase === 'rebuttal') return 'Cross rebuttal'
  if (phase === 'judgment') return 'Judge synthesis'
  if (phase === 'completed') return 'Audit complete'
  if (phase === 'stopped') return 'Stopped'
  if (phase === 'failed') return 'Failed'
  return 'Ready'
}

export function AgentRoom({
  hidden,
  parentSessionId,
  parentTitle,
  cwd,
  agentPreset,
  models,
  nativeSubagents,
  subagentView,
  onOpenNative,
  onExitNative,
  onManagedHostSessions,
}: AgentRoomProps) {
  const groups = useMemo(() => configuredAgentGroups(models), [models])
  const [room, setRoom] = useState<AgentRoomSnapshot>(EMPTY_AGENT_ROOM)
  const roomRef = useRef(room)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<AgentDraft>()
  const [error, setError] = useState<string>()
  const stopped = useRef(false)
  const activeRuns = useRef(new Map<string, ActiveRun>())
  const activeParent = useRef(parentSessionId)

  const commitRoom = useCallback((update: (current: AgentRoomSnapshot) => AgentRoomSnapshot): AgentRoomSnapshot => {
    if (activeParent.current !== parentSessionId) return roomRef.current
    const next = update(roomRef.current)
    roomRef.current = next
    setRoom(next)
    if (parentSessionId !== undefined) writeAgentRoom(parentSessionId, next)
    onManagedHostSessions(managedAgentHostSessionIds(next))
    return next
  }, [onManagedHostSessions, parentSessionId])

  useEffect(() => {
    const previousParent = activeParent.current
    if (previousParent !== parentSessionId && previousParent !== undefined && roomRef.current.running) {
      stopped.current = true
      const stoppedRoom = { ...roomRef.current, running: false, phase: 'stopped' as const }
      writeAgentRoom(previousParent, stoppedRoom)
      void Promise.allSettled([...activeRuns.current.values()].map(run => {
        if (run.kind === 'host' && run.hostSessionId !== undefined) return harnessApi.cancel(run.hostSessionId)
        if (run.kind === 'codex' && run.threadId !== undefined && run.turnId !== undefined) return codexApi.interrupt(run.threadId, run.turnId)
        return Promise.resolve()
      }))
      activeRuns.current.clear()
    }
    activeParent.current = parentSessionId
    const next = parentSessionId === undefined ? EMPTY_AGENT_ROOM : readAgentRoom(parentSessionId)
    roomRef.current = next
    setRoom(next)
    setAdding(false)
    setError(undefined)
    onManagedHostSessions(managedAgentHostSessionIds(next))
  }, [onManagedHostSessions, parentSessionId])

  useEffect(() => {
    const firstGroup = groups[0]
    const firstModel = firstGroup?.models[0]
    if (firstGroup === undefined || firstModel === undefined) {
      setDraft(undefined)
      return
    }
    setDraft(current => {
      const currentModel = current === undefined
        ? undefined
        : groups.find(group => group.id === current.provider)?.models.find(model => model.id === current.model)
      if (current !== undefined && currentModel !== undefined) return current
      return {
        provider: firstGroup.id,
        model: firstModel.id,
        effort: firstModel.reasoning?.defaultEffort,
        permission: 'read-only',
        network: 'auto',
        role: roomRef.current.agents.length === 1 ? 'challenger' : roomRef.current.agents.length >= 2 ? 'judge' : 'reviewer',
        label: '',
      }
    })
  }, [groups])

  const selectedGroup = draft === undefined ? undefined : groups.find(group => group.id === draft.provider)
  const selectedModel = selectedGroup?.models.find(model => model.id === draft?.model)
  const selectedPermissions = draft === undefined ? [] : agentPermissionChoices(draft.provider)

  const updateAgent = useCallback((agentId: string, update: Partial<AgentRoomAgent>): AgentRoomAgent | undefined => {
    let result: AgentRoomAgent | undefined
    commitRoom(current => {
      let replacedHostSessionId: string | undefined
      const agents = current.agents.map(agent => {
        if (agent.id !== agentId) return agent
        if (update.hostSessionId !== undefined && agent.hostSessionId !== undefined && update.hostSessionId !== agent.hostSessionId) {
          replacedHostSessionId = agent.hostSessionId
        }
        result = { ...agent, ...update }
        return result
      })
      return {
        ...current,
        agents,
        retiredHostSessionIds: replacedHostSessionId === undefined
          ? current.retiredHostSessionIds
          : [...new Set([...current.retiredHostSessionIds, replacedHostSessionId])],
      }
    })
    return result
  }, [commitRoom])

  const updateArtifact = useCallback((artifact: AgentRoomArtifact): void => {
    commitRoom(current => ({
      ...current,
      artifacts: current.artifacts.some(item => item.id === artifact.id)
        ? current.artifacts.map(item => item.id === artifact.id ? artifact : item)
        : [...current.artifacts, artifact],
    }))
  }, [commitRoom])

  const handleModelDraft = (token: string): void => {
    const selection = groups.flatMap(group => group.models.map(model => ({ group, model, token: `${group.id}\u0000${model.id}` })))
      .find(item => item.token === token)
    if (selection === undefined) return
    setDraft(current => current === undefined ? current : {
      ...current,
      provider: selection.group.id,
      model: selection.model.id,
      effort: selection.model.reasoning?.defaultEffort,
      permission: 'read-only',
    })
  }

  const handleAdd = (): void => {
    if (draft === undefined || room.agents.length >= 8) return
    const role = AGENT_ROOM_ROLES.find(candidate => candidate.value === draft.role)
    const label = draft.label.trim() || `${role?.name ?? 'Agent'} · ${selectedModel?.name ?? draft.model}`
    const agent: AgentRoomAgent = {
      id: crypto.randomUUID(),
      label: label.slice(0, 64),
      provider: draft.provider,
      model: draft.model,
      ...(draft.effort === undefined ? {} : { effort: draft.effort }),
      permission: draft.permission,
      network: draft.network,
      role: draft.role,
    }
    commitRoom(current => ({ ...current, agents: [...current.agents, agent] }))
    setDraft(current => current === undefined ? current : {
      ...current,
      label: '',
      role: room.agents.length === 0 ? 'challenger' : room.agents.length === 1 ? 'judge' : 'reviewer',
      permission: 'read-only',
    })
    setAdding(false)
  }

  const handleRemove = (agentId: string): void => {
    if (room.running || !window.confirm('Remove this managed agent from the room? Its Host/Codex transcript will not be deleted.')) return
    commitRoom(current => {
      const removedHostSessionId = current.agents.find(agent => agent.id === agentId)?.hostSessionId
      return {
        ...current,
        agents: current.agents.filter(agent => agent.id !== agentId),
        artifacts: current.artifacts.filter(artifact => artifact.agentId !== agentId),
        retiredHostSessionIds: removedHostSessionId === undefined
          ? current.retiredHostSessionIds
          : [...new Set([...current.retiredHostSessionIds, removedHostSessionId])],
      }
    })
  }

  const runtimeDirectory = async (agent: AgentRoomAgent): Promise<{ cwd: string; isolated: boolean }> => {
    if (cwd === undefined || parentSessionId === undefined) throw new Error('The main thread has no working directory')
    const permission = agentPermissionChoices(agent.provider).find(choice => choice.value === agent.permission)
    if (permission?.isolated !== true) return { cwd, isolated: false }
    const workspace = await agentWorkspaceApi.ensure({ parentSessionId, cwd, agentId: agent.id })
    return { cwd: workspace.cwd, isolated: workspace.isolated }
  }

  const runCodex = async (agent: AgentRoomAgent, prompt: string, runtimeCwd: string): Promise<string> => {
    if (parentSessionId === undefined || agent.effort === undefined) throw new Error('Codex model metadata is unavailable')
    const owner = agentRoomOwnerId(parentSessionId, agent.id)
    let completed: Extract<CodexEvent, { type: 'turn-completed' }> | undefined
    let failed: Error | undefined
    let wake: (() => void) | undefined
    const signal = new Promise<void>(resolve => { wake = resolve })
    const dispose = subscribeCodex(event => {
      if (event.type === 'usage-updated' || event.sessionId !== owner) return
      if (event.type === 'turn-completed') {
        completed = event
        wake?.()
      } else if (event.type === 'error') {
        failed = new Error(event.message)
        wake?.()
      }
    })
    try {
      const result = await codexApi.prompt({
        sessionId: owner,
        ...(agent.codexThreadId === undefined ? {} : { threadId: agent.codexThreadId }),
        cwd: runtimeCwd,
        model: agent.model,
        effort: agent.effort,
        permission: agent.permission,
        network: resolvedNetwork(agent.network),
        prompt,
      })
      activeRuns.current.set(agent.id, { kind: 'codex', threadId: result.threadId, turnId: result.turnId })
      updateAgent(agent.id, { codexThreadId: result.threadId, runtimeCwd, isolated: runtimeCwd !== cwd })
      if (completed === undefined && failed === undefined) {
        await Promise.race([
          signal,
          sleep(10 * 60_000).then(() => { throw new Error('Codex agent timed out after 10 minutes') }),
        ])
      }
      if (failed !== undefined) throw failed
      if (completed?.status !== 'completed') throw new Error(completed?.error ?? `Codex agent ${completed?.status ?? 'stopped'}`)
      const snapshot = await codexApi.readThread(result.threadId)
      const output = finalAssistantText(snapshot.messages)
      if (output === undefined) throw new Error('Codex agent completed without a final answer')
      return output
    } finally {
      activeRuns.current.delete(agent.id)
      dispose()
    }
  }

  const runHost = async (agent: AgentRoomAgent, prompt: string, runtimeCwd: string): Promise<string> => {
    let sessionId = agent.runtimeCwd === runtimeCwd ? agent.hostSessionId : undefined
    if (sessionId === undefined) {
      const created = await harnessApi.createSession({
        cwd: runtimeCwd,
        ...(agentPreset === undefined ? {} : { agentPreset }),
      })
      sessionId = created.sessionId
      updateAgent(agent.id, { hostSessionId: sessionId, runtimeCwd, isolated: runtimeCwd !== cwd })
      await harnessApi.renameSession(sessionId, `${agent.label} · ${parentTitle ?? 'Agent Room'}`).catch(() => undefined)
    }
    activeRuns.current.set(agent.id, { kind: 'host', hostSessionId: sessionId })
    try {
      await harnessApi.selectModel(sessionId, agent.provider, agent.model, agent.effort)
      let permissionPage = await harnessApi.history(sessionId)
      if (permissionPage.projections?.values.permissions?.currentValue !== agent.permission) {
        await harnessApi.setPermission(sessionId, agent.permission)
        for (let attempt = 0; attempt < 80; attempt += 1) {
          if (stopped.current) throw new Error('Agent Room stopped')
          await sleep(attempt === 0 ? 140 : 300)
          const [page, sessions] = await Promise.all([harnessApi.history(sessionId), harnessApi.sessions()])
          permissionPage = page
          const running = sessions.items.find(session => session.sessionId === sessionId)?.running === true
          if (page.projections?.values.permissions?.currentValue === agent.permission && !running) break
          if (attempt === 79) throw new Error(`Host did not apply permission ${agent.permission}`)
        }
      }
      const baseline = projectConversation((await harnessApi.history(sessionId)).events).filter(message => message.role === 'assistant').length
      await harnessApi.prompt(sessionId, [
        { type: 'text', text: deepSeekNetworkPolicy(resolvedNetwork(agent.network)) },
        { type: 'text', text: prompt },
      ])
      let messages: ConversationMessage[] = []
      for (let attempt = 0; attempt < 1_000; attempt += 1) {
        if (stopped.current) throw new Error('Agent Room stopped')
        await sleep(attempt === 0 ? 180 : 620)
        const [page, sessions] = await Promise.all([harnessApi.history(sessionId), harnessApi.sessions()])
        messages = projectConversation(page.events)
        const answerCount = messages.filter(message => message.role === 'assistant').length
        const running = sessions.items.find(session => session.sessionId === sessionId)?.running === true
        if (answerCount > baseline && !running) break
        if (attempt === 999) throw new Error('Host agent timed out after 10 minutes')
      }
      const output = finalAssistantText(messages)
      if (output === undefined) throw new Error('Host agent completed without a final answer')
      return output
    } finally {
      activeRuns.current.delete(agent.id)
    }
  }

  const executeAgent = async (agentInput: AgentRoomAgent, prompt: string, phase: AgentRoomArtifactPhase): Promise<string> => {
    const artifact: AgentRoomArtifact = {
      id: `${phase}-${agentInput.id}-${crypto.randomUUID()}`,
      phase,
      agentId: agentInput.id,
      status: 'running',
      startedAt: Date.now(),
    }
    updateArtifact(artifact)
    try {
      const agent = roomRef.current.agents.find(candidate => candidate.id === agentInput.id) ?? agentInput
      const runtime = await runtimeDirectory(agent)
      const output = agent.provider === AGENT_ROOM_CODEX_PROVIDER
        ? await runCodex(agent, prompt, runtime.cwd)
        : await runHost(agent, prompt, runtime.cwd)
      updateArtifact({ ...artifact, status: 'completed', output, completedAt: Date.now() })
      return output
    } catch (reason) {
      const stoppedRun = stopped.current || errorText(reason) === 'Agent Room stopped'
      updateArtifact({ ...artifact, status: stoppedRun ? 'stopped' : 'failed', error: errorText(reason), completedAt: Date.now() })
      throw reason
    }
  }

  const handleRun = async (): Promise<void> => {
    if (room.running || room.task.trim() === '' || parentSessionId === undefined || cwd === undefined) return
    const participants = room.agents.filter(agent => agent.role !== 'judge')
    if (participants.length < 2) {
      setError('Add at least two non-judge agents for independent review and cross rebuttal.')
      return
    }
    const judge = room.agents.find(agent => agent.role === 'judge') ?? participants[0]
    stopped.current = false
    setError(undefined)
    commitRoom(current => ({ ...current, running: true, phase: 'independent', artifacts: [], finalOutput: undefined }))
    try {
      const independentSettled = await Promise.allSettled(participants.map(async agent => ({
        agent,
        output: await executeAgent(agent, independentAuditPrompt(room.task, agent), 'independent'),
      })))
      if (stopped.current) throw new Error('Agent Room stopped')
      const independent = independentSettled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      if (independent.length < 2) throw new Error('Fewer than two independent agents completed successfully')

      commitRoom(current => ({ ...current, phase: 'rebuttal' }))
      const rebuttalSettled = await Promise.allSettled(participants.map(async agent => ({
        agent,
        output: await executeAgent(agent, rebuttalPrompt(room.task, agent, independent
          .filter(item => item.agent.id !== agent.id)
          .map(item => ({ label: item.agent.label, output: item.output }))), 'rebuttal'),
      })))
      if (stopped.current) throw new Error('Agent Room stopped')
      const rebuttals = rebuttalSettled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      if (rebuttals.length === 0) throw new Error('No rebuttal agent completed successfully')

      commitRoom(current => ({ ...current, phase: 'judgment' }))
      const evidence = [
        ...independent.map(item => ({ agent: item.agent.label, phase: 'independent' as const, output: item.output })),
        ...rebuttals.map(item => ({ agent: item.agent.label, phase: 'rebuttal' as const, output: item.output })),
      ]
      const finalOutput = await executeAgent(judge, judgmentPrompt(room.task, evidence), 'judgment')
      commitRoom(current => ({ ...current, running: false, phase: 'completed', finalOutput }))
    } catch (reason) {
      const stoppedRun = stopped.current || errorText(reason) === 'Agent Room stopped'
      commitRoom(current => ({ ...current, running: false, phase: stoppedRun ? 'stopped' : 'failed' }))
      if (!stoppedRun) setError(errorText(reason))
    } finally {
      activeRuns.current.clear()
    }
  }

  const handleStop = async (): Promise<void> => {
    if (!room.running) return
    stopped.current = true
    const runs = [...activeRuns.current.values()]
    await Promise.allSettled(runs.map(run => {
      if (run.kind === 'host' && run.hostSessionId !== undefined) return harnessApi.cancel(run.hostSessionId)
      if (run.kind === 'codex' && run.threadId !== undefined && run.turnId !== undefined) return codexApi.interrupt(run.threadId, run.turnId)
      return Promise.resolve()
    }))
    commitRoom(current => ({ ...current, running: false, phase: 'stopped' }))
  }

  return (
    <div className="agent-room inspector-scroll" hidden={hidden} aria-label="Agent Room">
      <section className="agent-room-intro">
        <div>
          <span className="agent-room-kicker">DESKTOP ORCHESTRATION</span>
          <h3>Agent Room</h3>
          <p>Independent review, cross rebuttal, then a judge synthesis. Claude Code is not enabled.</p>
        </div>
        <button type="button" className="agent-room-add" onClick={() => setAdding(value => !value)} disabled={groups.length === 0 || room.agents.length >= 8 || room.running} aria-expanded={adding}>
          <Icon name={adding ? 'x' : 'plus'} size={13} /> {adding ? 'Cancel' : 'Add agent'}
        </button>
      </section>

      <div className="agent-source-strip" aria-label="Available connected model sources">
        {groups.length === 0 ? <span>No connected model source is available.</span> : groups.map(group => (
          <span key={group.id}><ProviderLogo provider={group.id} name={group.name} size={13} />{group.name}<b>{group.models.length}</b></span>
        ))}
      </div>

      {adding && draft !== undefined && (
        <section className="agent-create-card">
          <label><span>Name</span><input value={draft.label} onChange={event => setDraft(current => current === undefined ? current : { ...current, label: event.target.value })} placeholder="Optional agent name" maxLength={64} /></label>
          <label><span>Model source</span><select value={`${draft.provider}\u0000${draft.model}`} onChange={event => handleModelDraft(event.target.value)}>{groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={`${group.id}\u0000${model.id}`}>{model.name}</option>)}</optgroup>)}</select></label>
          <div className="agent-create-grid">
            <label><span>Role</span><select value={draft.role} onChange={event => setDraft(current => current === undefined ? current : { ...current, role: event.target.value as AgentRoomRole })}>{AGENT_ROOM_ROLES.map(role => <option key={role.value} value={role.value}>{role.name}</option>)}</select></label>
            <label><span>Effort</span><select value={draft.effort ?? ''} disabled={(selectedModel?.reasoning?.efforts.length ?? 0) === 0} onChange={event => setDraft(current => current === undefined ? current : { ...current, effort: event.target.value || undefined })}><option value="">Default</option>{selectedModel?.reasoning?.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}</select></label>
            <label><span>Permission</span><select value={draft.permission} onChange={event => setDraft(current => current === undefined ? current : { ...current, permission: event.target.value })}>{selectedPermissions.map(choice => <option key={choice.value} value={choice.value}>{choice.name}</option>)}</select></label>
            <label><span>Web</span><select value={draft.network} onChange={event => setDraft(current => current === undefined ? current : { ...current, network: event.target.value as NetworkMode })}><option value="off">Off</option><option value="auto">Auto</option><option value="ask">Ask each round</option></select></label>
          </div>
          <p>{selectedPermissions.find(choice => choice.value === draft.permission)?.description}</p>
          <button type="button" className="agent-create-confirm" onClick={handleAdd}>Add to room</button>
        </section>
      )}

      <section className="agent-room-section">
        <div className="review-heading"><strong>Managed agents</strong><span>{room.agents.length} configured</span></div>
        <div className="agent-roster">
          {room.agents.length === 0 ? <div className="review-empty compact"><Icon name="agent" size={18} /><strong>No managed agents</strong><span>Add only from connected API or subscription sources.</span></div> : room.agents.map(agent => {
            const status = [...room.artifacts].reverse().find(artifact => artifact.agentId === agent.id)
            return <article className="managed-agent-card" key={agent.id} data-running={status?.status === 'running'}>
              <div className="managed-agent-logo"><ProviderLogo provider={agent.provider} name={agent.model} size={17} /></div>
              <div><strong>{agent.label}</strong><span>{agent.role} · {agent.model}</span><small>{agent.permission} · web {agent.network}{agent.isolated ? ' · isolated' : ''}</small></div>
              <i data-status={status?.status ?? 'idle'} />
              <button type="button" onClick={() => handleRemove(agent.id)} disabled={room.running} aria-label={`Remove ${agent.label}`}><Icon name="x" size={12} /></button>
            </article>
          })}
        </div>
      </section>

      <section className="agent-room-section agent-task-card">
        <div className="review-heading"><strong>Adversarial audit</strong><span>{phaseLabel(room.phase)}</span></div>
        <textarea value={room.task} onChange={event => commitRoom(current => ({ ...current, task: event.target.value }))} placeholder="Describe the change, risk, or workspace area to audit…" disabled={room.running} />
        <div className="agent-pipeline" aria-label="Audit pipeline">
          {(['independent', 'rebuttal', 'judgment'] as const).map((phase, index) => <span key={phase} data-active={room.phase === phase} data-complete={room.phase === 'completed' || (phase === 'independent' && (room.phase === 'rebuttal' || room.phase === 'judgment')) || (phase === 'rebuttal' && room.phase === 'judgment')}><b>{index + 1}</b>{phase === 'independent' ? 'Review' : phase === 'rebuttal' ? 'Rebut' : 'Judge'}</span>)}
        </div>
        <div className="agent-room-actions">
          {room.running ? <button type="button" className="agent-stop-button" onClick={() => { void handleStop() }}><Icon name="stop" size={12} /> Stop room</button> : <button type="button" className="agent-run-button" onClick={() => { void handleRun() }} disabled={room.task.trim() === '' || room.agents.filter(agent => agent.role !== 'judge').length < 2}><Icon name="sparkles" size={13} /> Run adversarial audit</button>}
          <span>Reviewers default to read only. Write modes use isolated Git worktrees.</span>
        </div>
        {error !== undefined && <p className="agent-room-error">{error}</p>}
      </section>

      {room.artifacts.length > 0 && (
        <section className="agent-room-section">
          <div className="review-heading"><strong>Round evidence</strong><span>{room.artifacts.filter(item => item.status === 'completed').length}/{room.artifacts.length} complete</span></div>
          <div className="agent-artifacts">{room.artifacts.map(artifact => {
            const agent = room.agents.find(candidate => candidate.id === artifact.agentId)
            return <details key={artifact.id} data-status={artifact.status}>
              <summary><i /><span><strong>{agent?.label ?? 'Removed agent'}</strong><small>{artifact.phase} · {artifact.status}</small></span><Icon name="chevron-right" size={11} /></summary>
              <div>{artifact.output !== undefined ? <Markdown>{artifact.output}</Markdown> : <p>{artifact.error ?? 'Agent is working…'}</p>}</div>
            </details>
          })}</div>
        </section>
      )}

      {room.finalOutput !== undefined && (
        <section className="agent-room-section agent-final">
          <div className="review-heading"><strong>Judge verdict</strong><span>Final</span></div>
          <div className="agent-final-copy"><Markdown>{room.finalOutput}</Markdown></div>
        </section>
      )}

      <section className="agent-room-section native-agents">
        <div className="review-heading"><strong>Harness-native subagents</strong><span>{nativeSubagents?.entries.length ?? 0} direct</span></div>
        {subagentView !== undefined && <div className="active-subagent"><Icon name="agent" size={15} /><div><strong>{subagentView.label}</strong><span>{subagentView.id.slice(0, 12)}</span></div><button type="button" onClick={onExitNative}>Back to parent</button></div>}
        {nativeSubagents !== undefined && !nativeSubagents.parentAvailable && <p className="empty-activity">Parent runtime is unavailable; transcripts remain readable.</p>}
        <div className="subagent-list">
          {nativeSubagents === undefined || nativeSubagents.entries.length === 0 ? <p className="empty-activity">Native child agents created by the current Harness session will appear here.</p> : nativeSubagents.entries.map(entry => entry.kind === 'diagnostic'
            ? <div className="subagent-row diagnostic" key={entry.id}><span><strong>{entry.id.slice(0, 8)}</strong><small>{entry.reason}</small></span></div>
            : <button type="button" className="subagent-row" data-running={entry.activity === 'running'} key={entry.id} onClick={() => onOpenNative(entry)}><i /><span><strong>{entry.label ?? 'One-shot subagent'}</strong><small>{entry.mode} · {entry.activity}{entry.hasChildren ? ' · nested' : ''}</small></span><Icon name="chevron-right" size={12} /></button>) }
        </div>
      </section>
    </div>
  )
}
