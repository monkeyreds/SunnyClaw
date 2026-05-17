import type { ToolDefinition } from '../types.js'

export const executeCommandDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'execute_command',
    description: '在本地系统上执行 Shell 命令并返回输出结果。可以用来运行任何命令行工具、脚本或程序。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的 Shell 命令。须符合当前操作系统语法（Windows 用 cmd/dir/where，Unix 用 bash/ls/which）。'
        }
      },
      required: ['command']
    }
  }
}

export const askUserDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_user',
    description: '当需要向用户提问以澄清需求、确认选项或补充缺失信息时使用。禁止在普通回复文本中直接向用户提问，必须通过此工具发起询问。',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '要向用户提出的具体问题'
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '可选的快捷选项（如有），用户可点击选择'
        }
      },
      required: ['question']
    }
  }
}

export const webSearchDef: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '使用百度搜索引擎搜索互联网，返回直达摘要与多条结果的标题、摘要。搜索后需结合返回的摘要内容回答用户，勿仅转述链接。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词'
        }
      },
      required: ['query']
    }
  }
}

export function buildToolDefinitions(enableSearch: boolean, customSkills: Array<{ name: string; description: string; parameters: { type: string; properties: Record<string, unknown>; required: string[] } }>): ToolDefinition[] {
  const tools: ToolDefinition[] = [executeCommandDef, askUserDef]
  if (enableSearch) {
    tools.push(webSearchDef)
  }
  for (const skill of customSkills) {
    tools.push({
      type: 'function',
      function: {
        name: skill.name,
        description: skill.description,
        parameters: skill.parameters as ToolDefinition['function']['parameters']
      }
    })
  }
  return tools
}
