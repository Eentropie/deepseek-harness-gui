import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'
import { Markdown } from './Markdown.tsx'
import { WhaleLogo } from './WhaleLogo.tsx'
import { conversationMessagesEqual } from '../lib/history.ts'
import type { ConversationMessage, MessageBlock, ProcessBlock } from '../lib/types.ts'

interface ConversationProps {
  messages: ConversationMessage[]
  loading: boolean
  running: boolean
  scrollToBottomRequest: number
  title?: string
  workspace?: string
  hasMore: boolean
  loadingOlder: boolean
  greeting: string
  onLoadOlder: () => void
  onUseSuggestion: (prompt: string) => void
}

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function timeLabel(timestamp: number): string {
  return TIME_FORMATTER.format(timestamp)
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
    if (block.kind === 'thought') return [blockText(block.blocks)]
    return []
  }).join('\n\n')
}

function latestUserMessageId(messages: ConversationMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') return message.id
  }
  return undefined
}

function ThoughtGlyph({ active }: { active: boolean }) {
  return (
    <span className="thought-glyph" data-active={active} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path className="thought-wave thought-wave-upper" d="M2.5 12c2.8-7 6.6-7 9.5 0s6.7 7 9.5 0" />
        <path className="thought-wave thought-wave-lower" d="M2.5 12c2.8 7 6.6 7 9.5 0s6.7-7 9.5 0" />
        <circle className="thought-core" cx="12" cy="12" r="2" />
      </svg>
    </span>
  )
}

function ThoughtSummary({ active }: { active: boolean }) {
  return (
    <summary>
      <ThoughtGlyph active={active} />
      <span className="thought-title">{active ? 'Thinking' : 'Thought process'}</span>
      {active && <span className="thought-live">LIVE</span>}
    </summary>
  )
}

function AgentStarting() {
  return (
    <div className="agent-starting" role="status" aria-live="polite">
      <ThoughtGlyph active />
      <div className="agent-starting-copy">
        <strong>Starting agent</strong>
        <span>Preparing workspace context</span>
      </div>
      <span className="agent-starting-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  )
}

function ThoughtDetails({ active, children }: { active: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(active)
  const wasActive = useRef(active)

  useLayoutEffect(() => {
    if (active) setOpen(true)
    else if (wasActive.current) setOpen(false)
    wasActive.current = active
  }, [active])

  return (
    <details
      className="reasoning-block"
      data-active={active}
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <ThoughtSummary active={active} />
      {children}
    </details>
  )
}

function ProcessContent({ block, active }: { block: ProcessBlock; active: boolean }) {
  if (block.kind === 'text' || block.kind === 'reasoning') return <Markdown>{block.text}</Markdown>
  return <RenderBlock block={block} active={active} />
}

function RenderBlock({ block, active = false }: { block: MessageBlock; active?: boolean }) {
  switch (block.kind) {
    case 'text':
      return <Markdown>{block.text}</Markdown>
    case 'reasoning':
      return (
        <ThoughtDetails active={active}>
          <div className="reasoning-body"><Markdown>{block.text}</Markdown></div>
        </ThoughtDetails>
      )
    case 'thought':
      return (
        <ThoughtDetails active={active}>
          <div className="reasoning-body">
            {block.blocks.map((item, index) => <ProcessContent block={item} active={active} key={`thought-${index}`} />)}
          </div>
        </ThoughtDetails>
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

const Message = memo(function Message({ message, turnRunning }: { message: ConversationMessage; turnRunning: boolean }) {
  const text = blockText(message.blocks)
  const thoughtActive = turnRunning || message.streaming === true
  return (
    <article className="message" data-role={message.role} data-streaming={thoughtActive}>
      {message.role === 'assistant' && (
        <div className="assistant-avatar"><WhaleLogo size={19} /></div>
      )}
      <div className="message-column">
        <div className="message-meta">
          <span>{message.role === 'assistant' ? message.agent ?? 'DeepSeek' : 'You'}</span>
          <time>{timeLabel(message.time)}</time>
          {thoughtActive && <span className="streaming-label"><i /> Working</span>}
        </div>
        <div className="message-surface">
          {message.transient === 'agent-starting'
            ? <AgentStarting />
            : message.blocks.map((block, index) => <RenderBlock block={block} active={thoughtActive} key={`${message.id}-${index}`} />)}
        </div>
        {text !== '' && (
          <div className="message-actions"><CopyButton text={text} /></div>
        )}
      </div>
    </article>
  )
}, (previous, next) => previous.turnRunning === next.turnRunning && conversationMessagesEqual(previous.message, next.message))

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

export function Conversation({ messages, loading, running, scrollToBottomRequest, workspace, hasMore, loadingOlder, greeting, onLoadOlder, onUseSuggestion }: ConversationProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const handledScrollRequest = useRef(scrollToBottomRequest)
  const scrollFrame = useRef<number>()
  const followBottomUntil = useRef(0)
  const forceFollowActive = useRef(false)
  const lastId = messages.at(-1)?.id
  const lastStreaming = messages.at(-1)?.streaming === true
  const lastBlockSize = messages.at(-1)?.blocks.reduce((size, block) => {
    if (block.kind === 'text' || block.kind === 'reasoning') return size + block.text.length
    if (block.kind === 'thought') return size + blockText(block.blocks).length
    return size
  }, 0) ?? 0
  const tail = messages.at(-1)
  const latestUserId = latestUserMessageId(messages)
  const handledUserId = useRef(latestUserId)
  const activeAssistantId = running && tail?.role === 'assistant' ? tail.id : undefined

  const cancelBottomFollow = (): void => {
    followBottomUntil.current = 0
    forceFollowActive.current = false
    if (scrollFrame.current === undefined) return
    window.cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = undefined
  }

  const followBottom = (duration: number, force = false): void => {
    const scroll = scrollRef.current
    if (scroll === null) return
    const reduceMotion = document.documentElement.dataset['reduceMotion'] === 'true'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      cancelBottomFollow()
      scroll.scrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
      return
    }

    const startedAt = performance.now()
    if (force) forceFollowActive.current = true
    followBottomUntil.current = Math.max(followBottomUntil.current, startedAt + duration)
    if (scrollFrame.current !== undefined) return
    let previousTime = startedAt
    const tick = (time: number): void => {
      const current = scrollRef.current
      if (current === null) {
        scrollFrame.current = undefined
        return
      }
      const target = Math.max(0, current.scrollHeight - current.clientHeight)
      const remaining = target - current.scrollTop
      if (Math.abs(remaining) <= 0.75) {
        current.scrollTop = target
      } else {
        const elapsed = Math.min(32, Math.max(8, time - previousTime))
        const blend = 1 - Math.exp(-elapsed / 72)
        const step = Math.min(Math.abs(remaining), Math.max(1, Math.min(300, Math.abs(remaining) * blend)))
        current.scrollTop += Math.sign(remaining) * step
      }
      previousTime = time
      const unsettled = Math.abs(target - current.scrollTop) > 0.75
      if (unsettled || time < followBottomUntil.current) {
        scrollFrame.current = window.requestAnimationFrame(tick)
      } else {
        current.scrollTop = target
        scrollFrame.current = undefined
        forceFollowActive.current = false
      }
    }
    scrollFrame.current = window.requestAnimationFrame(tick)
  }

  useEffect(() => {
    const scroll = scrollRef.current
    if (scroll === null) return
    const cancelForWheel = (event: WheelEvent): void => {
      if (forceFollowActive.current) {
        event.preventDefault()
        return
      }
      cancelBottomFollow()
    }
    const cancelForUser = (): void => cancelBottomFollow()
    scroll.addEventListener('wheel', cancelForWheel, { passive: false })
    scroll.addEventListener('pointerdown', cancelForUser, { passive: true })
    scroll.addEventListener('touchstart', cancelForUser, { passive: true })
    return () => {
      scroll.removeEventListener('wheel', cancelForWheel)
      scroll.removeEventListener('pointerdown', cancelForUser)
      scroll.removeEventListener('touchstart', cancelForUser)
      cancelBottomFollow()
    }
  }, [])

  useLayoutEffect(() => {
    const requestChanged = handledScrollRequest.current !== scrollToBottomRequest
    const userChanged = handledUserId.current !== latestUserId
    handledScrollRequest.current = scrollToBottomRequest
    handledUserId.current = latestUserId
    if (requestChanged || userChanged) followBottom(520, true)
  }, [latestUserId, scrollToBottomRequest])

  useEffect(() => {
    const scroll = scrollRef.current
    if (scroll === null) return
    const distance = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
    if (distance >= 220) return
    followBottom(lastStreaming ? 140 : 220)
  }, [lastBlockSize, lastId])

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
          {messages.map(message => (
            <Message message={message} turnRunning={message.id === activeAssistantId} key={message.id} />
          ))}
        </div>
      )}
    </div>
  )
}
