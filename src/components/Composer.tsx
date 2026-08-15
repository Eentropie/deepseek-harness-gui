import { useRef } from 'react'
import { Icon } from './Icon.tsx'
import { ProviderLogo } from './ProviderLogo.tsx'
import { QueueDock } from './QueueDock.tsx'
import type { NetworkMode, PendingAttachment, PermissionOption, QueueItem, SessionModels } from '../lib/types.ts'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  disabled: boolean
  running: boolean
  busy: boolean
  error?: string
  models?: SessionModels
  permissionOptions: PermissionOption[]
  permission?: string
  onModel: (provider: string, model: string) => void
  onEffort: (effort: string) => void
  onPermission: (preset: string) => void
  networkMode: NetworkMode
  networkAvailable: boolean
  networkOnline: boolean
  onNetworkMode: (mode: NetworkMode) => void
  plan?: { active?: boolean; pending?: boolean }
  onExitPlan: () => void
  attachments: PendingAttachment[]
  onAddFiles: (files: File[]) => void
  onRemoveAttachment: (id: string) => void
  queue: QueueItem[]
  onQueueAction: (itemId: string, action: { kind: 'remove' | 'steer' } | { kind: 'edit'; text: string }) => void
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  running,
  busy,
  error,
  models,
  permissionOptions,
  permission,
  onModel,
  onEffort,
  onPermission,
  networkMode,
  networkAvailable,
  networkOnline,
  onNetworkMode,
  plan,
  onExitPlan,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  queue,
  onQueueAction,
}: ComposerProps) {
  const composing = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const currentModel = models?.groups
    .flatMap(group => group.models.map(model => ({ ...model, provider: group.id })))
    .find(model => model.provider === models.current.provider && model.id === models.current.model)
  const efforts = currentModel?.reasoning?.efforts ?? []
  const hasContent = value.trim() !== '' || attachments.length > 0
  const sendLocked = disabled || busy
  const canSend = !sendLocked && hasContent
  const assistantName = models?.current.provider === 'codex-cli' ? 'Codex' : 'DeepSeek'
  const webProvider = models?.current.provider === 'codex-cli' ? 'Codex' : 'Host'

  return (
    <div className="composer-seat">
      {error !== undefined && <div className="composer-error">{error}</div>}
      <QueueDock items={queue} running={running} disabled={disabled || busy} onAction={onQueueAction} />
      <div
        className="composer-card"
        data-disabled={disabled}
        onDragOver={event => { event.preventDefault() }}
        onDrop={event => {
          event.preventDefault()
          onAddFiles([...event.dataTransfer.files])
        }}
      >
        <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { onAddFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        <textarea
          ref={textarea}
          value={value}
          onChange={event => onChange(event.target.value)}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onPaste={event => {
            const images = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'))
            if (images.length === 0) return
            event.preventDefault()
            onAddFiles(images)
          }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey) return
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return
            event.preventDefault()
            if (canSend) onSend()
          }}
          placeholder={disabled ? 'Select a session to begin' : `Message ${assistantName}…`}
          disabled={disabled}
          rows={1}
          aria-label={`Message ${assistantName}`}
        />
        {attachments.length > 0 && (
          <div className="attachment-strip" aria-label="Pending image attachments">
            {attachments.map(attachment => (
              <div className="attachment-chip" key={attachment.id}>
                <img src={attachment.previewUrl} alt={attachment.name ?? 'Pending image'} />
                <span title={attachment.name}>{attachment.name ?? 'Image'}</span>
                <button type="button" aria-label={`Remove ${attachment.name ?? 'image'}`} onClick={() => onRemoveAttachment(attachment.id)}><Icon name="x" size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-toolbar">
          <div className="composer-controls">
            {plan !== undefined && (plan.pending === true ? plan.active !== true : plan.active === true) && (
              <button type="button" className="plan-chip" onClick={onExitPlan} disabled={disabled || busy} title="Exit plan mode">
                Plan <Icon name="x" size={11} />
              </button>
            )}
            <button type="button" className="composer-icon" disabled={disabled || busy} title="Attach image" onClick={() => fileInput.current?.click()}>
              <Icon name="paperclip" size={16} />
            </button>
            {models !== undefined && (
              <label className="composer-select model-select" title={running ? 'Model · applies from the next model step or turn' : 'Model'}>
                <ProviderLogo provider={models.current.provider} name={currentModel?.name} size={14} />
                <select
                  value={`${models.current.provider}::${models.current.model}`}
                  onChange={event => {
                    const [provider = '', model = ''] = event.target.value.split('::')
                    onModel(provider, model)
                  }}
                  disabled={busy}
                  aria-label="Model"
                >
                  {models.groups.map(group => (
                    <optgroup label={group.name} key={group.id}>
                      {group.models.map(model => (
                        <option value={`${group.id}::${model.id}`} key={`${group.id}-${model.id}`}>{model.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Icon name="chevron-down" size={12} />
              </label>
            )}
            {efforts.length > 0 && (
              <label className="composer-select" title={running ? 'Reasoning effort · applies from the next model step or turn' : 'Reasoning effort'}>
                <Icon name="brain" size={14} />
                <select
                  value={models?.current.reasoningEffort ?? currentModel?.reasoning?.defaultEffort ?? ''}
                  onChange={event => onEffort(event.target.value)}
                  disabled={busy}
                  aria-label="Reasoning effort"
                >
                  {efforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}
                </select>
                <Icon name="chevron-down" size={12} />
              </label>
            )}
            {permissionOptions.length > 0 && permission !== undefined && (
              <label className="composer-select" title={running ? 'Permission preset · applies from the next approval boundary or turn' : 'Permission preset'}>
                <select
                  value={permission}
                  onChange={event => onPermission(event.target.value)}
                  disabled={busy}
                  aria-label="Permission preset"
                >
                  {permissionOptions.map(option => <option value={option.value} key={option.value}>{option.name}</option>)}
                </select>
                <Icon name="chevron-down" size={12} />
              </label>
            )}
            <label
              className="composer-select network-select"
              data-enabled={networkMode !== 'off' && networkAvailable && networkOnline}
              title={!networkOnline
                ? `${webProvider} web access is offline`
                : networkAvailable
                ? running ? `${webProvider} web access · applies from the next tool boundary or turn` : `${webProvider} web access`
                : 'The selected DeepSeek preset does not expose web tools'}
            >
              <Icon name="globe" size={14} />
              <select
                value={networkMode}
                onChange={event => onNetworkMode(event.target.value as NetworkMode)}
                disabled={busy}
                aria-label="Web access"
              >
                <option value="off">Web off</option>
                <option value="auto">Web auto · {networkOnline ? webProvider : 'offline'}</option>
                <option value="ask">Ask before web</option>
              </select>
              <Icon name="chevron-down" size={12} />
            </label>
          </div>
          {running ? (
            <button type="button" className="send-button stop" onClick={onStop} disabled={busy} aria-label="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="send-button"
              onClick={() => {
                if (canSend) onSend()
                else textarea.current?.focus()
              }}
              disabled={sendLocked}
              data-empty={!hasContent}
              aria-label={hasContent ? 'Send' : 'Focus message input'}
              title={hasContent ? 'Send' : 'Type a message to send'}
            >
              <Icon name="send" size={15} />
            </button>
          )}
        </div>
      </div>
      <p className="composer-hint">{hasContent ? 'Enter to send' : 'Type a message to begin'} · Shift + Enter for a new line</p>
    </div>
  )
}
