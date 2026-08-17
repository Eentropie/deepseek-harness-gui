import { useI18n } from '../lib/i18n.tsx'
import type { AgentRoomRequest } from './AgentRoom.tsx'
import { Icon } from './Icon.tsx'

interface AgentRoomRequestCardProps {
  request: AgentRoomRequest
  onConfirm: () => void
  onDismiss: () => void
}

export function AgentRoomRequestCard({ request, onConfirm, onDismiss }: AgentRoomRequestCardProps) {
  const { tr } = useI18n()
  const audit = request.kind === 'audit'
  return (
    <section className="agent-room-request-dock" aria-label={tr('Agent Room request', 'Agent Room 请求')}>
      <div className="agent-room-request-card">
        <span className="interaction-icon agent-room-request-icon"><Icon name="agent" size={15} /></span>
        <div className="interaction-copy">
          <strong>{audit ? tr('Start an automatic Agent Room audit?', '启动自动 Agent Room 审计？') : tr('Send this automatic Room follow-up?', '发送这条自动 Room 追问？')}</strong>
          <span>{tr('The assistant requested desktop orchestration. Nothing will run until you confirm.', '助手请求了桌面编排；确认前不会启动任何 Agent。')}</span>
          <p>{request.text}</p>
        </div>
        <div className="interaction-actions">
          <button type="button" onClick={onDismiss}>{tr('Not now', '暂不')}</button>
          <button type="button" className="primary" onClick={onConfirm}>{audit ? tr('Start audit', '启动审计') : tr('Send follow-up', '发送追问')}</button>
        </div>
      </div>
    </section>
  )
}
