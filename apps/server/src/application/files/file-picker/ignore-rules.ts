import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeSeparators } from './path-utils'

export interface IgnoreRule {
  basePath: string
  basenameOnly: boolean
  directoryOnly: boolean
  negated: boolean
  pattern: RegExp
}

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')

const globToRegex = (pattern: string): RegExp => {
  let output = '^'

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    const nextCharacter = pattern[index + 1]

    if (character === '*' && nextCharacter === '*') {
      output += '.*'
      index += 1
      continue
    }

    if (character === '*') {
      output += '[^/]*'
      continue
    }

    if (character === '?') {
      output += '[^/]'
      continue
    }

    output += escapeRegex(character)
  }

  output += '$'
  return new RegExp(output)
}

export const compileIgnoreRule = (basePath: string, line: string): IgnoreRule | null => {
  const trimmed = line.trim()

  if (!trimmed || trimmed.startsWith('#')) {
    return null
  }

  const negated = trimmed.startsWith('!')
  let patternSource = negated ? trimmed.slice(1).trim() : trimmed

  if (!patternSource) {
    return null
  }

  const directoryOnly = patternSource.endsWith('/')
  if (directoryOnly) {
    patternSource = patternSource.slice(0, -1)
  }

  const anchored = patternSource.startsWith('/')
  if (anchored) {
    patternSource = patternSource.slice(1)
  }

  const basenameOnly = !patternSource.includes('/')
  const scopedPattern = basenameOnly
    ? patternSource
    : normalizeSeparators(
        basePath
          ? anchored
            ? join(basePath, patternSource)
            : join(basePath, patternSource)
          : patternSource,
      )

  return {
    basePath: normalizeSeparators(basePath),
    basenameOnly,
    directoryOnly,
    negated,
    pattern: globToRegex(scopedPattern),
  }
}

const matchIgnoreRule = (
  rule: IgnoreRule,
  relativePath: string,
  name: string,
  isDirectory: boolean,
): boolean => {
  if (rule.directoryOnly && !isDirectory) {
    return false
  }

  if (rule.basenameOnly) {
    if (
      rule.basePath &&
      relativePath !== rule.basePath &&
      !relativePath.startsWith(`${rule.basePath}/`)
    ) {
      return false
    }

    return rule.pattern.test(name)
  }

  return rule.pattern.test(relativePath)
}

export const isIgnored = (
  rules: readonly IgnoreRule[],
  relativePath: string,
  name: string,
  isDirectory: boolean,
): boolean => {
  let ignored = false

  for (const rule of rules) {
    if (matchIgnoreRule(rule, relativePath, name, isDirectory)) {
      ignored = !rule.negated
    }
  }

  return ignored
}

export const readIgnoreRules = async (
  directoryPath: string,
  basePath: string,
): Promise<IgnoreRule[]> => {
  const ruleFiles = ['.gitignore', '.cursorignore']
  const rules: IgnoreRule[] = []

  for (const fileName of ruleFiles) {
    const filePath = join(directoryPath, fileName)
    const content = await readFile(filePath, 'utf8').catch(() => null)

    if (!content) {
      continue
    }

    for (const line of content.split(/\r?\n/)) {
      const compiled = compileIgnoreRule(basePath, line)

      if (compiled) {
        rules.push(compiled)
      }
    }
  }

  return rules
}
