import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { WhaleLogo } from './WhaleLogo.tsx'
import type { ConversationMessage, MessageBlock } from '../lib/types.ts'

interface ConversationProps {
  messages: ConversationMessage[]
  loading: boolean
  title?: string
  workspace?: string
  hasMore: boolean
  loadingOlder: boolean
  greeting: string
  onLoadOlder: () => void
  onUseSuggestion: (prompt: string) => void
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_400)
  }
  return (
    <button type="button" className="message-action" onClick={() => void copy()} aria-label="Copy message">
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  )
}

function blockText(blocks: MessageBlock[]): string {
  return blocks.flatMap(block => {
    if (block.kind === 'text' || block.kind === 'reasoning') return [block.text]
    if (block.kind === 'tool') return [`${block.name}\n${block.arguments}`]
    return []
  }).join('\n\n')
}

function RenderBlock({ block }: { block: MessageBlock }) {
  switch (block.kind) {
    case 'text':
      return <Markdown>{block.text}</Markdown>
    case 'reasoning':
      return (
        <details className="reasoning-block">
          <summary><Icon name="brain" size={14} /> Thought process</summary>
          <div className="reasoning-body"><Markdown>{block.text}</Markdown></div>
        </details>
      )
    case 'tool':
      return (
        <div className="tool-block">
          <div className="tool-heading">
            <Icon name="terminal" size={14} />
            <span>{block.name || 'Tool call'}</span>
            {block.callId !== undefined && <code>{block.callId.slice(0, 8)}</code>}
          </div>
          {block.arguments !== '' && <pre>{block.arguments}</pre>}
        </div>
      )
    case 'image':
      return block.src === undefined
        ? <div className="image-placeholder">{block.label}</div>
        : <figure className="image-block"><img src={block.src} alt={block.name ?? block.label} /><figcaption>{block.name ?? block.label}</figcaption></figure>
    case 'other':
      return <pre className="unknown-block">{JSON.stringify(block.value, null, 2)}</pre>
  }
}

function Message({ message }: { message: ConversationMessage }) {
  const text = blockText(message.blocks)
  return (
    <article className="message" data-role={message.role} data-streaming={message.streaming === true}>
      {message.role === 'assistant' && (
        <div className="assistant-avatar"><WhaleLogo size={19} /></div>
      )}
      <div className="message-column">
        <div className="message-meta">
          <span>{message.role === 'assistant' ? message.agent ?? 'DeepSeek' : 'You'}</span>
          <time>{timeLabel(message.time)}</time>
          {message.streaming && <span className="streaming-label"><i /> Working</span>}
        </div>
        <div className="message-surface">
          {message.blocks.map((block, index) => <RenderBlock block={block} key={`${message.id}-${index}`} />)}
        </div>
        {text !== '' && (
          <div className="message-actions"><CopyButton text={text} /></div>
        )}
      </div>
    </article>
  )
}

const suggestions = [
  { icon: 'sparkles' as const, title: 'Explore this workspace', prompt: '请先阅读当前工作区，概括项目结构、关键入口和运行方式。' },
  { icon: 'terminal' as const, title: 'Fix a failing command', prompt: '请检查当前项目的构建与测试，定位第一个失败并解释原因。' },
  { icon: 'brain' as const, title: 'Plan a change', prompt: '请先分析当前代码库，并为下一项最值得做的改进给出可执行计划。' },
]

function EmptyConversation({ workspace, greeting, onUseSuggestion }: Pick<ConversationProps, 'workspace' | 'greeting' | 'onUseSuggestion'>) {
  return (
    <div className="empty-conversation">
      <div className="empty-hero">
        <div className="hero-whale"><WhaleLogo size={62} /></div>
        <p className="eyebrow">DEEPSEEK HARNESS</p>
        <h1>{greeting}</h1>
        <p className="hero-subtitle">
          {workspace === undefined ? 'Connected to your local Harness.' : `Working in ${workspace}.`}
        </p>
      </div>
      <div className="suggestion-grid">
        {suggestions.map(suggestion => (
          <button type="button" key={suggestion.title} onClick={() => onUseSuggestion(suggestion.prompt)}>
            <Icon name={suggestion.icon} size={16} />
            <span>{suggestion.title}</span>
            <Icon name="chevron-right" size={14} />
          </button>
        ))}
      </div>
    </div>
  )
}

export function Conversation({ messages, loading, workspace, hasMore, loadingOlder, greeting, onLoadOlder, onUseSuggestion }: ConversationProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastId = messages.at(-1)?.id
  const lastBlockSize = messages.at(-1)?.blocks.reduce((size, block) =>
    size + (block.kind === 'text' || block.kind === 'reasoning' ? block.text.length : 0), 0) ?? 0

  useEffect(() => {
    const scroll = scrollRef.current
    if (scroll === null) return
    const distance = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
    if (distance < 220) scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' })
  }, [lastId, lastBlockSize])

  return (
    <div className="conversation-scroll" ref={scrollRef}>
      {loading && messages.length === 0 ? (
        <div className="conversation-loading" aria-label="Loading conversation">
          <span /><span /><span />
        </div>
      ) : messages.length === 0 ? (
        <EmptyConversation workspace={workspace} greeting={greeting} onUseSuggestion={onUseSuggestion} />
      ) : (
        <div className="conversation-thread">
          {hasMore && (
            <button type="button" className="older-history-button" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Loading older history…' : 'Load older history'}
            </button>
          )}
          {messages.map(message => <Message message={message} key={message.id} />)}
        </div>
      )}
    </div>
  )
}
