import { Router, type Response } from 'express'
import crypto from 'crypto'
import type { Conversation, OllamaMessage, SSEEvent } from '../types.js'
import { runAgent } from '../services/agent.js'
import { buildAttachmentContext, type MessageAttachment } from '../utils/attachments.js'

const router = Router()

function writeSse(res: Response, event: SSEEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
  const flush = (res as Response & { flush?: () => void }).flush
  if (typeof flush === 'function') flush.call(res)
}

const conversations = new Map<string, Conversation>()
const pendingPermissions = new Map<string, {
  resolve: (approved: boolean) => void
}>()
const pendingQuestions = new Map<string, {
  resolve: (answer: string) => void
}>()

router.get('/conversations', (_req, res) => {
  const list = Array.from(conversations.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt }))
  res.json(list)
})

router.post('/conversations', (_req, res) => {
  const id = crypto.randomUUID()
  const conversation: Conversation = {
    id,
    title: '新对话',
    messages: [],
    createdAt: Date.now()
  }
  conversations.set(id, conversation)
  res.json({ id, title: conversation.title, createdAt: conversation.createdAt })
})

router.get('/conversations/:id', (req, res) => {
  const conversation = conversations.get(req.params.id)
  if (!conversation) {
    res.status(404).json({ error: '对话不存在' })
    return
  }
  res.json(conversation)
})

router.delete('/conversations/:id', (req, res) => {
  conversations.delete(req.params.id)
  res.json({ success: true })
})

router.post('/permissions/:requestId', (req, res) => {
  const { approved } = req.body as { approved: boolean }
  const pending = pendingPermissions.get(req.params.requestId)
  if (!pending) {
    res.status(404).json({ error: '授权请求不存在或已过期' })
    return
  }
  pending.resolve(approved)
  pendingPermissions.delete(req.params.requestId)
  res.json({ success: true })
})

router.post('/questions/:requestId', (req, res) => {
  const { answer } = req.body as { answer: string }
  if (!answer || typeof answer !== 'string') {
    res.status(400).json({ error: '回答不能为空' })
    return
  }
  const pending = pendingQuestions.get(req.params.requestId)
  if (!pending) {
    res.status(404).json({ error: '提问请求不存在或已过期' })
    return
  }
  pending.resolve(answer.trim())
  pendingQuestions.delete(req.params.requestId)
  res.json({ success: true })
})

router.post('/conversations/:id/messages', async (req, res) => {
  const { content, enableSearch, skills, attachments } = req.body as {
    content: string
    enableSearch?: boolean
    skills?: string[]
    attachments?: MessageAttachment[]
  }
  if (!content || typeof content !== 'string') {
    res.status(400).json({ error: '内容不能为空' })
    return
  }

  let conversation = conversations.get(req.params.id)
  if (!conversation) {
    conversation = {
      id: req.params.id,
      title: '新对话',
      messages: [],
      createdAt: Date.now()
    }
    conversations.set(req.params.id, conversation)
  }

  const attachmentContext = attachments?.length ? buildAttachmentContext(attachments) : ''
  const fullUserContent = content + attachmentContext
  const userMessage: OllamaMessage = { role: 'user', content: fullUserContent }
  conversation.messages.push(userMessage)

  if (conversation.title === '新对话') {
    conversation.title = content.length > 30 ? content.slice(0, 30) + '...' : content
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  writeSse(res, { type: 'thinking_start' })

  let assistantContent = ''
  let streamTerminalSent = false
  const abortController = new AbortController()

  const markTerminal = (event: SSEEvent) => {
    if (event.type === 'done' || event.type === 'error' || event.type === 'cancelled') {
      streamTerminalSent = true
    }
  }

  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort()
    }
  })

  const customSkills = (skills || []).map(name => ({
    name,
    description: `自定义技能: ${name}`,
    parameters: {
      type: 'object' as const,
      properties: {
        input: { type: 'string', description: `提供给 ${name} 技能的输入` }
      },
      required: ['input']
    }
  }))

  const onPermission = (requestId: string, _toolName: string, _args: Record<string, unknown>): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      pendingPermissions.set(requestId, { resolve })
    })
  }

  const onUserQuestion = (requestId: string, _question: string, _options?: string[]): Promise<string> => {
    return new Promise<string>((resolve) => {
      pendingQuestions.set(requestId, { resolve })
    })
  }

  try {
    for await (const event of runAgent(
      conversation.messages,
      enableSearch ?? true,
      customSkills,
      onPermission,
      onUserQuestion,
      abortController.signal
    )) {
      if (event.type === 'thinking_start') continue

      if (event.type === 'content' && event.content) {
        assistantContent += event.content
      }

      writeSse(res, event)
      markTerminal(event)

      if (event.type === 'done' || event.type === 'cancelled') {
        if (assistantContent.trim()) {
          conversation.messages.push({
            role: 'assistant',
            content: assistantContent
          })
        }
      }

      if (abortController.signal.aborted) break
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '未知错误'
    writeSse(res, { type: 'error', message: errorMsg })
    streamTerminalSent = true
  }

  if (!streamTerminalSent) {
    if (abortController.signal.aborted) {
      writeSse(res, { type: 'cancelled' })
    } else {
      writeSse(res, {
        type: 'error',
        message: '服务未返回完整结果，请检查 Ollama 是否已启动及模型是否已安装（ollama list）。'
      })
    }
  }

  if (!res.writableEnded) {
    res.end()
  }
})

export default router
