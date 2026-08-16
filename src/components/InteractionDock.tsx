import { InteractionPanel, type QuestionAnswer } from './InteractionPanel.tsx'
import type { ApprovalChoice } from '../lib/approval.ts'
import type { ApprovalRequest, QuestionRequest } from '../lib/types.ts'

interface InteractionDockProps {
  approvals: ApprovalRequest[]
  questions: QuestionRequest[]
  onApproval: (request: ApprovalRequest, outcome: ApprovalChoice) => void
  onQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
}

export function InteractionDock({ approvals, questions, onApproval, onQuestion }: InteractionDockProps) {
  const approval = approvals[0]
  const question = approval === undefined ? questions[0] : undefined
  const count = approvals.length + questions.length
  if (approval === undefined && question === undefined) return null

  const source = approval?.source === 'codex' ? 'Codex' : 'Harness'
  return (
    <div className="main-interaction-dock" aria-label="Pending agent interaction">
      <div className="main-interaction-status">
        <span>{question === undefined ? `${source} approval` : 'Harness question'}</span>
        {count > 1 && <small>{count - 1} more waiting</small>}
      </div>
      <InteractionPanel approval={approval} question={question} onApproval={onApproval} onQuestion={onQuestion} />
    </div>
  )
}
