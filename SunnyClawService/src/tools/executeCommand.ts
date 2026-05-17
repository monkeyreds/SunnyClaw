import { exec } from 'child_process'
import { platform } from 'os'

export async function executeCommand(command: string): Promise<string> {
  const trimmed = command.trim()
  if (!trimmed) {
    return 'Error: empty command'
  }

  const isWin = platform() === 'win32'

  return new Promise((resolve) => {
    exec(
      trimmed,
      {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        shell: isWin ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash',
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      },
      (error, stdout, stderr) => {
        let result = ''
        if (stdout) result += stdout
        if (stderr) result += (result ? '\n' : '') + stderr
        if (error) {
          const errMsg = error.killed
            ? 'Command timed out after 30 seconds'
            : `Exit code ${error.code ?? 'unknown'}: ${error.message}`
          result += (result ? '\n' : '') + errMsg
        }
        resolve(result.trim() || 'Command completed with no output.')
      }
    )
  })
}
