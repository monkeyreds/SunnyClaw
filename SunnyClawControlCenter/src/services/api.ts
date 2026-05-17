import type { ConversationSummary, SSEEvent, FileAttachment } from '../types'

const API_BASE = '/api'

export async function fetchHealth(): Promise<{
  ollamaModel: string
  ollamaModelPreferred?: string
}> {
  const res = await fetch(`${API_BASE}/health`)
  if (!res.ok) throw new Error('健康检查失败')
  return res.json()
}

export async function createConversation(): Promise<ConversationSummary> {
  const res = await fetch(`${API_BASE}/conversations`, { method: 'POST' })
  if (!res.ok) throw new Error('创建对话失败')
  return res.json()
}

export async function getConversations(): Promise<ConversationSummary[]> {
  const res = await fetch(`${API_BASE}/conversations`)
  if (!res.ok) throw new Error('获取对话列表失败')
  return res.json()
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    throw new Error(`删除对话失败: HTTP ${res.status}`)
  }
}

export async function approvePermission(requestId: string, approved: boolean): Promise<void> {
  await fetch(`${API_BASE}/permissions/${requestId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved })
  })
}

export async function answerUserQuestion(requestId: string, answer: string): Promise<void> {
  const res = await fetch(`${API_BASE}/questions/${requestId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer })
  })
  if (!res.ok) throw new Error('提交回答失败')
}

function parseSseLine(line: string, onEvent: (event: SSEEvent) => void) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data: ')) return
  const jsonStr = trimmed.slice(6)
  if (!jsonStr) return
  try {
    onEvent(JSON.parse(jsonStr) as SSEEvent)
  } catch {
    // skip malformed
  }
}

export async function sendMessage(
  conversationId: string,
  content: string,
  options: { enableSearch?: boolean; skills?: string[]; attachments?: FileAttachment[] },
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        enableSearch: options.enableSearch,
        skills: options.skills,
        attachments: options.attachments
      }),
      signal
    })
  } catch (err) {
    if (signal?.aborted) {
      queueMicrotask(() => onEvent({ type: 'cancelled' }))
      return
    }
    throw err
  }

  if (!res.ok) {
    const text = await res.text()
    queueMicrotask(() => {
      onEvent({ type: 'error', message: `HTTP ${res.status}: ${text}` })
    })
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawTerminal = false

  const dispatch = (event: SSEEvent) => {
    if (event.type === 'done' || event.type === 'error' || event.type === 'cancelled') {
      sawTerminal = true
    }
    onEvent(event)
  }

  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {})
      queueMicrotask(() => dispatch({ type: 'cancelled' }))
      return
    }
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      parseSseLine(line, dispatch)
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split('\n')) {
      parseSseLine(line, dispatch)
    }
  }

  if (!sawTerminal) {
    queueMicrotask(() =>
      dispatch({ type: 'error', message: '连接已结束但未收到完整回复，请检查后端日志与 Ollama 模型配置。' })
    )
  }
}
