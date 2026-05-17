import type { OllamaMessage, ToolDefinition } from '../types.js'

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434'
const PREFERRED_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct'
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 120_000
const OLLAMA_IDLE_TIMEOUT_MS = Number(process.env.OLLAMA_IDLE_TIMEOUT_MS) || 90_000

let resolvedModelCache: string | null = null

/** Resolve installed model when OLLAMA_MODEL is missing or only a partial tag match. */
export async function resolveChatModel(): Promise<string> {
  if (resolvedModelCache) return resolvedModelCache

  const preferred = PREFERRED_MODEL
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`)
    if (!res.ok) {
      resolvedModelCache = preferred
      return preferred
    }
    const data = (await res.json()) as { models?: { name: string }[] }
    const names = data.models?.map(m => m.name) ?? []
    if (names.length === 0) {
      resolvedModelCache = preferred
      return preferred
    }
    if (names.includes(preferred)) {
      resolvedModelCache = preferred
      return preferred
    }
    const variant = names.find(
      n => n.startsWith(`${preferred}-`) || n.startsWith(`${preferred}:`)
    )
    if (variant) {
      console.warn(`[ollama] 模型 "${preferred}" 未安装，自动使用 "${variant}"`)
      resolvedModelCache = variant
      return variant
    }
    const colon = preferred.indexOf(':')
    if (colon > 0) {
      const family = preferred.slice(0, colon + 1)
      const byFamily = names.find(n => n.startsWith(family))
      if (byFamily) {
        console.warn(`[ollama] 模型 "${preferred}" 未安装，自动使用 "${byFamily}"`)
        resolvedModelCache = byFamily
        return byFamily
      }
    }
    if (names.length === 1) {
      console.warn(`[ollama] 模型 "${preferred}" 未安装，自动使用 "${names[0]}"`)
      resolvedModelCache = names[0]
      return names[0]
    }
  } catch {
    // Ollama unreachable; fall through to preferred name for a clear API error later
  }

  resolvedModelCache = preferred
  return preferred
}

export interface OllamaStreamChunk {
  message: {
    role: string
    content: string
    tool_calls?: {
      function: {
        name: string
        arguments: Record<string, unknown> | string
      }
    }[]
  }
  done: boolean
}

function mergeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const active = signals.filter((s): s is AbortSignal => Boolean(s))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(active)
  }
  const controller = new AbortController()
  for (const sig of active) {
    if (sig.aborted) {
      controller.abort()
      return controller.signal
    }
    sig.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}

function parseToolArguments(raw: Record<string, unknown> | string): Record<string, unknown> | null {
  if (typeof raw === 'object' && raw !== null) return raw
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export function extractToolCallsFromChunk(
  chunk: OllamaStreamChunk
): OllamaMessage['tool_calls'] | undefined {
  const raw = chunk.message?.tool_calls
  if (!raw?.length) return undefined

  const parsed = raw
    .map(tc => {
      const args = parseToolArguments(tc.function.arguments)
      if (!tc.function.name || !args) return null
      return { function: { name: tc.function.name, arguments: args } }
    })
    .filter((tc): tc is NonNullable<typeof tc> => tc !== null)

  return parsed.length > 0 ? parsed : undefined
}

async function readWithIdleTimeout<T>(
  read: () => Promise<T>,
  idleMs: number,
  signal?: AbortSignal,
  onIdle?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onAbort = () => {
      finish(() => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => {
      onIdle?.()
      finish(() =>
        reject(
          new Error(
            `Ollama 流式响应超过 ${idleMs / 1000} 秒无数据，请确认模型「${PREFERRED_MODEL}」已安装（ollama list）且名称与 OLLAMA_MODEL 一致。`
          )
        )
      )
    }, idleMs)

    read()
      .then(value => finish(() => resolve(value)))
      .catch(err => finish(() => reject(err)))
  })
}

export async function* streamChat(
  messages: OllamaMessage[],
  tools: ToolDefinition[],
  model?: string,
  signal?: AbortSignal
): AsyncGenerator<OllamaStreamChunk> {
  const activeModel = model ?? (await resolveChatModel())
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), OLLAMA_TIMEOUT_MS)
  const combinedSignal = mergeAbortSignals(signal, timeoutController.signal)

  let response: Response
  try {
    response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: activeModel,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true
      }),
      signal: combinedSignal
    })
  } catch (err) {
    clearTimeout(timeoutId)
    if (timeoutController.signal.aborted && !signal?.aborted) {
      throw new Error(`Ollama 请求超时（${OLLAMA_TIMEOUT_MS / 1000} 秒），请检查模型是否已加载或尝试换用更小/更快的模型。`)
    }
    throw err
  }

  if (!response.ok) {
    clearTimeout(timeoutId)
    const text = await response.text()
    let hint = ''
    if (response.status === 404) {
      hint = ` 请运行 ollama pull ${activeModel} 或设置环境变量 OLLAMA_MODEL 为已安装的模型名。`
    }
    throw new Error(`Ollama API error: ${response.status} - ${text}${hint}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (combinedSignal?.aborted) {
        await reader.cancel().catch(() => {})
        return
      }
      const { done, value } = await readWithIdleTimeout(
        () => reader.read(),
        OLLAMA_IDLE_TIMEOUT_MS,
        combinedSignal,
        () => reader.cancel().catch(() => {})
      )
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          yield JSON.parse(trimmed)
        } catch {
          // skip malformed lines
        }
      }
    }

    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim())
      } catch {
        // skip
      }
    }
  } finally {
    clearTimeout(timeoutId)
  }
}
