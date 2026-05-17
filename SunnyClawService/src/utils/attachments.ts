export interface MessageAttachment {
  name: string
  mimeType: string
  data: string
}

const TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/javascript',
  'text/html',
  'text/xml',
  'application/xml'
])

const TEXT_EXTENSIONS = /\.(txt|md|json|js|ts|tsx|jsx|css|html|xml|csv|log|yaml|yml|py|java|go|rs|c|cpp|h|sh|ps1|bat)$/i

export function buildAttachmentContext(attachments: MessageAttachment[]): string {
  if (!attachments.length) return ''

  const parts: string[] = ['\n\n--- 用户上传的附件 ---']
  for (const file of attachments) {
    const isText =
      TEXT_MIMES.has(file.mimeType) ||
      TEXT_EXTENSIONS.test(file.name) ||
      file.mimeType.startsWith('text/')

    if (isText) {
      try {
        const text = Buffer.from(file.data, 'base64').toString('utf-8')
        const clipped = text.length > 12000 ? text.slice(0, 12000) + '\n...(已截断)' : text
        parts.push(`\n【文件: ${file.name}】\n\`\`\`\n${clipped}\n\`\`\``)
      } catch {
        parts.push(`\n【文件: ${file.name}】（无法解码文本内容）`)
      }
    } else {
      const sizeKb = Math.round((Buffer.from(file.data, 'base64').length || 0) / 1024)
      parts.push(`\n【文件: ${file.name}】类型: ${file.mimeType || '未知'}, 大小约 ${sizeKb} KB（非文本文件，已记录文件名）`)
    }
  }
  parts.push('\n--- 附件结束 ---\n')
  return parts.join('')
}
