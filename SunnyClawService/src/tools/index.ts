import type { OllamaToolCall } from '../types.js'
import { executeCommand } from './executeCommand.js'
import { webSearch } from './webSearch.js'

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'execute_command':
      return executeCommand(String(args.command || ''))
    case 'web_search':
      return webSearch(String(args.query || ''))
    default:
      return `[自定义技能 ${name}] 已收到调用请求，参数: ${JSON.stringify(args)}。该技能暂未实现具体执行逻辑，请根据描述自行处理。`
  }
}

export function validateToolCall(toolCall: OllamaToolCall): { name: string; args: Record<string, unknown> } | null {
  const name = toolCall.function.name
  const args = toolCall.function.arguments
  if (typeof args === 'string') {
    try {
      return { name, args: JSON.parse(args) }
    } catch {
      return null
    }
  }
  return { name, args: args as Record<string, unknown> }
}
