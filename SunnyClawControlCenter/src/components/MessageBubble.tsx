import { useState } from 'react'
import type { ChatMessage, ToolCallInfo, PermissionRequest } from '../types'
import { formatThinkingTime, sanitizeAssistantContent, formatToolResultForDisplay } from '../types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MessageBubbleProps {
  message: ChatMessage
  onPermission?: (requestId: string, approved: boolean) => void
}

function getToolMeta(toolCall: ToolCallInfo) {
  switch (toolCall.name) {
    case 'execute_command':
      return {
        icon: '🔧',
        title: '执行命令',
        inputLabel: '命令',
        input: String(toolCall.arguments.command || ''),
        resultLabel: '执行结果'
      }
    case 'web_search':
      return {
        icon: '🔍',
        title: '联网搜索',
        inputLabel: '搜索词',
        input: String(toolCall.arguments.query || ''),
        resultLabel: '搜索结果'
      }
    case 'ask_user':
      return {
        icon: '💬',
        title: '向您提问',
        inputLabel: '问题',
        input: String(toolCall.arguments.question || ''),
        resultLabel: '您的回答'
      }
    default:
      return {
        icon: '🛠',
        title: toolCall.name,
        inputLabel: '参数',
        input: JSON.stringify(toolCall.arguments, null, 2),
        resultLabel: '结果'
      }
  }
}

function ToolCallBlock({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(true)
  const meta = getToolMeta(toolCall)
  const hasResult = Boolean(toolCall.result)

  return (
    <div className={`tool-call-block ${hasResult ? 'has-result' : 'pending'}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-name">{meta.icon} {meta.title}</span>
        <span className="tool-call-args-preview">{meta.input}</span>
        <span className={`tool-call-toggle ${expanded ? 'expanded' : ''}`}>▾</span>
      </div>
      {expanded && (
        <div className="tool-call-detail">
          <div className="tool-call-section">
            <div className="tool-call-label">{meta.inputLabel}</div>
            <pre className="tool-call-pre">{meta.input}</pre>
          </div>
          {hasResult ? (
            <div className="tool-call-section">
              <div className="tool-call-label">{meta.resultLabel}</div>
              <pre className="tool-call-pre tool-call-result">
                {formatToolResultForDisplay(toolCall.name, toolCall.result)}
              </pre>
            </div>
          ) : (
            <div className="tool-call-pending">执行中...</div>
          )}
        </div>
      )}
    </div>
  )
}

function PermissionBlock({ permission, onPermission }: { permission: PermissionRequest; onPermission?: (requestId: string, approved: boolean) => void }) {
  const command = (permission.arguments.command as string) || ''
  const isPending = permission.status === 'pending'

  return (
    <div className={`permission-block ${permission.status}`}>
      <div className="permission-header">
        <span className="permission-icon">⚠️</span>
        <span className="permission-title">请求执行命令</span>
      </div>
      <pre className="permission-command">{command}</pre>
      {isPending && (
        <div className="permission-actions">
          <button className="permission-approve" onClick={() => onPermission?.(permission.requestId, true)}>
            ✅ 允许
          </button>
          <button className="permission-deny" onClick={() => onPermission?.(permission.requestId, false)}>
            ❌ 拒绝
          </button>
        </div>
      )}
      {!isPending && (
        <div className={`permission-status ${permission.status}`}>
          {permission.status === 'approved' ? '✅ 已允许' : '❌ 已拒绝'}
        </div>
      )}
    </div>
  )
}

export default function MessageBubble({ message, onPermission }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-avatar">
        {isUser ? '👤' : '☀️'}
      </div>
      <div className="message-body">
        {!isUser && message.thinkingTime !== undefined && message.thinkingTime > 0 && (
          <div className="thinking-time">
            ✨ 思考用时 {formatThinkingTime(message.thinkingTime)}
          </div>
        )}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="tool-calls">
            {message.toolCalls.map(tc => (
              <ToolCallBlock key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
        {!isUser && message.permissionRequest && (
          <PermissionBlock
            permission={message.permissionRequest}
            onPermission={onPermission}
          />
        )}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((f, i) => (
              <span key={i} className="message-attachment-chip">📎 {f.name}</span>
            ))}
          </div>
        )}
        {message.content && (
          <div className="message-content-wrap">
            {isUser ? (
              <p>{message.content}</p>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {sanitizeAssistantContent(message.content)}
              </ReactMarkdown>
            )}
          </div>
        )}
        {message.isStreaming && !message.content && (!message.toolCalls || message.toolCalls.length === 0) && !message.permissionRequest && (
          <div className="message-content-wrap">
            <span className="cursor-blink">▊</span>
          </div>
        )}
      </div>
    </div>
  )
}
