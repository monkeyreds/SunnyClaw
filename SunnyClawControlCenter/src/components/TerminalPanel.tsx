import { useEffect, useRef } from 'react'
import type { TerminalSession } from '../types'

interface TerminalPanelProps {
  session: TerminalSession | null
  onClose: () => void
}

export default function TerminalPanel({ session, onClose }: TerminalPanelProps) {
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [session?.output, session?.status])

  if (!session) return null

  return (
    <div className="terminal-panel">
      <div className="terminal-panel-header">
        <div className="terminal-panel-title">
          <span className="terminal-panel-icon">⌨️</span>
          <span>终端执行</span>
          {session.status === 'running' && <span className="terminal-status running">执行中</span>}
          {session.status === 'done' && <span className="terminal-status done">已完成</span>}
          {session.status === 'denied' && <span className="terminal-status denied">已拒绝</span>}
        </div>
        <button type="button" className="terminal-panel-close" onClick={onClose} title="关闭">
          ✕
        </button>
      </div>
      <pre className="terminal-command">$ {session.command}</pre>
      <pre ref={outputRef} className="terminal-output">
        {session.output || (session.status === 'running' ? '正在执行...\n' : '')}
      </pre>
    </div>
  )
}
