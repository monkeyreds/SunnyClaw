/** Strip internal LLM instructions from tool output before sending to the frontend. */

const INTERNAL_LINE_PATTERNS = [
  /^请根据[\s\S]*$/,
  /^请勿[\s\S]*$/,
  /^必须[\s\S]*$/,
  /^禁止[\s\S]*$/,
  /^该技能暂未实现[\s\S]*$/,
  /^请根据描述自行处理[。.]?$/
]

function stripTrailingInstructionBlock(text: string): string {
  return text.replace(/\n---\n[\s\S]*$/m, '').trim()
}

function stripInternalLines(text: string): string {
  const lines = text.split('\n')
  const kept = lines.filter(line => {
    const t = line.trim()
    if (!t) return true
    return !INTERNAL_LINE_PATTERNS.some(p => p.test(t))
  })
  return kept.join('\n').trim()
}

export function formatToolResultForDisplay(toolName: string, rawResult: string): string {
  if (!rawResult) return ''

  switch (toolName) {
    case 'web_search': {
      let out = stripTrailingInstructionBlock(rawResult)
      out = stripInternalLines(out)
      return out
    }
    case 'ask_user':
      return rawResult
    case 'execute_command':
      return rawResult
    default:
      if (rawResult.includes('暂未实现具体执行逻辑')) {
        return `已调用技能「${toolName}」。`
      }
      return stripInternalLines(stripTrailingInstructionBlock(rawResult))
  }
}
