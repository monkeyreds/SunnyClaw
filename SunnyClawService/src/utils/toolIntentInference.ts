import type { ParsedToolCall } from './toolCallParser.js'
import { getDefaultTimeCommand, userAsksForCurrentTime } from './platformContext.js'
import { userExpectsToolAction } from './toolFollowUp.js'

const WEATHER_RE = /天气|气温|预报|下雨|晴天|温度|冷不冷|热不热/
const VERSION_RE = /版本|version|几点|哪个版/

const SHELL_LINE_RE =
  /^(?:[a-zA-Z]:\\[^\s]+|[$>]\s*)?([a-z][\w.-]*(?:\s+[^\s#;|>&]+)*)\s*$/i

/** Extract runnable commands from markdown fences or backticks. */
export function parseCommandsFromAssistantText(content: string): string[] {
  const commands: string[] = []
  const seen = new Set<string>()

  const add = (raw: string) => {
    const cmd = raw.trim().replace(/^[$>]\s*/, '')
    if (!cmd || cmd.startsWith('#')) return
    if (!SHELL_LINE_RE.test(cmd)) return
    if (seen.has(cmd)) return
    seen.add(cmd)
    commands.push(cmd)
  }

  const fenceRe = /```(?:bash|sh|shell|cmd|powershell|text)?\s*\n?([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(content)) !== null) {
    for (const line of m[1].split('\n')) add(line)
  }

  const inlineRe = /`([^`\n]{2,120})`/g
  while ((m = inlineRe.exec(content)) !== null) {
    add(m[1])
  }

  return commands
}

export function userWantsWeather(userContent: string): boolean {
  return WEATHER_RE.test(userContent)
}

export function userWantsVersionCheck(userContent: string, tool?: string): boolean {
  const t = tool || userContent
  if (!VERSION_RE.test(userContent)) return false
  return /python|node|npm|java|go|rustc|gcc|git/i.test(t)
}

export function mergeParsedToolCalls(...groups: ParsedToolCall[][]): ParsedToolCall[] {
  const seen = new Set<string>()
  const out: ParsedToolCall[] = []
  for (const group of groups) {
    for (const p of group) {
      const key = `${p.name}:${JSON.stringify(p.arguments)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

/**
 * When the model cannot emit valid Ollama tool_calls (common on 7B quants),
 * infer tools from the user question and any command-like text in the reply.
 */
export function inferToolCallsFromContext(
  userContent: string,
  assistantContent: string,
  existing: ParsedToolCall[] = []
): ParsedToolCall[] {
  if (!userExpectsToolAction(userContent)) return []

  const inferred: ParsedToolCall[] = []
  const has = (name: string) =>
    existing.some(r => r.name === name) || inferred.some(r => r.name === name)

  if (userWantsWeather(userContent) && !has('web_search')) {
    const fromUser = userContent
      .replace(/^(帮我|请|麻烦)?(查询|查一下|看看|告诉我)?/u, '')
      .trim()
    const fromExecute = assistantContent.match(/execute\s*\(\s*["']([^"']+)["']\s*\)/i)
    const query =
      (fromUser.length > 2 ? fromUser : '') ||
      fromExecute?.[1]?.trim() ||
      userContent.trim()
    if (query) {
      inferred.push({ name: 'web_search', arguments: { query } })
    }
  }

  if (userAsksForCurrentTime(userContent) && !has('execute_command')) {
    inferred.push({ name: 'execute_command', arguments: { command: getDefaultTimeCommand() } })
  }

  if (userWantsVersionCheck(userContent, userContent) && !has('execute_command')) {
    const cmds = parseCommandsFromAssistantText(assistantContent)
    const versionCmd =
      cmds.find(c => /python\s+--version/i.test(c)) ||
      cmds.find(c => /node\s+--version/i.test(c)) ||
      cmds.find(c => /--version/i.test(c))
    if (/python/i.test(userContent)) {
      inferred.push({
        name: 'execute_command',
        arguments: { command: versionCmd || 'python --version' }
      })
    } else if (/node/i.test(userContent)) {
      inferred.push({
        name: 'execute_command',
        arguments: { command: versionCmd || 'node --version' }
      })
    } else if (versionCmd) {
      inferred.push({ name: 'execute_command', arguments: { command: versionCmd } })
    }
  }

  if (!has('execute_command')) {
    const cmds = parseCommandsFromAssistantText(assistantContent)
    const command =
      cmds.find(c => /python\s+--version/i.test(c)) ||
      cmds.find(c => /node\s+--version/i.test(c)) ||
      cmds.find(c => /^(dir|where|which|npm|pip|git)\b/i.test(c)) ||
      cmds[0]
    if (command && userExpectsToolAction(userContent)) {
      inferred.push({ name: 'execute_command', arguments: { command } })
    }
  }

  return inferred
}
