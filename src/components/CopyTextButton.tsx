import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n.tsx'
import { Icon } from './Icon.tsx'

interface CopyTextButtonProps {
  text: string
  className?: string
}

export function CopyTextButton({ text, className }: CopyTextButtonProps) {
  const { tr } = useI18n()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<number>()

  useEffect(() => () => {
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current)
  }, [])

  const copy = async (): Promise<void> => {
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    resetTimer.current = window.setTimeout(() => setState('idle'), 1_400)
  }

  const label = state === 'copied'
    ? tr('Copied', '已复制')
    : state === 'failed'
      ? tr('Copy failed', '复制失败')
      : tr('Copy', '复制')

  return (
    <button
      type="button"
      className={['copy-text-button', className].filter(Boolean).join(' ')}
      data-copy-state={state}
      onClick={() => { void copy() }}
      aria-label={label}
      title={label}
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={12} />
      <span>{label}</span>
    </button>
  )
}
