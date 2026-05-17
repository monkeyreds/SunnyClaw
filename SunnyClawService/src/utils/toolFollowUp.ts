const DEFERRED_ACTION_RE =
  /稍等|请稍|将执行|我会执行|我来执行|马上执行|即将|正在为您|需要执行|执行一些|运行命令|执行命令|弹窗授权|调用工具|使用工具|我将|我会帮你|可以帮助你检查/i

const USER_WANTS_ACTION_RE =
  /查|检查|执行|运行|安装|版本|几个|多少|列出|查看|有没有|是否存在|路径|目录|文件|node|python|java|npm|git|磁盘|内存|cpu|进程|时间|天气|几点|何时|什么时候|日期|星期|预报|温度/i

export const TOOL_ACTION_NUDGE =
  '【系统】你刚才只回复了文字说明，没有实际调用 execute_command 或 web_search 工具。请立即调用相应工具执行命令或搜索，根据真实输出回答用户。禁止再说「稍等」「将执行」等空话，不要重复已说过的话。'

export function userExpectsToolAction(userContent: string): boolean {
  return USER_WANTS_ACTION_RE.test(userContent)
}

export function assistantShowsCommandWithoutRunning(assistantContent: string): boolean {
  return /```[\s\S]*?(python|node|npm|pip)\s+--version[\s\S]*?```/i.test(assistantContent)
}

export function assistantDeferredWithoutAction(assistantContent: string): boolean {
  const text = assistantContent.trim()
  if (!text) return true
  if (DEFERRED_ACTION_RE.test(text)) return true
  if (assistantShowsCommandWithoutRunning(text)) return true
  if (/execute_command|web_search|<\/?tools>|ronics\s*>/i.test(text)) return true
  return false
}

export function shouldNudgeToolExecution(userContent: string, assistantContent: string): boolean {
  if (!userExpectsToolAction(userContent)) return false
  return assistantDeferredWithoutAction(assistantContent)
}

export function getLastUserContent(messages: Array<{ role: string; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content
  }
  return ''
}

const CASUAL_GREETING_RE =
  /^(你好|您好|嗨|hello|hi|hey|谢谢|感谢|再见|拜拜|早上好|晚上好|在吗|你是谁|介绍一下自己?)[\s!?。，~、]*$/i

/** 日常寒暄不需要挂工具，避免小模型在 tool 模式下长时间无输出 */
export function isCasualConversation(content: string): boolean {
  const t = content.trim()
  if (!t) return false
  if (userExpectsToolAction(t)) return false
  if (CASUAL_GREETING_RE.test(t)) return true
  if (t.length <= 16) return true
  return false
}
