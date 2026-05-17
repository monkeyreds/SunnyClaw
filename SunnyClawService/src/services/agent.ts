import type { OllamaMessage, SSEEvent } from '../types.js'
import { extractToolCallsFromChunk, streamChat } from './ollama.js'
import { executeTool, validateToolCall } from '../tools/index.js'
import { buildToolDefinitions } from '../tools/definitions.js'
import {
  isToolCallContent,
  isToolDebrisOnly,
  parseToolCallsFromContent,
  sanitizeAssistantContent,
  stripToolCallContent
} from '../utils/toolCallParser.js'
import {
  inferToolCallsFromContext,
  mergeParsedToolCalls
} from '../utils/toolIntentInference.js'
import { isHighRiskCommand } from '../utils/commandRisk.js'
import { formatToolResultForDisplay } from '../utils/toolDisplay.js'
import { getPlatformContext } from '../utils/platformContext.js'
import {
  getLastUserContent,
  isCasualConversation,
  shouldNudgeToolExecution,
  TOOL_ACTION_NUDGE
} from '../utils/toolFollowUp.js'

const USE_NATIVE_TOOLS = process.env.OLLAMA_NATIVE_TOOLS === 'true'

const SYSTEM_PROMPT = `你是 SunnyClaw，一个智能 AI 助手。系统会在后台根据用户问题自动执行联网搜索与本机命令，你只需用自然语言回答。

核心行为准则：
1. 需要真实数据（时间、天气、版本、文件、命令输出等）时，不要编造；简短说明「正在查询」即可，不要在正文里写工具名、XML、JSON、execute(...)、web_search(...)、代码块里的 shell 命令。
2. 禁止输出 function/tool_calls/tools/XML 标签、\`}}\`、ronics 等任何工具调用格式。
3. 搜索或命令执行完成后，根据系统提供的真实结果用简洁中文回答用户。
4. 始终使用与用户相同的语言。
5. 不要重复同一段话，不要只说不做。`

const SEARCH_SUMMARY_NUDGE = `请根据上方的搜索结果（含直达摘要与各条摘要），直接回答我的原始问题。提取关键事实（数字、天气、结论等），组织成完整自然语言回复。禁止仅罗列链接或推脱说未找到。`

export type PermissionHandler = (requestId: string, toolName: string, args: Record<string, unknown>) => Promise<boolean>
export type UserQuestionHandler = (requestId: string, question: string, options?: string[]) => Promise<string>

function toOllamaToolCalls(parsed: Array<{ name: string; arguments: Record<string, unknown> }>): OllamaMessage['tool_calls'] {
  return parsed.map(p => ({
    function: { name: p.name, arguments: p.arguments }
  }))
}

function isAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted)
}

function shouldAttachTools(
  userContent: string,
  iteration: number,
  toolNudgeIteration: boolean,
  customSkillCount: number
): boolean {
  if (customSkillCount > 0) return true
  if (toolNudgeIteration) return true
  if (iteration > 1) return false
  return !isCasualConversation(userContent)
}

function* emitSanitizedContentDeltas(
  fullContent: string,
  displayedLength: number
): Generator<SSEEvent, number> {
  const sanitized = sanitizeAssistantContent(fullContent)
  if (sanitized && !isToolCallContent(sanitized) && !isToolDebrisOnly(sanitized)) {
    const delta = sanitized.slice(displayedLength)
    if (delta) yield { type: 'content', content: delta }
    return sanitized.length
  }
  if (isToolDebrisOnly(fullContent) && displayedLength > 0) {
    yield { type: 'content_replace', content: sanitized || '' }
    return (sanitized || '').length
  }
  return displayedLength
}

export async function* runAgent(
  messages: OllamaMessage[],
  enableSearch: boolean = true,
  customSkills: Array<{ name: string; description: string; parameters: { type: string; properties: Record<string, unknown>; required: string[] } }> = [],
  onPermission?: PermissionHandler,
  onUserQuestion?: UserQuestionHandler,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  const startTime = Date.now()
  yield { type: 'thinking_start' }

  const tools = buildToolDefinitions(enableSearch, customSkills)
  const platformContext = getPlatformContext()

  const allMessages: OllamaMessage[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${platformContext}` },
    ...messages
  ]

  let continueLoop = true
  let hadFatalError = false
  const MAX_ITERATIONS = 10
  let iteration = 0
  let toolCallSeq = 0
  let toolNudgeUsed = false
  let toolNudgeIteration = false
  const initialUserContent = getLastUserContent(messages)

  while (continueLoop && iteration < MAX_ITERATIONS) {
    if (isAborted(signal)) {
      yield { type: 'cancelled' }
      return
    }

    iteration++
    const useTools = shouldAttachTools(
      initialUserContent,
      iteration,
      toolNudgeIteration,
      customSkills.length
    )
    toolNudgeIteration = false
    const activeTools = useTools && USE_NATIVE_TOOLS ? tools : []

    let fullContent = ''
    let displayedLength = 0
    let toolCalls: OllamaMessage['tool_calls'] = []

    try {
      for await (const chunk of streamChat(allMessages, activeTools, undefined, signal)) {
        if (isAborted(signal)) {
          yield { type: 'cancelled' }
          return
        }
        if (chunk.message?.content) {
          fullContent += chunk.message.content
          displayedLength = yield* emitSanitizedContentDeltas(fullContent, displayedLength)
        }
        if (chunk.done) {
          const finalTools = extractToolCallsFromChunk(chunk)
          if (finalTools?.length) toolCalls = finalTools
        }
      }
    } catch (err) {
      if (isAborted(signal)) {
        yield { type: 'cancelled' }
        return
      }
      const errorMsg = err instanceof Error ? err.message : '未知错误'
      yield { type: 'error', message: errorMsg }
      hadFatalError = true
      break
    }

    if (isAborted(signal)) {
      yield { type: 'cancelled' }
      return
    }

    if (useTools && (!toolCalls || toolCalls.length === 0)) {
      const parsed = parseToolCallsFromContent(fullContent, initialUserContent)
      const merged = mergeParsedToolCalls(
        parsed,
        inferToolCallsFromContext(initialUserContent, fullContent, parsed)
      )
      if (merged.length > 0) {
        toolCalls = toOllamaToolCalls(merged)
        fullContent = stripToolCallContent(fullContent)
        const cleaned = sanitizeAssistantContent(fullContent)
        yield { type: 'content_replace', content: cleaned }
        fullContent = cleaned
        displayedLength = cleaned.length
      }
    }

    const validToolCalls = (toolCalls || []).filter(tc => validateToolCall(tc) !== null)

    if (validToolCalls.length > 0) {
      allMessages.push({
        role: 'assistant',
        content: fullContent,
        tool_calls: validToolCalls
      })

      let hadWebSearch = false

      for (const toolCall of validToolCalls) {
        if (isAborted(signal)) {
          yield { type: 'cancelled' }
          return
        }

        const validated = validateToolCall(toolCall)!

        const toolCallId = `tc_${toolCallSeq++}`

        if (validated.name === 'ask_user') {
          const question = String(validated.args.question || '')
          const options = Array.isArray(validated.args.options)
            ? (validated.args.options as unknown[]).map(String)
            : undefined

          yield { type: 'tool_call', toolCallId, name: validated.name, arguments: validated.args }

          let answer = '用户未回复。'
          if (onUserQuestion && question) {
            const requestId = `question_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            yield { type: 'user_question', requestId, question, options }
            answer = await onUserQuestion(requestId, question, options)
          }

          if (isAborted(signal)) {
            yield { type: 'cancelled' }
            return
          }

          yield {
            type: 'tool_result',
            toolCallId,
            name: validated.name,
            result: formatToolResultForDisplay(validated.name, answer)
          }
          allMessages.push({ role: 'tool', name: validated.name, content: answer })
          continue
        }

        yield { type: 'tool_call', toolCallId, name: validated.name, arguments: validated.args }

        let approved = true
        const commandStr =
          validated.name === 'execute_command' ? String(validated.args.command || '').trim() : ''
        const needsApproval =
          validated.name === 'execute_command' &&
          commandStr.length > 0 &&
          isHighRiskCommand(commandStr)

        if (needsApproval && onPermission) {
          const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          yield {
            type: 'permission_request',
            requestId,
            toolCallId,
            name: validated.name,
            arguments: validated.args,
            highRisk: true
          }
          approved = await onPermission(requestId, validated.name, validated.args)
        }

        if (isAborted(signal)) {
          yield { type: 'cancelled' }
          return
        }

        if (validated.name === 'execute_command') {
          yield { type: 'terminal_start', toolCallId, command: commandStr }
        }

        if (!approved) {
          const denyMsg = '用户拒绝了此操作的授权请求。'
          yield { type: 'terminal_output', toolCallId, output: denyMsg }
          yield { type: 'terminal_end', toolCallId }
          yield { type: 'tool_result', toolCallId, name: validated.name, result: denyMsg }
          allMessages.push({ role: 'tool', name: validated.name, content: denyMsg })
          continue
        }

        const result = await executeTool(validated.name, validated.args)
        if (validated.name === 'web_search') hadWebSearch = true

        if (validated.name === 'execute_command') {
          yield { type: 'terminal_output', toolCallId, output: result }
          yield { type: 'terminal_end', toolCallId }
        }

        yield {
          type: 'tool_result',
          toolCallId,
          name: validated.name,
          result: formatToolResultForDisplay(validated.name, result)
        }
        allMessages.push({ role: 'tool', name: validated.name, content: result })
      }

      if (hadWebSearch) {
        allMessages.push({ role: 'user', content: SEARCH_SUMMARY_NUDGE })
        try {
          let summaryFull = ''
          let summaryDisplayed = 0
          for await (const chunk of streamChat(allMessages, [], undefined, signal)) {
            if (isAborted(signal)) {
              yield { type: 'cancelled' }
              return
            }
            if (chunk.message?.content) {
              summaryFull += chunk.message.content
              const sanitized = sanitizeAssistantContent(summaryFull)
              const delta = sanitized.slice(summaryDisplayed)
              summaryDisplayed = sanitized.length
              if (delta) yield { type: 'content', content: delta }
            }
          }
        } catch (err) {
          if (isAborted(signal)) {
            yield { type: 'cancelled' }
            return
          }
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          yield { type: 'error', message: errorMsg }
        }
        continueLoop = false
      }
    } else {
      displayedLength = yield* emitSanitizedContentDeltas(fullContent, displayedLength)
      const lastUser = getLastUserContent(allMessages)
      const cleanContent = sanitizeAssistantContent(fullContent)

      if (
        !toolNudgeUsed &&
        shouldNudgeToolExecution(lastUser, cleanContent || fullContent)
      ) {
        toolNudgeUsed = true
        toolNudgeIteration = true
        if (cleanContent || fullContent) {
          allMessages.push({ role: 'assistant', content: cleanContent || fullContent })
        }
        allMessages.push({ role: 'user', content: TOOL_ACTION_NUDGE })
        continue
      }

      if (!cleanContent && !fullContent.trim()) {
        yield {
          type: 'content',
          content: '抱歉，我暂时无法生成回复。请确认 Ollama 已启动且模型已加载，然后重试。'
        }
      }

      continueLoop = false
    }
  }

  if (isAborted(signal)) {
    yield { type: 'cancelled' }
    return
  }

  if (hadFatalError) return

  const thinkingTime = Number(((Date.now() - startTime) / 1000).toFixed(1))
  yield { type: 'done', thinkingTime }
}
