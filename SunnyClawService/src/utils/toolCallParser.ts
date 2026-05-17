import { getDefaultTimeCommand, userAsksForCurrentTime } from './platformContext.js'

export interface ParsedToolCall {
  name: string
  arguments: Record<string, unknown>
}

const TOOL_NAMES = ['web_search', 'execute_command', 'ask_user']
const TOOL_NAMES_PATTERN = TOOL_NAMES.join('|')
const TOOL_MARKER_RE = new RegExp(
  `"name"\\s*:\\s*"(?:${TOOL_NAMES_PATTERN})|(?:function|ünchen|fn|ronics|tool_calls?)\\s*\\{|<\\/?tools>`,
  'i'
)

const TEXT_TOOL_CALL_PATTERNS = [
  new RegExp(`\\b(?:${TOOL_NAMES_PATTERN})\\s*\\(`, 'i'),
  new RegExp(`"name"\\s*:\\s*"(?:${TOOL_NAMES_PATTERN})"`, 'i'),
  /\bexecute_command\b/i,
  /<\/?tools>/i,
  /ronics\s*>/i,
  /\bexecute\s*\(/i
]

const DEBRIS_LINE_RE =
  /^(?:ronics|tools|xml\s*tags?|function|tool_calls?|\}\}+|execute\s*\(|["':;]+)\s*$/i

function dedupeRepeatedSentences(text: string): string {
  const segments = text.split(/(?<=[。！？.!?]\s*|\n+)/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const seg of segments) {
    const key = seg.trim()
    if (!key) {
      out.push(seg)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(seg)
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}

function stripMalformedToolDebris(content: string): string {
  return content
    .replace(/ronics\s*>\s*<\/?tools>/gi, '')
    .replace(/<\/?tools>/gi, '')
    .replace(/XML\s*tags?\s*:?\s*['"`:;\s]*/gi, '')
    .replace(/\}\}\}+/g, '')
    .replace(/execute\s*\(\s*["'][^"']*["']\s*\)/gi, '')
    .replace(/```(?:\w+)?\s*```/g, '')
}

function stripTextToolCallSyntax(content: string): string {
  return stripMalformedToolDebris(content)
    .replace(
      new RegExp(
        `(?:function|ünchen|fn|ronics|tool_calls?)?\\s*\\{\\s*"name"\\s*:\\s*"(?:${TOOL_NAMES_PATTERN})"\\s*,\\s*"arguments"\\s*:\\s*\\{[\\s\\S]*?\\}\\s*\\}`,
        'gi'
      ),
      ''
    )
    .replace(/web_search\s*\(\s*query\s*=\s*["'][^"']*["']\s*\)/gi, '')
    .replace(/web_search\s*\(\s*(\{[\s\S]*?\})\s*\)/gi, '')
    .replace(/execute_command\s*\(\s*(\{[\s\S]*?\})\s*\)/gi, '')
    .replace(/ask_user\s*\(\s*(\{[\s\S]*?\})\s*\)/gi, '')
    .replace(new RegExp(`\\b(?:${TOOL_NAMES_PATTERN})\\s*\\([^)]*\\)`, 'gi'), '')
    .replace(new RegExp(`"name"\\s*:\\s*"(?:${TOOL_NAMES_PATTERN})[^"\\n]*"?`, 'gi'), '')
    .replace(/"arguments"\s*:\s*\{[^}]*\}/gi, '')
    .replace(/\bexecute_command\b/gi, '')
}

function dropDebrisLines(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim()
      if (!t) return true
      if (/[\u4e00-\u9fff]/.test(t)) return true
      if (DEBRIS_LINE_RE.test(t)) return false
      if (t.length < 120 && /^[\x00-\x7F\s'"`.:;,\-<>/\\]+$/.test(t) && !/^```/.test(t)) {
        return false
      }
      return true
    })
    .join('\n')
}

export function isToolCallContent(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (TOOL_MARKER_RE.test(t)) return true
  if (TEXT_TOOL_CALL_PATTERNS.some(p => p.test(t))) return true
  return false
}

/** True when visible text is only tool/XML debris with no user-facing Chinese. */
export function isToolDebrisOnly(text: string): boolean {
  const t = sanitizeAssistantContent(text).trim()
  if (!t) return true
  if (/[\u4e00-\u9fff]{2,}/.test(t)) return false
  return isToolCallContent(text) || TEXT_TOOL_CALL_PATTERNS.some(p => p.test(text))
}

function parseWebSearchCalls(content: string, seen: Set<string>, results: ParsedToolCall[]) {
  const queryEqPattern = /web_search\s*\(\s*query\s*=\s*["']([^"']+)["']\s*\)/gi
  let match: RegExpExecArray | null
  while ((match = queryEqPattern.exec(content)) !== null) {
    const query = match[1].trim()
    if (!query) continue
    const key = `web_search:${query}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ name: 'web_search', arguments: { query } })
  }

  const jsonArgPattern = /web_search\s*\(\s*(\{[\s\S]*?\})\s*\)/gi
  while ((match = jsonArgPattern.exec(content)) !== null) {
    try {
      const args = JSON.parse(match[1].replace(/\\"/g, '"')) as Record<string, unknown>
      const query = String(args.query || '').trim()
      if (!query) continue
      const key = `web_search:${query}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ name: 'web_search', arguments: { query } })
    } catch {
      // skip malformed
    }
  }

  const execWeather = content.match(/execute\s*\(\s*["']([^"']*(?:weather|forecast|天气)[^"']*)["']\s*\)/i)
  if (execWeather) {
    const query = execWeather[1].trim()
    const key = `web_search:${query}`
    if (!seen.has(key)) {
      seen.add(key)
      results.push({ name: 'web_search', arguments: { query } })
    }
  }
}

function parseExecuteCommandCalls(content: string, seen: Set<string>, results: ParsedToolCall[]) {
  const fnCallPattern = /execute_command\s*\(\s*(\{[\s\S]*?\})\s*\)/gi
  let match: RegExpExecArray | null
  while ((match = fnCallPattern.exec(content)) !== null) {
    try {
      const raw = match[1].replace(/\\"/g, '"')
      const args = JSON.parse(raw) as Record<string, unknown>
      const command = String(args.command || '').trim()
      if (!command) continue
      const key = `execute_command:${command}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ name: 'execute_command', arguments: { command } })
    } catch {
      // skip malformed
    }
  }
}

export function parseToolCallsFromContent(
  content: string,
  userContent = ''
): ParsedToolCall[] {
  const results: ParsedToolCall[] = []
  const seen = new Set<string>()

  const jsonPattern = new RegExp(
    `\\{\\s*"name"\\s*:\\s*"(${TOOL_NAMES_PATTERN})"\\s*,\\s*"arguments"\\s*:\\s*(\\{[\\s\\S]*?\\})\\s*\\}`,
    'g'
  )
  let match: RegExpExecArray | null
  while ((match = jsonPattern.exec(content)) !== null) {
    try {
      const name = match[1]
      const args = JSON.parse(match[2]) as Record<string, unknown>
      const key = `${name}:${JSON.stringify(args)}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({ name, arguments: args })
      }
    } catch {
      // skip malformed
    }
  }

  parseWebSearchCalls(content, seen, results)
  parseExecuteCommandCalls(content, seen, results)

  if (
    results.every(r => r.name !== 'execute_command') &&
    userContent &&
    userAsksForCurrentTime(userContent) &&
    /\bexecute_command\b/i.test(content)
  ) {
    const command = getDefaultTimeCommand()
    results.push({ name: 'execute_command', arguments: { command } })
  }

  if (results.length === 0) {
    const start = content.indexOf('{')
    if (start >= 0) {
      try {
        const obj = JSON.parse(content.slice(start)) as { name?: string; arguments?: Record<string, unknown> }
        if (obj.name && obj.arguments && TOOL_NAMES.includes(obj.name)) {
          results.push({ name: obj.name, arguments: obj.arguments })
        }
      } catch {
        // not valid JSON
      }
    }
  }

  return results
}

export function stripToolCallContent(content: string): string {
  return dedupeRepeatedSentences(dropDebrisLines(stripTextToolCallSyntax(content)))
}

/** Remove tool-call JSON debris from text shown to users (including partial/corrupted prefixes). */
export function sanitizeAssistantContent(content: string): string {
  if (!content) return ''

  let result = stripToolCallContent(content)

  const firstHan = result.search(/[\u4e00-\u9fff]/)
  if (firstHan > 0) {
    const prefix = result.slice(0, firstHan)
    if (TOOL_MARKER_RE.test(prefix) || TEXT_TOOL_CALL_PATTERNS.some(p => p.test(prefix))) {
      result = result.slice(firstHan)
    }
  }

  result = result.replace(
    new RegExp(
      `(?:function|ünchen|fn|ronics|tool_calls?|<\\/?tools>)\\s*[\\s\\S]*?(?=[\\u4e00-\\u9fff])`,
      'gi'
    ),
    ''
  )

  result = dedupeRepeatedSentences(dropDebrisLines(result.trim()))
  return result.replace(/\n{3,}/g, '\n\n').trim()
}
