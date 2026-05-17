import { useState, useEffect, useRef } from 'react'
import type { PendingUserQuestion } from '../types'

interface UserQuestionModalProps {
  pending: PendingUserQuestion | null
  onSubmit: (requestId: string, answer: string) => void
}

export default function UserQuestionModal({ pending, onSubmit }: UserQuestionModalProps) {
  const [answer, setAnswer] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (pending) {
      setAnswer('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [pending])

  if (!pending) return null

  const handleSubmit = (value?: string) => {
    const trimmed = (value ?? answer).trim()
    if (!trimmed) return
    onSubmit(pending.requestId, trimmed)
    setAnswer('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="user-question-overlay">
      <div className="user-question-modal" role="dialog" aria-modal="true" aria-labelledby="user-question-title">
        <div className="user-question-header">
          <span className="user-question-icon">💬</span>
          <h3 id="user-question-title">SunnyClaw 需要您的确认</h3>
        </div>
        <p className="user-question-text">{pending.question}</p>
        {pending.options && pending.options.length > 0 && (
          <div className="user-question-options">
            {pending.options.map((opt, i) => (
              <button
                key={i}
                type="button"
                className="user-question-option-btn"
                onClick={() => handleSubmit(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="user-question-input"
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入您的回答..."
          rows={3}
        />
        <div className="user-question-actions">
          <button
            type="button"
            className="user-question-submit"
            onClick={() => handleSubmit()}
            disabled={!answer.trim()}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
