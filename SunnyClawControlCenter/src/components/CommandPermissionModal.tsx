import type { PendingCommandPermission } from '../types'

interface CommandPermissionModalProps {
  pending: PendingCommandPermission | null
  onApprove: (requestId: string) => void
  onDeny: (requestId: string) => void
}

export default function CommandPermissionModal({ pending, onApprove, onDeny }: CommandPermissionModalProps) {
  if (!pending) return null

  const command = (pending.arguments.command as string) || ''

  return (
    <div className="user-question-overlay command-permission-overlay">
      <div className="user-question-modal command-permission-modal" role="alertdialog" aria-modal="true">
        <div className="user-question-header">
          <span className="user-question-icon">⚠️</span>
          <h3>高危操作确认</h3>
        </div>
        <p className="command-permission-desc">
          SunnyClaw 请求执行以下<strong>高危命令</strong>，可能影响系统文件或数据。是否允许？
        </p>
        <pre className="command-permission-cmd">{command}</pre>
        <div className="user-question-actions command-permission-actions">
          <button type="button" className="permission-deny" onClick={() => onDeny(pending.requestId)}>
            ❌ 拒绝
          </button>
          <button type="button" className="permission-approve" onClick={() => onApprove(pending.requestId)}>
            ✅ 允许执行
          </button>
        </div>
      </div>
    </div>
  )
}
