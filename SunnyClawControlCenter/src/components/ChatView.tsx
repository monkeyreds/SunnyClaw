import { useState, useRef, useEffect, useCallback } from 'react'
import type {
  ChatMessage,
  SSEEvent,
  ToolCallInfo,
  PendingUserQuestion,
  PendingCommandPermission,
  TerminalSession,
  FileAttachment
} from '../types'
import { formatThinkingTime, isToolCallLikeText, sanitizeAssistantContent } from '../types'
import { sendMessage, approvePermission, answerUserQuestion } from '../services/api'
import MessageBubble from './MessageBubble'
import UserQuestionModal from './UserQuestionModal'
import CommandPermissionModal from './CommandPermissionModal'
import TerminalPanel from './TerminalPanel'

interface ChatViewProps {
  conversationId: string | null
  messages: ChatMessage[]
  enableSearch: boolean
  skills: string[]
  onToggleSearch: () => void
  onMessagesUpdate: (
    convId: string,
    messagesOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => void
  onFirstMessage: (conversationId: string, content: string) => void
  onTerminalSessionChange?: (session: TerminalSession | null) => void
}

const MAX_FILE_SIZE = 5 * 1024 * 1024

async function fileToAttachment(file: File): Promise<FileAttachment> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    data: btoa(binary),
    size: file.size
  }
}

function matchToolCall(tc: ToolCallInfo, event: SSEEvent): boolean {
  if (event.toolCallId) return tc.id === event.toolCallId
  return tc.name === event.name && !tc.result
}

function deferStateUpdate(fn: () => void) {
  queueMicrotask(fn)
}

export default function ChatView({
  conversationId,
  messages,
  enableSearch,
  skills,
  onToggleSearch,
  onMessagesUpdate,
  onFirstMessage,
  onTerminalSessionChange
}: ChatViewProps) {
  const [input, setInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState<FileAttachment[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null)
  const [thinkingElapsed, setThinkingElapsed] = useState(0)
  const [pendingQuestion, setPendingQuestion] = useState<PendingUserQuestion | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PendingCommandPermission | null>(null)
  const [terminalSession, setTerminalSession] = useState<TerminalSession | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamingConvIdRef = useRef<string | null>(null)
  const terminalByConvRef = useRef(new Map<string, TerminalSession>())
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const applyTerminal = useCallback(
    (
      convId: string,
      session:
        | TerminalSession
        | null
        | ((prev: TerminalSession | null) => TerminalSession | null)
    ) => {
      const prev = terminalByConvRef.current.get(convId) ?? null
      const next = typeof session === 'function' ? session(prev) : session
      if (next) {
        terminalByConvRef.current.set(convId, { ...next, conversationId: convId })
      } else {
        terminalByConvRef.current.delete(convId)
      }
      if (convId === conversationId) {
        const display = next ? terminalByConvRef.current.get(convId) ?? null : null
        setTerminalSession(display)
        onTerminalSessionChange?.(display)
      }
    },
    [conversationId, onTerminalSessionChange]
  )

  useEffect(() => {
    if (conversationId !== streamingConvIdRef.current) {
      setIsStreaming(false)
      setThinkingStartTime(null)
      setThinkingElapsed(0)
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current)
        thinkingTimerRef.current = null
      }
    }
    setPendingQuestion(null)
    setPendingPermission(null)
    const terminal = conversationId ? terminalByConvRef.current.get(conversationId) ?? null : null
    setTerminalSession(terminal)
    onTerminalSessionChange?.(terminal)
  }, [conversationId, onTerminalSessionChange])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinkingElapsed])

  useEffect(() => {
    if (thinkingStartTime && isStreaming) {
      thinkingTimerRef.current = setInterval(() => {
        setThinkingElapsed((Date.now() - thinkingStartTime) / 1000)
      }, 100)
      return () => {
        if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current)
      }
    }
  }, [thinkingStartTime, isStreaming])

  const handleQuestionAnswer = useCallback(async (requestId: string, answer: string) => {
    try {
      await answerUserQuestion(requestId, answer)
      setPendingQuestion(null)
      if (conversationId) {
        onMessagesUpdate(conversationId, prev =>
          prev.map(msg => {
            if (!msg.toolCalls) return msg
            const updatedCalls = msg.toolCalls.map(tc =>
              tc.name === 'ask_user' && !tc.result ? { ...tc, result: answer } : tc
            )
            return { ...msg, toolCalls: updatedCalls }
          })
        )
      }
    } catch (err) {
      console.error('提交回答失败:', err)
    }
  }, [conversationId, onMessagesUpdate])

  const handlePermissionApprove = useCallback(async (requestId: string) => {
    try {
      await approvePermission(requestId, true)
      setPendingPermission(null)
    } catch (err) {
      console.error('授权请求失败:', err)
    }
  }, [])

  const handlePermissionDeny = useCallback(async (requestId: string) => {
    try {
      await approvePermission(requestId, false)
      setPendingPermission(null)
      if (conversationId) {
        applyTerminal(conversationId, prev =>
          prev
            ? { ...prev, status: 'denied', output: prev.output || '用户拒绝了命令执行。' }
            : null
        )
      }
    } catch (err) {
      console.error('授权请求失败:', err)
    }
  }, [conversationId, applyTerminal])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    const next: FileAttachment[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`文件 ${file.name} 超过 5MB 限制`)
        continue
      }
      next.push(await fileToAttachment(file))
    }
    setPendingFiles(prev => [...prev, ...next])
    e.target.value = ''
  }

  const removePendingFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }

  const finishStreaming = useCallback(() => {
    setIsStreaming(false)
    setThinkingStartTime(null)
    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current)
    abortControllerRef.current = null
  }, [])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
    finishStreaming()
    if (!conversationId) return
    onMessagesUpdate(conversationId, prev => {
      if (prev.length === 0) return prev
      const updated = [...prev]
      const lastIdx = updated.length - 1
      const last = { ...updated[lastIdx] }
      if (last.role !== 'assistant') return prev
      last.isStreaming = false
      const suffix = '\n\n— 已停止生成 —'
      if (!last.content.includes('已停止生成')) {
        last.content = (last.content || '') + suffix
      }
      updated[lastIdx] = last
      return updated
    })
  }, [conversationId, finishStreaming, onMessagesUpdate])

  const handleSend = async () => {
    if ((!input.trim() && pendingFiles.length === 0) || !conversationId || isStreaming) return

    const trimmedInput = input.trim() || '请查看我上传的附件并回答。'
    const currentConvId = conversationId
    const attachmentsToSend = [...pendingFiles]
    streamingConvIdRef.current = currentConvId

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      attachments: attachmentsToSend.map(f => ({ name: f.name, size: f.size }))
    }

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      toolCalls: [],
      isStreaming: true
    }

    const newMessages = [...messages, userMessage, assistantMessage]
    onMessagesUpdate(currentConvId, newMessages)
    setInput('')
    setPendingFiles([])
    setIsStreaming(true)
    setThinkingStartTime(Date.now())
    setThinkingElapsed(0)

    if (messages.length === 0) {
      onFirstMessage(currentConvId, trimmedInput)
    }

    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    let streamEnded = false
    try {
    await sendMessage(
      currentConvId,
      trimmedInput,
      { enableSearch, skills, attachments: attachmentsToSend.length ? attachmentsToSend : undefined },
      (event: SSEEvent) => {
        if (streamingConvIdRef.current !== currentConvId) return

        onMessagesUpdate(currentConvId, prev => {
          const updated = [...prev]
          const lastIdx = updated.length - 1
          if (lastIdx < 0) return prev
          const last = { ...updated[lastIdx] }

          switch (event.type) {
            case 'content': {
              const next = sanitizeAssistantContent(last.content + (event.content || ''))
              last.content = isToolCallLikeText(next) ? '' : next
              break
            }
            case 'content_replace':
              last.content = sanitizeAssistantContent(event.content || '')
              break
            case 'tool_call':
              if (!last.toolCalls) last.toolCalls = []
              last.toolCalls = [
                ...last.toolCalls,
                {
                  id: event.toolCallId || `tc-${last.toolCalls.length}`,
                  name: event.name || '',
                  arguments: event.arguments || {},
                  result: ''
                }
              ]
              last.content = sanitizeAssistantContent(last.content)
              if (isToolCallLikeText(last.content)) {
                last.content = ''
              }
              break
            case 'tool_result':
              if (last.toolCalls) {
                last.toolCalls = last.toolCalls.map((tc: ToolCallInfo) =>
                  matchToolCall(tc, event)
                    ? { ...tc, result: event.result || '' }
                    : tc
                )
              }
              break
            case 'permission_request':
              break
            case 'done':
              last.isStreaming = false
              last.thinkingTime = event.thinkingTime
              last.content = sanitizeAssistantContent(last.content)
              if (isToolCallLikeText(last.content)) {
                last.content = ''
              }
              break
            case 'cancelled':
              last.isStreaming = false
              if (!last.content.includes('已停止生成')) {
                last.content = (last.content || '') + '\n\n— 已停止生成 —'
              }
              break
            case 'error':
              last.isStreaming = false
              last.content += `\n\n❌ 错误: ${event.message || '未知错误'}`
              break
          }

          updated[lastIdx] = last
          return updated
        })

        deferStateUpdate(() => {
          if (streamingConvIdRef.current !== currentConvId) return

          if (event.type === 'terminal_start' && event.command) {
            applyTerminal(currentConvId, {
              toolCallId: event.toolCallId || 'terminal',
              command: event.command,
              output: '',
              status: 'running',
              conversationId: currentConvId
            })
          }
          if (event.type === 'terminal_output') {
            applyTerminal(currentConvId, prev =>
              prev ? { ...prev, output: prev.output + (event.output || '') } : null
            )
          }
          if (event.type === 'terminal_end') {
            applyTerminal(currentConvId, prev =>
              prev ? { ...prev, status: prev.status === 'denied' ? 'denied' : 'done' } : prev
            )
          }
          if (event.type === 'permission_request' && event.requestId && event.highRisk) {
            setPendingPermission({
              requestId: event.requestId,
              arguments: event.arguments || {}
            })
          }
          if (event.type === 'user_question' && event.requestId && event.question) {
            setPendingQuestion({
              requestId: event.requestId,
              question: event.question,
              options: event.options
            })
          }
          if (event.type === 'done' || event.type === 'error' || event.type === 'cancelled') {
            streamEnded = true
            finishStreaming()
          }
        })
      },
      abortController.signal
    )
    } catch (err) {
      if (!abortController.signal.aborted) {
        console.error('发送消息失败:', err)
        onMessagesUpdate(currentConvId, prev => {
          const updated = [...prev]
          const lastIdx = updated.length - 1
          if (lastIdx < 0) return prev
          const last = { ...updated[lastIdx] }
          if (last.role !== 'assistant') return prev
          last.isStreaming = false
          last.content += `\n\n❌ 错误: ${err instanceof Error ? err.message : '发送失败'}`
          updated[lastIdx] = last
          return updated
        })
      }
    } finally {
      if (!streamEnded) {
        finishStreaming()
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isThinking =
    isStreaming && thinkingStartTime !== null && streamingConvIdRef.current === conversationId
  const showStop = isStreaming && streamingConvIdRef.current === conversationId

  return (
    <div className="chat-view">
      <UserQuestionModal pending={pendingQuestion} onSubmit={handleQuestionAnswer} />
      <CommandPermissionModal
        pending={pendingPermission}
        onApprove={handlePermissionApprove}
        onDeny={handlePermissionDeny}
      />
      <TerminalPanel
        session={terminalSession}
        onClose={() => {
          if (conversationId) applyTerminal(conversationId, null)
        }}
      />
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">☀️</div>
            <h2>SunnyClaw 智能助手</h2>
            <p>你的 AI Agent，支持命令执行、联网搜索与文件上传</p>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isThinking && (
          <div className="thinking-indicator">
            <div className="thinking-spinner" />
            <span>思考中... {formatThinkingTime(thinkingElapsed)}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {pendingFiles.length > 0 && (
          <div className="pending-files">
            {pendingFiles.map((f, i) => (
              <span key={i} className="pending-file-chip">
                📎 {f.name}
                <button type="button" onClick={() => removePendingFile(i)} aria-label="移除">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-input-wrap">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="file-input-hidden"
            onChange={handleFileSelect}
          />
          <textarea
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={conversationId ? '输入消息... (Enter 发送, Shift+Enter 换行)' : '请先新建一个对话'}
            disabled={!conversationId || isStreaming || !!pendingQuestion || !!pendingPermission}
            rows={1}
          />
          <div className="chat-input-actions">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!conversationId || isStreaming}
              title="上传文件"
            >
              📎
            </button>
            <button
              type="button"
              className={`search-icon-btn ${enableSearch ? 'active' : ''}`}
              onClick={onToggleSearch}
              title={enableSearch ? '联网搜索已开启' : '开启联网搜索'}
            >
              🔍
            </button>
            {showStop ? (
              <button
                type="button"
                className="stop-btn"
                onClick={handleStop}
                title="停止生成"
              >
                ■
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={
                  (!input.trim() && pendingFiles.length === 0) ||
                  !conversationId ||
                  !!pendingQuestion ||
                  !!pendingPermission
                }
              >
                ➤
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
