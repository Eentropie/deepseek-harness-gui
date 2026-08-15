import { useEffect, useRef, useState } from 'react'
import type { ConversationMessage, MessageBlock, PermissionOption, SessionModels, SidechatThreadSummary } from '../lib/types.ts'
import { Markdown } from './Markdown.tsx'
import { Icon } from './Icon.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'

interface SidechatPanelProps {
  owner?: string
  parentTitle?: string
  threads: SidechatThreadSummary[]
  activeThreadId?: string
  provider: string
  models?: SessionModels
  permissionOptions: PermissionOption[]
  permission?: string
  messages: ConversationMessage[]
  running: boolean
  error?: string
  onSend: (text: string) => void
  onStop: () => void
  onNewThread: () => void
  onThread: (threadId: string) => void
  onModel: (provider: string, model: string) => void
  onEffort: (effort: string) => void
  onPermission: (permission: string) => void
}

function draftKey(owner?: string): string {
  return `dsh-workbench-sidechat-draft:${owner ?? 'none'}`
}

function SidechatBlock({ block }: { block: MessageBlock }) {
  if (block.kind === 'text') return <Markdown>{block.text}</Markdown>
  if (block.kind === 'reasoning') return <details className="sidechat-thought"><summary>Thought process</summary><Markdown>{block.text}</Markdown></details>
  if (block.kind === 'thought') return <details className="sidechat-thought"><summary>Thought process</summary><div>{block.blocks.map((nested, index) => <SidechatBlock block={nested} key={index} />)}</div></details>
  if (block.kind === 'tool') return <div className="sidechat-tool"><Icon name="terminal" size={12} /><span>{block.name}</span>{block.arguments !== '' && <code>{block.arguments}</code>}</div>
  if (block.kind === 'image') return <div className="sidechat-tool"><span>{block.label}</span></div>
  return null
}

export function SidechatPanel({ owner, parentTitle, threads, activeThreadId, provider, models, permissionOptions, permission, messages, running, error, onSend, onStop, onNewThread, onThread, onModel, onEffort, onPermission }: SidechatPanelProps) {
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

  return (
    <div className="sidechat-panel">
      <div className="sidechat-thread-bar">
        <div role="tablist" aria-label="Sidechat threads">{threads.map(thread => <button type="button" role="tab" aria-selected={thread.id === activeThreadId} data-active={thread.id === activeThreadId} title={thread.title} key={thread.id} onClick={() => onThread(thread.id)}>{thread.title}</button>)}</div>
        <button type="button" className="icon-button quiet" onClick={onNewThread} disabled={owner === undefined} title="New sidechat" aria-label="New sidechat"><Icon name="plus" size={13} /></button>
      </div>
      <div className="sidechat-status"><span><i data-running={running} />{provider}</span><small>{parentTitle === undefined ? 'Open a main chat to begin' : `Following ${parentTitle}`}</small></div>
      <div className="sidechat-controls">
        <label title="Sidechat model"><ProviderLogo provider={models?.current.provider} name={currentModel?.name} size={13} /><select value={models === undefined ? '' : `${models.current.provider}\u0000${models.current.model}`} disabled={models === undefined || owner === undefined} onChange={event => {
          const [nextProvider, nextModel] = event.target.value.split('\u0000')
          if (nextProvider !== undefined && nextModel !== undefined) onModel(nextProvider, nextModel)
        }}>
          {models?.groups.map(group => <optgroup label={group.name} key={group.id}>{group.models.map(model => <option value={`${group.id}\u0000${model.id}`} key={`${group.id}:${model.id}`}>{model.name}</option>)}</optgroup>)}
        </select></label>
        {efforts.length > 0 && <label title="Reasoning effort"><Icon name="sparkles" size={12} /><select value={models?.current.reasoningEffort ?? currentModel?.reasoning?.defaultEffort ?? ''} onChange={event => onEffort(event.target.value)}>{efforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}</select></label>}
        {permissionOptions.length > 0 && <label title="Permission"><Icon name="lock" size={12} /><select value={permission ?? ''} onChange={event => onPermission(event.target.value)}>{permissionOptions.map(option => <option value={option.value} key={option.value}>{option.name}</option>)}</select></label>}
      </div>
      <div className="sidechat-messages" ref={scroll}>
        {messages.length === 0 && (
          <div className="sidechat-empty"><Icon name="sparkles" size={18} /><strong>Ask alongside the main task</strong><span>Use this thread for a quick explanation, alternative, or second opinion.</span></div>
        )}
        {messages.map(message => (
          <article className="sidechat-message" data-role={message.role} key={message.id}>
            <header>{message.role === 'assistant' && <ProviderLogo provider={message.agent ?? provider} size={12} />}{message.role === 'user' ? 'You' : message.agent ?? provider}</header>
            {message.blocks.map((block, index) => <SidechatBlock block={block} key={`${message.id}-${index}`} />)}
          </article>
        ))}
        {running && <div className="sidechat-thinking"><i /><i /><i /><span>Working in sidechat…</span></div>}
      </div>
      {error !== undefined && <div className="sidechat-error">{error}</div>}
      <div className="sidechat-composer">
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
      </div>
    </div>
  )
}
