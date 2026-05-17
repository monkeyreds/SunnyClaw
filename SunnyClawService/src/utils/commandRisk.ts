/** Classify shell commands as high-risk (require user approval) or low-risk (auto-run). */

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\brmdir\b/i,
  /\brm\s+(-[a-z]*r|-[a-z]*f|\S)/i,
  /\bdel\b/i,
  /\berase\b/i,
  /\bremove-item\b/i,
  /\bri\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\brestart\b/i,
  /\breboot\b/i,
  /\bkill\b/i,
  /\btaskkill\b/i,
  /\bstop-process\b/i,
  /\bdd\b/i,
  /\bmkfs\b/i,
  /\bdiskpart\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\breg\s+delete/i,
  /\bnet\s+user\b/i,
  /\bInvoke-Expression\b/i,
  /\biex\b/i
]

export function isHighRiskCommand(command: string): boolean {
  const cmd = command.trim()
  if (!cmd) return false

  const segments = cmd.split(/&&|\|\||;/).map(s => s.trim()).filter(Boolean)
  const toCheck = segments.length > 0 ? segments : [cmd]

  for (const seg of toCheck) {
    if (HIGH_RISK_PATTERNS.some(p => p.test(seg))) {
      return true
    }
  }

  if (/>\s*[\w:\\/.-]+/i.test(cmd) && !/^\s*echo\s+/i.test(cmd)) {
    return true
  }

  return false
}
