import { isValidElement, memo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from './Icon.tsx'

interface MarkdownProps {
  children: string
}

function nodeText(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(value)) return nodeText(value.props.children)
  return ''
}

function codeLanguage(value: ReactNode): string | undefined {
  if (!isValidElement<{ className?: string }>(value)) return undefined
  const match = value.props.className?.match(/(?:^|\s)language-([^\s]+)/)
  return match?.[1]
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const text = nodeText(children).replace(/\n$/, '')
  const language = codeLanguage(children)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1_500)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 1_500)
    }
  }
  return (
    <div className="markdown-code-block" data-copy-state={copyState}>
      {language !== undefined && <span className="markdown-code-language">{language}</span>}
      <button
        type="button"
        className="markdown-code-copy"
        onClick={() => { void copy() }}
        aria-label={copyState === 'copied' ? 'Code copied' : copyState === 'failed' ? 'Copy failed' : 'Copy code'}
        title={copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy code'}
      >
        <Icon name={copyState === 'copied' ? 'check' : 'copy'} size={13} />
        <span>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}</span>
      </button>
      <pre>{children}</pre>
    </div>
  )
}

export const Markdown = memo(function Markdown({ children }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noreferrer">{label}</a>
          ),
          pre: ({ children: value }) => <CodeBlock>{value}</CodeBlock>,
          code: ({ className, children: value }) => {
            const multiline = className !== undefined || String(value).includes('\n')
            return multiline
              ? <code className={className}>{value}</code>
              : <code className="inline-code">{value}</code>
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
