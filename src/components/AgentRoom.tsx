import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agentWorkspaceApi, antigravityApi, codexApi, harnessApi, subscribeAntigravity, subscribeCodex } from '../lib/api.ts'
import {
  AGENT_ROOM_ANTIGRAVITY_PROVIDER,
  AGENT_ROOM_CODEX_PROVIDER,
  AGENT_ROOM_ROLES,
  agentRoomReport,
  agentPermissionChoices,
  agentRoomOwnerId,
  buildAgentRoomContext,
  configuredAgentGroups,
  defaultAgentRoomAgents,
  independentAuditPrompt,
  judgmentPrompt,
  managedAgentHostSessionIds,
  readAgentRoom,
  rebuttalPrompt,
  roomFollowupPrompt,
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
import type { AntigravityEvent, AntigravityPermissionMode, CodexEvent, ConversationMessage, NetworkMode, SessionModels, SubagentCatalog, SubagentEntry } from '../lib/types.ts'
import { Icon } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'
import { useI18n } from '../lib/i18n.tsx'

export interface AgentRoomRequest {
  id: string
  kind: 'audit' | 'followup'
  text: string
}

interface AgentRoomProps {
  hidden: boolean
  parentSessionId?: string
  parentTitle?: string
  cwd?: string
  agentPreset?: string
  models?: SessionModels
  parentMessages: ConversationMessage[]
  hostPermission?: string
  request?: AgentRoomRequest
  nativeSubagents?: SubagentCatalog
  subagentView?: { id: string; label: string }
  onOpenNative: (entry: Extract<SubagentEntry, { kind: 'child' }>) => void
  onExitNative: () => void
  onManagedHostSessions: (sessionIds: string[]) => void
  onRequestHandled: (requestId: string) => void
  onDeliverReport: (report: string, parentSessionId: string) => Promise<void>
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
  kind: 'host' | 'codex' | 'antigravity'
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
  parentMessages,
  hostPermission = 'workspace-write',
  request,
  nativeSubagents,
  subagentView,
  onOpenNative,
  onExitNative,
  onManagedHostSessions,
  onRequestHandled,
  onDeliverReport,
}: AgentRoomProps) {
  const { tr } = useI18n()
  const groups = useMemo(() => configuredAgentGroups(models), [models])
  const [room, setRoom] = useState<AgentRoomSnapshot>(EMPTY_AGENT_ROOM)
  const roomRef = useRef(room)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<AgentDraft>()
  const [error, setError] = useState<string>()
  const [followup, setFollowup] = useState('')
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
        if (run.kind === 'antigravity' && run.threadId !== undefined && run.turnId !== undefined) return antigravityApi.interrupt(run.threadId, run.turnId)
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
        permission: firstGroup.id === AGENT_ROOM_CODEX_PROVIDER || firstGroup.id === AGENT_ROOM_ANTIGRAVITY_PROVIDER ? 'read-only' : hostPermission,
        network: 'auto',
        role: roomRef.current.agents.length === 1 ? 'challenger' : roomRef.current.agents.length >= 2 ? 'judge' : 'reviewer',
        label: '',
      }
    })
  }, [groups, hostPermission])

  const selectedGroup = draft === undefined ? undefined : groups.find(group => group.id === draft.provider)
  const selectedModel = selectedGroup?.models.find(model => model.id === draft?.model)
  const selectedPermissions = draft === undefined ? [] : agentPermissionChoices(draft.provider, hostPermission)

  useEffect(() => {
    if (parentSessionId === undefined) return
    commitRoom(current => {
      const agents = current.agents.map(agent => agent.provider === AGENT_ROOM_CODEX_PROVIDER || agent.provider === AGENT_ROOM_ANTIGRAVITY_PROVIDER
        ? agent
        : { ...agent, permission: hostPermission, effectivePermission: hostPermission })
      return agents.every((agent, index) => agent === current.agents[index]) ? current : { ...current, agents }
    })
  }, [commitRoom, hostPermission, parentSessionId])

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
      permission: selection.group.id === AGENT_ROOM_CODEX_PROVIDER || selection.group.id === AGENT_ROOM_ANTIGRAVITY_PROVIDER ? 'read-only' : hostPermission,
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
      permission: current.provider === AGENT_ROOM_CODEX_PROVIDER || current.provider === AGENT_ROOM_ANTIGRAVITY_PROVIDER ? 'read-only' : hostPermission,
    })
    setAdding(false)
  }

  const handleRemove = (agentId: string): void => {
    if (room.running || !window.confirm('Remove this managed agent from the room? Its Host/Codex/Antigravity transcript will not be deleted.')) return
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
    const permission = agentPermissionChoices(agent.provider, hostPermission).find(choice => choice.value === agent.permission)
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
      updateAgent(agent.id, { effectivePermission: agent.permission })
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

  const runAntigravity = async (agent: AgentRoomAgent, prompt: string, runtimeCwd: string): Promise<string> => {
    if (parentSessionId === undefined || agent.effort === undefined) throw new Error('Antigravity model metadata is unavailable')
    const owner = agentRoomOwnerId(parentSessionId, agent.id)
    let completed: Extract<AntigravityEvent, { type: 'turn-completed' }> | undefined
    let failed: Error | undefined
    let wake: (() => void) | undefined
    const signal = new Promise<void>(resolve => { wake = resolve })
    const dispose = subscribeAntigravity(event => {
      if (event.sessionId !== owner) return
      if (event.type === 'turn-completed') {
        completed = event
        wake?.()
      } else if (event.type === 'error') {
        failed = new Error(event.message)
        wake?.()
      }
    })
    try {
      const permission = agent.permission as AntigravityPermissionMode
      updateAgent(agent.id, { effectivePermission: permission })
      const result = await antigravityApi.prompt({
        sessionId: owner,
        ...(agent.antigravityConversationId === undefined ? {} : { conversationId: agent.antigravityConversationId }),
        cwd: runtimeCwd,
        model: agent.model,
        effort: agent.effort,
        permission,
        network: resolvedNetwork(agent.network),
        prompt,
      })
      activeRuns.current.set(agent.id, { kind: 'antigravity', threadId: result.conversationId, turnId: result.turnId })
      updateAgent(agent.id, { antigravityConversationId: result.conversationId, runtimeCwd, isolated: runtimeCwd !== cwd })
      if (completed === undefined && failed === undefined) {
        await Promise.race([
          signal,
          sleep(10 * 60_000).then(() => { throw new Error('Antigravity agent timed out after 10 minutes') }),
        ])
      }
      if (failed !== undefined) throw failed
      if (completed?.status !== 'completed') throw new Error(completed?.error ?? `Antigravity agent ${completed?.status ?? 'stopped'}`)
      const snapshot = await antigravityApi.readThread(result.conversationId)
      const output = finalAssistantText(snapshot.messages)
      if (output === undefined) throw new Error('Antigravity agent completed without a final answer')
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
      const permissionPage = await harnessApi.history(sessionId)
      const effectivePermission = permissionPage.projections?.values.permissions?.currentValue ?? hostPermission
      updateAgent(agent.id, { permission: effectivePermission, effectivePermission })
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

  const stopActiveRuns = useCallback(async (): Promise<void> => {
    stopped.current = true
    const runs = [...activeRuns.current.values()]
    await Promise.allSettled(runs.map(run => {
      if (run.kind === 'host' && run.hostSessionId !== undefined) return harnessApi.cancel(run.hostSessionId)
      if (run.kind === 'codex' && run.threadId !== undefined && run.turnId !== undefined) return codexApi.interrupt(run.threadId, run.turnId)
      if (run.kind === 'antigravity' && run.threadId !== undefined && run.turnId !== undefined) return antigravityApi.interrupt(run.threadId, run.turnId)
      return Promise.resolve()
    }))
  }, [])

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
      const output = agent.provider === AGENT_ROOM_ANTIGRAVITY_PROVIDER
        ? await runAntigravity(agent, prompt, runtime.cwd)
        : agent.provider === AGENT_ROOM_CODEX_PROVIDER
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
      const independent = await Promise.all(participants.map(async agent => ({
        agent,
        output: await executeAgent(agent, independentAuditPrompt(room.task, agent, roomRef.current.context), 'independent'),
      })))
      if (stopped.current) throw new Error('Agent Room stopped')

      commitRoom(current => ({ ...current, phase: 'rebuttal' }))
      const rebuttals = await Promise.all(participants.map(async agent => ({
        agent,
        output: await executeAgent(agent, rebuttalPrompt(room.task, agent, independent
          .filter(item => item.agent.id !== agent.id)
          .map(item => ({ label: item.agent.label, output: item.output }))), 'rebuttal'),
      })))
      if (stopped.current) throw new Error('Agent Room stopped')

      commitRoom(current => ({ ...current, phase: 'judgment' }))
      const evidence = [
        ...independent.map(item => ({ agent: item.agent.label, phase: 'independent' as const, output: item.output })),
        ...rebuttals.map(item => ({ agent: item.agent.label, phase: 'rebuttal' as const, output: item.output })),
      ]
      const finalOutput = await executeAgent(judge, judgmentPrompt(room.task, evidence), 'judgment')
      const completed = commitRoom(current => ({ ...current, running: false, phase: 'completed', finalOutput, reportStatus: 'pending' }))
      await onDeliverReport(agentRoomReport(completed), parentSessionId)
      commitRoom(current => ({ ...current, reportStatus: 'delivered' }))
    } catch (reason) {
      const stoppedRun = stopped.current || errorText(reason) === 'Agent Room stopped'
      await stopActiveRuns()
      commitRoom(current => ({ ...current, running: false, phase: stoppedRun ? 'stopped' : 'failed' }))
      if (!stoppedRun) setError(errorText(reason))
    } finally {
      activeRuns.current.clear()
    }
  }

  const handleStop = async (): Promise<void> => {
    if (!room.running) return
    await stopActiveRuns()
    commitRoom(current => ({ ...current, running: false, phase: 'stopped' }))
  }

  const handleFollowup = async (questionInput: string): Promise<void> => {
    const question = questionInput.trim()
    if (question === '' || roomRef.current.running || roomRef.current.finalOutput === undefined) return
    const mention = question.match(/^@([^\s]+)\s+(.+)$/s)
    const mentionName = mention?.[1]?.toLocaleLowerCase()
    const requestedName = mentionName === 'room' ? undefined : mentionName
    const body = mention?.[2] ?? question
    const agents = requestedName === undefined
      ? roomRef.current.agents.filter(agent => agent.role !== 'judge')
      : roomRef.current.agents.filter(agent => agent.label.toLocaleLowerCase() === requestedName || agent.label.toLocaleLowerCase().startsWith(requestedName))
    if (agents.length === 0) {
      setError(tr('No matching agent. Use the exact agent name after @.', '没有匹配的 Agent，请在 @ 后使用准确名称。'))
      return
    }
    stopped.current = false
    setError(undefined)
    commitRoom(current => ({ ...current, running: true, phase: 'independent' }))
    try {
      const answers = await Promise.all(agents.map(async agent => ({
        agent,
        output: await executeAgent(agent, roomFollowupPrompt(currentTask(), body, agent, roomRef.current.finalOutput, roomRef.current.context), 'independent'),
      })))
      const judge = roomRef.current.agents.find(agent => agent.role === 'judge') ?? answers[0]!.agent
      const finalOutput = answers.length === 1
        ? answers[0]!.output
        : await executeAgent(judge, judgmentPrompt(`${currentTask()}\n\nFollow-up: ${body}`, answers.map(item => ({ agent: item.agent.label, phase: 'independent', output: item.output }))), 'judgment')
      const completed = commitRoom(current => ({ ...current, running: false, phase: 'completed', finalOutput, reportStatus: 'pending' }))
      if (parentSessionId === undefined) throw new Error('The parent session is unavailable')
      await onDeliverReport(agentRoomReport(completed), parentSessionId)
      commitRoom(current => ({ ...current, reportStatus: 'delivered' }))
      setFollowup('')
    } catch (reason) {
      const stoppedRun = stopped.current || errorText(reason) === 'Agent Room stopped'
      await stopActiveRuns()
      commitRoom(current => ({ ...current, running: false, phase: stoppedRun ? 'stopped' : 'failed' }))
      if (!stoppedRun) setError(errorText(reason))
    } finally {
      activeRuns.current.clear()
    }
  }

  const currentTask = (): string => roomRef.current.task

  useEffect(() => {
    if (request === undefined || parentSessionId === undefined) return
    if (request.kind === 'audit') {
      const context = buildAgentRoomContext(parentSessionId, parentMessages)
      commitRoom(current => ({
        ...current,
        task: request.text.trim() || parentTitle || 'Audit the current thread',
        context,
        agents: current.agents.length >= 2 ? current.agents : defaultAgentRoomAgents(groups, hostPermission),
        phase: 'idle',
        artifacts: [],
        finalOutput: undefined,
        reportStatus: undefined,
      }))
    } else {
      void handleFollowup(request.text)
    }
    onRequestHandled(request.id)
  // Request IDs are one-shot commands; room functions intentionally read their latest refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id])

  return (
    <div className="agent-room inspector-scroll" hidden={hidden} aria-label="Agent Room">
      <section className="agent-room-intro">
        <div>
          <span className="agent-room-kicker">DESKTOP ORCHESTRATION</span>
          <h3>Agent Room</h3>
          <p>{tr('Independent review, cross rebuttal, then a judge synthesis. Claude Code is not enabled.', '独立审查、交叉反驳，再由裁判综合结论。当前不接入 Claude Code。')}</p>
        </div>
        <button type="button" className="agent-room-add" onClick={() => setAdding(value => !value)} disabled={groups.length === 0 || room.agents.length >= 8 || room.running} aria-expanded={adding}>
          <Icon name={adding ? 'x' : 'plus'} size={13} /> {adding ? tr('Cancel', '取消') : tr('Add agent', '添加 Agent')}
        </button>
      </section>

      <div className="agent-source-strip" aria-label="Available connected model sources">
        {groups.length === 0 ? <span>{tr('No connected model source is available.', '没有可用的已连接模型来源。')}</span> : groups.map(group => (
          <span key={group.id}><ProviderLogo provider={group.id} name={group.name} size={13} />{group.name}<b>{group.models.length}</b></span>
        ))}
      </div>

      {adding && draft !== undefined && (
        <section className="agent-create-card">
          <label><span>{tr('Name', '名称')}</span><input value={draft.label} onChange={event => setDraft(current => current === undefined ? current : { ...current, label: event.target.value })} placeholder={tr('Optional agent name', '可选 Agent 名称')} maxLength={64} /></label>
          <label><span>{tr('Model source', '模型来源')}</span><select value={`${draft.provider}\u0000${draft.model}`} onChange={event => handleModelDraft(event.target.value)}>{groups.map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={`${group.id}\u0000${model.id}`}>{model.name}</option>)}</optgroup>)}</select></label>
          <div className="agent-create-grid">
            <label><span>Role</span><select value={draft.role} onChange={event => setDraft(current => current === undefined ? current : { ...current, role: event.target.value as AgentRoomRole })}>{AGENT_ROOM_ROLES.map(role => <option key={role.value} value={role.value}>{role.name}</option>)}</select></label>
            <label><span>Effort</span><select value={draft.effort ?? ''} disabled={(selectedModel?.reasoning?.efforts.length ?? 0) === 0} onChange={event => setDraft(current => current === undefined ? current : { ...current, effort: event.target.value || undefined })}><option value="">Default</option>{selectedModel?.reasoning?.efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}</select></label>
            <label><span>{tr('Permission', '权限')}</span><select value={draft.permission} onChange={event => setDraft(current => current === undefined ? current : { ...current, permission: event.target.value })}>{selectedPermissions.map(choice => <option key={choice.value} value={choice.value}>{choice.name}</option>)}</select></label>
            <label><span>Web</span><select value={draft.network} onChange={event => setDraft(current => current === undefined ? current : { ...current, network: event.target.value as NetworkMode })}><option value="off">Off</option><option value="auto">Auto</option><option value="ask">Ask each round</option></select></label>
          </div>
          <p>{selectedPermissions.find(choice => choice.value === draft.permission)?.description}</p>
          <button type="button" className="agent-create-confirm" onClick={handleAdd}>{tr('Add to room', '加入房间')}</button>
        </section>
      )}

      <section className="agent-room-section">
        <div className="review-heading"><strong>{tr('Managed agents', '受管 Agent')}</strong><span>{room.agents.length} {tr('configured', '个已配置')}</span></div>
        <div className="agent-roster">
          {room.agents.length === 0 ? <div className="review-empty compact"><Icon name="agent" size={18} /><strong>{tr('No managed agents', '尚无受管 Agent')}</strong><span>{tr('Add only from connected API or subscription sources.', '只显示已接入 API Key 或订阅的模型来源。')}</span></div> : room.agents.map(agent => {
            const status = [...room.artifacts].reverse().find(artifact => artifact.agentId === agent.id)
            return <article className="managed-agent-card" key={agent.id} data-running={status?.status === 'running'}>
              <div className="managed-agent-logo"><ProviderLogo provider={agent.provider} name={agent.model} size={17} /></div>
              <div><strong>{agent.label}</strong><span>{agent.role} · {agent.model}</span><small>{agent.effectivePermission === undefined ? tr('Next run', '下一轮') : tr('Effective', '实际')} {agent.effectivePermission ?? agent.permission} · web {agent.network}{agent.isolated ? ` · ${tr('isolated', '隔离')}` : ''}</small></div>
              <i data-status={status?.status ?? 'idle'} />
              <button type="button" onClick={() => handleRemove(agent.id)} disabled={room.running} aria-label={`Remove ${agent.label}`}><Icon name="x" size={12} /></button>
            </article>
          })}
        </div>
      </section>

      <section className="agent-room-section agent-task-card">
        <div className="review-heading"><strong>{tr('Adversarial audit', '多 Agent 对抗审计')}</strong><span>{phaseLabel(room.phase)}</span></div>
        <textarea value={room.task} onChange={event => commitRoom(current => ({ ...current, task: event.target.value }))} placeholder={tr('Describe the change, risk, or workspace area to audit…', '描述需要审计的变更、风险或工作区范围…')} disabled={room.running} />
        <div className="agent-pipeline" aria-label="Audit pipeline">
          {(['independent', 'rebuttal', 'judgment'] as const).map((phase, index) => <span key={phase} data-active={room.phase === phase} data-complete={room.phase === 'completed' || (phase === 'independent' && (room.phase === 'rebuttal' || room.phase === 'judgment')) || (phase === 'rebuttal' && room.phase === 'judgment')}><b>{index + 1}</b>{phase === 'independent' ? 'Review' : phase === 'rebuttal' ? 'Rebut' : 'Judge'}</span>)}
        </div>
        <div className="agent-room-actions">
          {room.running ? <button type="button" className="agent-stop-button" onClick={() => { void handleStop() }}><Icon name="stop" size={12} /> Stop room</button> : <button type="button" className="agent-run-button" onClick={() => { void handleRun() }} disabled={room.task.trim() === '' || room.agents.filter(agent => agent.role !== 'judge').length < 2}><Icon name="sparkles" size={13} /> Run adversarial audit</button>}
          <span>{tr('Codex and Antigravity expose their real sandbox modes. DeepSeek displays the Local Host permission actually in effect.', 'Codex 与 Antigravity 显示真实沙箱模式；DeepSeek 显示 Local Host 当前真正生效的权限。')}</span>
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
          <div className="review-heading"><strong>{tr('Judge verdict', '裁判结论')}</strong><span>{room.reportStatus === 'delivered' ? tr('Returned to main', '已回注主线程') : tr('Returning…', '正在回注…')}</span></div>
          <div className="agent-final-copy"><Markdown>{room.finalOutput}</Markdown></div>
          <div className="agent-room-followup">
            <textarea value={followup} onChange={event => setFollowup(event.target.value)} placeholder={tr('Ask the whole room, or start with @AgentName…', '追问整个 Room，或以 @Agent名称 开头…')} disabled={room.running} />
            <button type="button" onClick={() => { void handleFollowup(followup) }} disabled={room.running || followup.trim() === ''}>{tr('Ask room', '追问 Room')}</button>
          </div>
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
