export interface ConversationSummary {
  id: string
  title: string
  createdAt: number
}

export interface ConversationDetail {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
}

export interface FileAttachment {
  name: string
  mimeType: string
  data: string
  size: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinkingTime?: number
  toolCalls?: ToolCallInfo[]
  permissionRequest?: PermissionRequest
  isStreaming?: boolean
  attachments?: { name: string; size: number }[]
}

export interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
  result: string
}

export interface PermissionRequest {
  requestId: string
  name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied'
  toolCallId?: string
}

export interface PendingUserQuestion {
  requestId: string
  question: string
  options?: string[]
}

export interface PendingCommandPermission {
  requestId: string
  arguments: Record<string, unknown>
}

export interface TerminalSession {
  conversationId?: string
  toolCallId: string
  command: string
  output: string
  status: 'running' | 'done' | 'denied'
}

export interface SSEEvent {
  type:
    | 'thinking_start'
    | 'content'
    | 'content_replace'
    | 'tool_call'
    | 'tool_result'
    | 'permission_request'
    | 'user_question'
    | 'terminal_start'
    | 'terminal_output'
    | 'terminal_end'
    | 'done'
    | 'cancelled'
    | 'error'
  content?: string
  name?: string
  arguments?: Record<string, unknown>
  result?: string
  thinkingTime?: number
  message?: string
  requestId?: string
  question?: string
  options?: string[]
  toolCallId?: string
  command?: string
  output?: string
  highRisk?: boolean
}

export interface SkillDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

export function formatThinkingTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}秒`
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`
}

export {
  sanitizeAssistantContent,
  isToolCallLikeText,
  formatToolResultForDisplay
} from './utils/sanitizeContent'
