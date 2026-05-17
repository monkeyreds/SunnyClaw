export interface Conversation {
  id: string
  title: string
  messages: OllamaMessage[]
  createdAt: number
}

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_calls?: OllamaToolCall[]
  name?: string
}

export interface OllamaToolCall {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
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
