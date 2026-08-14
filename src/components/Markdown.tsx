import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownProps {
  children: string
}

export function Markdown({ children }: MarkdownProps) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noreferrer">{label}</a>
          ),
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
}
