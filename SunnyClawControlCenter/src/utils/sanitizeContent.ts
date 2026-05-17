const TOOL_NAMES_PATTERN = 'web_search|execute_command|ask_user'
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

export function sanitizeAssistantContent(content: string): string {
  if (!content) return ''

  let result = dedupeRepeatedSentences(dropDebrisLines(stripTextToolCallSyntax(content)))

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

  return dedupeRepeatedSentences(dropDebrisLines(result.trim())).replace(/\n{3,}/g, '\n\n').trim()
}

const INTERNAL_LINE_PATTERNS = [
  /^请根据[\s\S]*$/,
  /^请勿[\s\S]*$/,
  /^必须[\s\S]*$/,
  /^禁止[\s\S]*$/,
  /^该技能暂未实现[\s\S]*$/
]

export function formatToolResultForDisplay(toolName: string, rawResult: string): string {
  if (!rawResult) return ''

  let out = rawResult.replace(/\n---\n[\s\S]*$/m, '').trim()

  if (toolName !== 'execute_command' && toolName !== 'ask_user') {
    out = out
      .split('\n')
      .filter(line => {
        const t = line.trim()
        if (!t) return true
        return !INTERNAL_LINE_PATTERNS.some(p => p.test(t))
      })
      .join('\n')
      .trim()
  }

  if (toolName !== 'web_search' && toolName !== 'execute_command' && toolName !== 'ask_user') {
    if (rawResult.includes('暂未实现具体执行逻辑')) {
      return `已调用技能「${toolName}」。`
    }
  }

  return out
}

export function isToolCallLikeText(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return TEXT_TOOL_CALL_PATTERNS.some(p => p.test(t)) || TOOL_MARKER_RE.test(t)
}
