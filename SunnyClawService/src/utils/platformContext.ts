import { arch, platform, release } from 'os'

export function getPlatformContext(): string {
  const p = platform()
  const rel = release()
  const a = arch()

  if (p === 'win32') {
    return [
      `当前运行环境：Windows ${rel} (${a})。`,
      '执行命令时必须使用 Windows/cmd 语法，例如：',
      '- 列目录：dir（不要用 ls，除非明确在 Git Bash/WSL 中）',
      '- 查找可执行文件：where node',
      '- 查看版本：node --version、python --version',
      '- 环境变量：%PATH%、%USERPROFILE%',
      '- 多版本 Node：where node；若安装了 nvm-windows 可用 nvm list',
      '禁止默认使用 bash 专属命令（ls、which、export 等），除非用户明确要求或在 WSL 内操作。'
    ].join('\n')
  }

  if (p === 'darwin') {
    return [
      `当前运行环境：macOS ${rel} (${a})。`,
      '使用 Unix/macOS shell 语法：ls、which、export、brew 等。',
      '查看 Node 版本：node --version；多个安装路径：which -a node；nvm：nvm ls。'
    ].join('\n')
  }

  return [
    `当前运行环境：Linux ${rel} (${a})。`,
    '使用 Unix shell 语法：ls、which、export 等。',
    '查看 Node 版本：node --version；多个路径：which -a node；nvm：nvm ls。'
  ].join('\n')
}

/** Default shell command when the model mentions execute_command but omits arguments (e.g. time queries). */
export function getDefaultTimeCommand(): string {
  const p = platform()
  if (p === 'win32') {
    return 'powershell -NoProfile -Command "Get-Date -Format \\"yyyy-MM-dd HH:mm:ss\\""'
  }
  if (p === 'darwin') {
    return 'date "+%Y-%m-%d %H:%M:%S"'
  }
  return 'date "+%Y-%m-%d %H:%M:%S"'
}

export function userAsksForCurrentTime(userContent: string): boolean {
  return /几点|什么时间|什么时候|现在.*时间|当前时间|今日|日期|星期|几号|何时/i.test(userContent)
}
