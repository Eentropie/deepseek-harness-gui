import { useEffect, useState } from 'react'
import { Icon } from './Icon.tsx'
import type { ApprovalRequest, QuestionRequest } from '../lib/types.ts'

export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

interface InteractionPanelProps {
  approval?: ApprovalRequest
  question?: QuestionRequest
  onApproval: (request: ApprovalRequest, outcome: 'allowed-once' | 'rejected') => void
  onQuestion: (request: QuestionRequest, answers: QuestionAnswer[]) => void
}

export function InteractionPanel({ approval, question, onApproval, onQuestion }: InteractionPanelProps) {
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({})

  useEffect(() => {
    if (question === undefined) return
    setAnswers(Object.fromEntries(question.questions.map(item => [item.id, { id: item.id, selected: [], custom: '' }])))
  }, [question])

  if (approval !== undefined) {
    return (
      <section className="interaction-panel approval-panel" aria-live="assertive">
        <div className="interaction-icon"><Icon name="lock" size={15} /></div>
        <div className="interaction-copy"><strong>Approval required</strong><span>{approval.reason ?? `Tool ${approval.toolName} requests privileged execution.`}</span><code>{approval.toolName}</code></div>
        <div className="interaction-actions"><button type="button" onClick={() => onApproval(approval, 'rejected')}>Reject</button><button type="button" className="primary" onClick={() => onApproval(approval, 'allowed-once')}>Allow once</button></div>
      </section>
    )
  }

  if (question === undefined) return null
  const complete = question.questions.every(item => {
    const answer = answers[item.id]
    return answer !== undefined && (answer.selected.length > 0 || (answer.custom?.trim() ?? '') !== '')
  })

  return (
    <section className="interaction-panel question-panel" aria-live="assertive">
      <div className="interaction-icon"><Icon name="sparkles" size={15} /></div>
      <div className="interaction-copy"><strong>Harness question</strong><span>The agent is waiting for your answer.</span></div>
      <div className="question-list">
        {question.questions.map(item => {
          const answer = answers[item.id] ?? { id: item.id, selected: [], custom: '' }
          return (
            <div className="question-row" key={item.id}>
              {item.header !== undefined && <small>{item.header}</small>}
              <label>{item.question}</label>
              {item.detail !== undefined && <p>{item.detail}</p>}
              {item.options !== undefined && item.options.length > 0 ? (
                item.multiSelect === true ? (
                  <div className="question-options">
                    {item.options.map(option => {
                      const selected = answer.selected.includes(option.label)
                      return <button type="button" data-selected={selected} key={option.label} onClick={() => setAnswers(current => ({ ...current, [item.id]: { ...answer, selected: selected ? answer.selected.filter(value => value !== option.label) : [...answer.selected, option.label] } }))}>{option.label}</button>
                    })}
                  </div>
                ) : (
                  <select value={answer.selected[0] ?? ''} onChange={event => setAnswers(current => ({ ...current, [item.id]: { ...answer, selected: event.target.value === '' ? [] : [event.target.value] } }))}>
                    <option value="">Select an answer…</option>
                    {item.options.map(option => <option value={option.label} key={option.label}>{option.label}</option>)}
                  </select>
                )
              ) : (
                <input value={answer.custom ?? ''} placeholder="Type your answer" onChange={event => setAnswers(current => ({ ...current, [item.id]: { ...answer, custom: event.target.value, selected: [] } }))} />
              )}
            </div>
          )
        })}
      </div>
      <div className="interaction-actions"><button type="button" className="primary" disabled={!complete} onClick={() => onQuestion(question, question.questions.map(item => answers[item.id] ?? { id: item.id, selected: [] }))}>Submit answer</button></div>
    </section>
  )
}
