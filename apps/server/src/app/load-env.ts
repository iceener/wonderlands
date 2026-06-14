import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_ENV_PATH = resolve(process.cwd(), '.env')
const ENV_LINE_PATTERN = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)\s*$/

const normalizeValue = (rawValue: string): string => {
  const trimmed = rawValue.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

export const loadEnvFileIntoProcess = (filePath = DEFAULT_ENV_PATH): void => {
  if (!existsSync(filePath)) {
    return
  }

  const source = readFileSync(filePath, 'utf8')

  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const match = ENV_LINE_PATTERN.exec(line)
    if (!match) {
      continue
    }

    const key = match[1]
    const rawValue = match[2]

    if (typeof key !== 'string' || typeof rawValue !== 'string' || process.env[key] !== undefined) {
      continue
    }

    process.env[key] = normalizeValue(rawValue)
  }
}
