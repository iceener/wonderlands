import matter from 'gray-matter'
import type { z } from 'zod'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'
import { toTypedFrontmatter } from './agent-markdown/frontmatter-decode'
import { toAgentMarkdownFrontmatterJson } from './agent-markdown/frontmatter-encode'
import { rawAgentMarkdownFrontmatterSchema } from './agent-markdown/frontmatter-schema'
import type { AgentMarkdownDocument, AgentMarkdownFrontmatter } from './agent-markdown/types'

export { toAgentMarkdownFrontmatterJson } from './agent-markdown/frontmatter-encode'
export type { RawAgentMarkdownFrontmatter } from './agent-markdown/frontmatter-schema'
export type {
  AgentMarkdownDocument,
  AgentMarkdownFrontmatter,
  AgentMarkdownSubagent,
} from './agent-markdown/types'

const frontmatterFence = '---'

const toValidationError = (message: string): Result<never, DomainError> =>
  err({
    message,
    type: 'validation',
  })

const normalizeNewlines = (value: string): string => value.replace(/\r\n?/g, '\n')

const normalizeInstructionsMd = (value: string): string => normalizeNewlines(value).trim()

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''

      return `${path}${issue.message}`
    })
    .join('; ')

const parseFrontmatterJson = (value: unknown): Result<AgentMarkdownFrontmatter, DomainError> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return toValidationError('agent frontmatter must be a YAML object')
  }

  const parsed = rawAgentMarkdownFrontmatterSchema.safeParse(value)

  if (!parsed.success) {
    return toValidationError(formatZodError(parsed.error))
  }

  return ok(toTypedFrontmatter(parsed.data))
}

export const parseAgentMarkdown = (
  markdown: string,
): Result<AgentMarkdownDocument, DomainError> => {
  const normalized = normalizeNewlines(markdown)

  if (!normalized.startsWith(`${frontmatterFence}\n`)) {
    return toValidationError('agent markdown must start with frontmatter delimited by ---')
  }

  let parsedMatter: matter.GrayMatterFile<string>

  try {
    parsedMatter = matter(normalized)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown frontmatter parse failure'

    return toValidationError(`invalid agent frontmatter: ${message}`)
  }

  if (Object.keys(parsedMatter.data ?? {}).length === 0) {
    return toValidationError('agent markdown frontmatter cannot be empty')
  }

  const rawTools =
    parsedMatter.data &&
    typeof parsedMatter.data === 'object' &&
    !Array.isArray(parsedMatter.data) &&
    parsedMatter.data.tools &&
    typeof parsedMatter.data.tools === 'object' &&
    !Array.isArray(parsedMatter.data.tools)
      ? (parsedMatter.data.tools as Record<string, unknown>)
      : null

  if (rawTools && rawTools.mcp_profile !== undefined) {
    return toValidationError('tools.mcp_profile is no longer supported; use tools.tool_profile_id')
  }

  const frontmatter = parseFrontmatterJson(parsedMatter.data)

  if (!frontmatter.ok) {
    return frontmatter
  }

  const instructionsMd = normalizeInstructionsMd(parsedMatter.content)

  if (instructionsMd.length === 0) {
    return toValidationError('agent markdown body cannot be empty')
  }

  return ok({
    frontmatter: frontmatter.value,
    instructionsMd,
  })
}

export const parseStoredAgentFrontmatter = (
  value: Record<string, unknown>,
): Result<AgentMarkdownFrontmatter, DomainError> => parseFrontmatterJson(value)

export const serializeAgentMarkdown = (document: AgentMarkdownDocument): string => {
  const frontmatterJson = toAgentMarkdownFrontmatterJson(document.frontmatter)
  const serialized = matter.stringify(
    normalizeInstructionsMd(document.instructionsMd),
    frontmatterJson,
    {
      delimiters: frontmatterFence,
      language: 'yaml',
    },
  )

  return `${normalizeNewlines(serialized).trimEnd()}\n`
}
