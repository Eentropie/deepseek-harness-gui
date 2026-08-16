import { useEffect, useRef, useState } from 'react'
import type { ConversationMessage, MessageBlock, NetworkMode, PermissionOption, SessionModels, SidechatThreadSummary } from '../lib/types.ts'
import { Markdown } from './Markdown.tsx'
import { Icon } from './Icon.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'
import { ToolCard } from './ToolCard.tsx'

interface SidechatPanelProps {
  owner?: string
  parentTitle?: string
  threads: SidechatThreadSummary[]
  activeThreadId?: string
  provider: string
  models?: SessionModels
  permissionOptions: PermissionOption[]
  permission?: string
  network: NetworkMode
  messages: ConversationMessage[]
  running: boolean
  error?: string
  onSend: (text: string) => void
  onStop: () => void
  onNewThread: () => void
  onThread: (threadId: string) => void
  onCloseThread: (threadId: string) => void
  onModel: (provider: string, model: string) => void
  onEffort: (effort: string) => void
  onPermission: (permission: string) => void
  onNetwork: (network: NetworkMode) => void
}

function draftKey(owner?: string): string {
  return `dsh-workbench-sidechat-draft:${owner ?? 'none'}`
}

function SidechatBlock({ block, running }: { block: MessageBlock; running: boolean }) {
  if (block.kind === 'text') return <Markdown>{block.text}</Markdown>
  if (block.kind === 'reasoning') return <details className="sidechat-thought" open={running}><summary>{running ? 'Thinking' : 'Thought process'}</summary><Markdown>{block.text}</Markdown></details>
  if (block.kind === 'thought') return <details className="sidechat-thought" open={running}><summary>{running ? 'Thinking' : 'Thought process'}</summary><div>{block.blocks.map((nested, index) => <SidechatBlock block={nested} running={running} key={index} />)}</div></details>
  if (block.kind === 'tool') return <ToolCard block={block} compact />
  if (block.kind === 'image') return <div className="sidechat-tool"><span>{block.label}</span></div>
  return null
}

export function SidechatPanel({ owner, parentTitle, threads, activeThreadId, provider, models, permissionOptions, permission, network, messages, running, error, onSend, onStop, onNewThread, onThread, onCloseThread, onModel, onEffort, onPermission, onNetwork }: SidechatPanelProps) {
  const [draft, setDraft] = useState(() => localStorage.getItem(draftKey(owner)) ?? '')
  const scroll = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(localStorage.getItem(draftKey(owner)) ?? '')
  }, [owner])

  useEffect(() => {
    localStorage.setItem(draftKey(owner), draft)
  }, [draft, owner])

  useEffect(() => {
    const element = scroll.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [messages, running])

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || running || owner === undefined) return
    setDraft('')
    onSend(text)
  }
  const currentModel = models?.groups.find(group => group.id === models.current.provider)?.models.find(model => model.id === models.current.model)
  const efforts = currentModel?.reasoning?.efforts ?? []
  const activeAssistantId = running ? [...messages].reverse().find(message => message.role === 'assistant')?.id : undefined

  return (
    <div className="sidechat-panel">
      <div className="sidechat-thread-bar">
        <div role="tablist" aria-label="Sidechat threads">{threads.map(thread => <div className="sidechat-thread-tab" data-active={thread.id === activeThreadId} key={thread.id}>
          <button type="button" className="sidechat-thread-select" role="tab" aria-selected={thread.id === activeThreadId} title={thread.title} onClick={() => onThread(thread.id)}>{thread.title}</button>
          <button type="button" className="sidechat-thread-close" title={`Close ${thread.title}`} aria-label={`Close ${thread.title}`} onClick={() => onCloseThread(thread.id)}><Icon name="x" size={10} /></button>
        </div>)}</div>
        <button type="button" className="icon-button quiet" onClick={onNewThread} disabled={parentTitle === undefined} title="New sidechat" aria-label="New sidechat"><Icon name="plus" size={13} /></button>
      </div>
      {owner !== undefined && <><div className="sidechat-status"><span><i data-running={running} />{provider}</span><small>{`Following ${parentTitle ?? 'main task'}`}</small></div>
      <div className="sidechat-controls">
        <label title="Sidechat model"><ProviderLogo provider={models?.current.provider} name={currentModel?.name} size={13} /><select value={models === undefined ? '' : `${models.current.provider}\u0000${models.current.model}`} disabled={models === undefined || owner === undefined} onChange={event => {
          const [nextProvider, nextModel] = event.target.value.split('\u0000')
          if (nextProvider !== undefined && nextModel !== undefined) onModel(nextProvider, nextModel)
        }}>
          {models?.groups.map(group => <optgroup label={group.name} key={group.id}>{group.models.map(model => <option value={`${group.id}\u0000${model.id}`} key={`${group.id}:${model.id}`}>{model.name}</option>)}</optgroup>)}
        </select></label>
        {efforts.length > 0 && <label title="Reasoning effort"><Icon name="sparkles" size={12} /><select value={models?.current.reasoningEffort ?? currentModel?.reasoning?.defaultEffort ?? ''} onChange={event => onEffort(event.target.value)}>{efforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}</select></label>}
        {permissionOptions.length > 0 && <label title="Permission"><Icon name="lock" size={12} /><select value={permission ?? ''} onChange={event => onPermission(event.target.value)}>{permissionOptions.map(option => <option value={option.value} key={option.value}>{option.name}</option>)}</select></label>}
        <label title={`${models?.current.provider === 'antigravity-cli' ? 'Antigravity' : models?.current.provider === 'codex-cli' ? 'Codex' : 'Host'} web access`}><Icon name="globe" size={12} /><select value={network} onChange={event => onNetwork(event.target.value as NetworkMode)}><option value="off">Web off</option><option value="auto">Web auto · {models?.current.provider === 'antigravity-cli' ? 'Antigravity' : models?.current.provider === 'codex-cli' ? 'Codex' : 'Host'}</option><option value="ask">Ask before web</option></select></label>
      </div></>}
      <div className="sidechat-messages" ref={scroll}>
        {owner === undefined ? (
          <div className="sidechat-empty sidechat-empty-closed"><Icon name="sparkles" size={18} /><strong>{parentTitle === undefined ? 'Open a main chat to begin' : 'No sidechats open'}</strong><span>{parentTitle === undefined ? 'Select a main task before starting a side thread.' : 'Create a sidechat when you want a separate explanation, alternative, or second opinion.'}</span>{parentTitle !== undefined && <button type="button" onClick={onNewThread}><Icon name="plus" size={12} /> New sidechat</button>}</div>
        ) : messages.length === 0 && (
          <div className="sidechat-empty"><Icon name="sparkles" size={18} /><strong>Ask alongside the main task</strong><span>Use this thread for a quick explanation, alternative, or second opinion.</span></div>
        )}
        {messages.map(message => (
          <article className="sidechat-message" data-role={message.role} key={message.id}>
            <header>{message.role === 'assistant' && <ProviderLogo provider={message.agent ?? provider} name={message.modelName} size={12} />}{message.role === 'user' ? 'You' : message.agent ?? provider}</header>
            {message.blocks.map((block, index) => <SidechatBlock block={block} running={message.streaming === true || message.id === activeAssistantId} key={`${message.id}-${index}`} />)}
          </article>
        ))}
        {running && <div className="sidechat-thinking"><i /><i /><i /><span>Working in sidechat…</span></div>}
      </div>
      {owner !== undefined && error !== undefined && <div className="sidechat-error">{error}</div>}
      {owner !== undefined && <div className="sidechat-composer">
        <textarea
          ref={textarea}
          value={draft}
          rows={3}
          disabled={owner === undefined}
          placeholder={owner === undefined ? 'Open a session to use sidechat' : 'Ask in a separate thread…'}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            send()
          }}
        />
        <div><span>Enter to send · Shift+Enter for newline</span>{running
          ? <button type="button" onClick={onStop}><Icon name="stop" size={11} /> Stop</button>
          : <button type="button" className="primary" disabled={draft.trim() === '' || owner === undefined} onClick={send}>Send</button>}
        </div>
      </div>}
    </div>
  )
}
