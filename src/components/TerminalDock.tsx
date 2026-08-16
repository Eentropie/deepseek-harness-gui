import { useEffect, useRef, useState } from 'react'
import { terminalApi, subscribeTerminal } from '../lib/api.ts'
import { platformBasename } from '../lib/platform.ts'
import type { TerminalEvent } from '../lib/types.ts'
import { Icon } from './Icon.tsx'

interface TerminalDockProps {
  sessionId?: string
  cwd?: string
  onClose: () => void
}

interface TerminalChunk {
  id: string
  tone: 'command' | 'stdout' | 'stderr' | 'system'
  text: string
}

const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

function cleanOutput(value: string): string {
  return value.replace(ANSI_PATTERN, '').replace(/\r(?!\n)/g, '\n')
}

function appendChunk(current: TerminalChunk[], chunk: TerminalChunk): TerminalChunk[] {
  const next = [...current]
  const tail = next.at(-1)
  if (tail?.tone === chunk.tone && chunk.tone !== 'command') {
    next[next.length - 1] = { ...tail, text: `${tail.text}${chunk.text}`.slice(-120_000) }
  } else {
    next.push(chunk)
  }
  return next.slice(-240)
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function TerminalDock({ sessionId, cwd, onClose }: TerminalDockProps) {
  const [currentCwd, setCurrentCwd] = useState(cwd)
  const [command, setCommand] = useState('')
  const [chunks, setChunks] = useState<TerminalChunk[]>([])
  const [runningId, setRunningId] = useState<string>()
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const activeId = useRef<string>()
  const output = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (runningId === undefined) setCurrentCwd(cwd)
  }, [cwd, runningId])

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => subscribeTerminal((event: TerminalEvent) => {
    if (event.id !== activeId.current) return
    if (event.type === 'data') {
      const text = cleanOutput(event.data)
      if (text !== '') setChunks(current => appendChunk(current, { id: `${event.id}-${Date.now()}`, tone: event.stream, text }))
      return
    }
    if (event.type === 'error') {
      setChunks(current => appendChunk(current, { id: `${event.id}-error`, tone: 'stderr', text: `${event.message}\n` }))
      return
    }
    setChunks(current => appendChunk(current, {
      id: `${event.id}-exit`,
      tone: 'system',
      text: event.signal === null ? `Process exited with code ${event.code ?? 0}.` : `Process stopped (${event.signal}).`,
    }))
    activeId.current = undefined
    setRunningId(undefined)
  }), [])

  useEffect(() => () => {
    const id = activeId.current
    if (id !== undefined) void terminalApi.stop(id).catch(() => undefined)
  }, [])

  useEffect(() => {
    const element = output.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [chunks])

  const run = async (): Promise<void> => {
    const value = command.trim()
    if (value === '' || runningId !== undefined || currentCwd === undefined || sessionId === undefined) return
    setCommand('')
    setHistory(current => [value, ...current.filter(item => item !== value)].slice(0, 80))
    setHistoryIndex(-1)
    setChunks(current => appendChunk(current, {
      id: `command-${Date.now()}`,
      tone: 'command',
      text: `${platformBasename(currentCwd) ?? currentCwd} $ ${value}`,
    }))
    const cd = value.match(/^cd(?:\s+([\s\S]*))?$/)
    if (cd !== null) {
      try {
        const next = await terminalApi.changeDirectory(sessionId, currentCwd, cd[1] ?? '')
        setCurrentCwd(next)
        setChunks(current => appendChunk(current, { id: `cwd-${Date.now()}`, tone: 'system', text: next }))
      } catch (reason) {
        setChunks(current => appendChunk(current, { id: `cwd-error-${Date.now()}`, tone: 'stderr', text: errorText(reason) }))
      }
      return
    }
    if (value === 'clear' || value === 'cls') {
      setChunks([])
      return
    }
    const id = crypto.randomUUID()
    activeId.current = id
    setRunningId(id)
    try {
      await terminalApi.run({ id, sessionId, cwd: currentCwd, command: value })
    } catch (reason) {
      activeId.current = undefined
      setRunningId(undefined)
      setChunks(current => appendChunk(current, { id: `${id}-launch-error`, tone: 'stderr', text: errorText(reason) }))
    }
  }

  const stop = (): void => {
    if (runningId !== undefined) {
      void terminalApi.stop(runningId).catch(reason => {
        setChunks(current => appendChunk(current, { id: `${runningId}-stop-error`, tone: 'stderr', text: errorText(reason) }))
      })
    }
  }

  return (
    <section className="terminal-dock" aria-label="Workspace terminal">
      <header className="terminal-header">
        <div><Icon name="terminal" size={13} /><strong>Terminal</strong><span title={currentCwd}>{currentCwd ?? 'No work folder'}</span></div>
        <div>
          <button type="button" onClick={() => setChunks([])} title="Clear terminal">Clear</button>
          {runningId !== undefined && <button type="button" className="terminal-stop" onClick={stop}>Stop</button>}
          <button type="button" className="icon-button quiet" onClick={onClose} aria-label="Close terminal"><Icon name="x" size={13} /></button>
        </div>
      </header>
      <div className="terminal-output" ref={output} onClick={() => input.current?.focus()}>
        {chunks.length === 0 && <p className="terminal-empty">Run a command in this workspace. `cd` and `clear` are handled locally.</p>}
        {chunks.map(chunk => <pre data-tone={chunk.tone} key={chunk.id}>{chunk.text}</pre>)}
      </div>
      <form className="terminal-input" onSubmit={event => { event.preventDefault(); void run() }}>
        <span>{platformBasename(currentCwd) ?? 'workspace'} $</span>
        <input
          ref={input}
          value={command}
          disabled={currentCwd === undefined || sessionId === undefined}
          aria-label="Terminal command"
          autoComplete="off"
          spellCheck={false}
          onChange={event => setCommand(event.target.value)}
          onKeyDown={event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && runningId !== undefined) {
              event.preventDefault()
              stop()
              return
            }
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            const nextIndex = event.key === 'ArrowUp'
              ? Math.min(history.length - 1, historyIndex + 1)
              : Math.max(-1, historyIndex - 1)
            setHistoryIndex(nextIndex)
            setCommand(nextIndex < 0 ? '' : history[nextIndex] ?? '')
          }}
        />
        <button type="submit" disabled={command.trim() === '' || runningId !== undefined || currentCwd === undefined || sessionId === undefined}>Run</button>
      </form>
    </section>
  )
}
