import { readFile } from 'node:fs/promises'
import matter from 'gray-matter'
import { z } from 'zod'
import type { DomainError } from '../../../shared/errors'
import { err, ok, type Result } from '../../../shared/result'
import { isGardenReservedRoot, normalizeGardenRelativePath } from './resolve-source-path'
import type { GardenSourceConfig, GardenSourceScopeResolution } from './types'

const DEFAULT_PAGE_SIZE = 20

export interface LoadedGardenSourceConfig {
  config: GardenSourceConfig
  source: string
}

const navigationItemSchema = z.strictObject({
  label: z.string().trim().min(1),
  path: z.string().trim().min(1),
})

const sectionSchema = z.strictObject({
  description: z.string().trim().min(1).optional(),
  order: z.number().int().optional(),
  title: z.string().trim().min(1).optional(),
})

const sourceConfigSchema = z.strictObject({
  description: z.string().trim().min(1).optional(),
  home: z.string().trim().min(1).optional(),
  image: z.string().trim().min(1).optional(),
  listing: z
    .strictObject({
      default_page_size: z.number().int().positive().max(500).optional(),
    })
    .optional(),
  navigation: z.array(navigationItemSchema).optional(),
  noindex: z.boolean().optional(),
  public: z.strictObject({
    exclude: z.array(z.string().trim().min(1)).optional(),
    roots: z.array(z.string().trim().min(1)).min(1),
  }),
  schema: z.literal('garden/v1'),
  sections: z.record(z.string(), sectionSchema).optional(),
  theme: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  twitter: z.string().trim().min(1).optional(),
})

const pathShadows = (existingPath: string, candidatePath: string): boolean => {
  if (existingPath === '.' || existingPath === candidatePath) {
    return true
  }

  if (existingPath.endsWith('.md')) {
    return false
  }

  return (
    candidatePath === `${existingPath}.md` ||
    candidatePath === `${existingPath}/index.md` ||
    candidatePath.startsWith(`${existingPath}/`)
  )
}

const dedupeNormalizedPaths = (paths: readonly string[]): string[] => {
  const sorted = [...paths].sort(
    (left, right) => left.length - right.length || left.localeCompare(right),
  )
  const deduped: string[] = []

  for (const candidate of sorted) {
    if (deduped.some((existing) => pathShadows(existing, candidate))) {
      continue
    }

    deduped.push(candidate)
  }

  return deduped
}

const parseGardenYamlConfig = (
  source: string,
): Result<z.infer<typeof sourceConfigSchema>, DomainError> => {
  try {
    const wrapped = `---\n${source.trimEnd()}\n---\n`
    const parsed = matter(wrapped).data
    const validated = sourceConfigSchema.safeParse(parsed)

    if (!validated.success) {
      return err({
        message: validated.error.issues.map((issue) => issue.message).join('; '),
        type: 'validation',
      })
    }

    return ok(validated.data)
  } catch (error) {
    return err({
      message: `failed to parse _garden.yml: ${error instanceof Error ? error.message : 'Unknown parse failure'}`,
      type: 'validation',
    })
  }
}

const normalizePathList = (
  values: readonly string[],
  label: string,
): Result<string[], DomainError> => {
  const normalizedValues: string[] = []

  for (const value of values) {
    const normalized = normalizeGardenRelativePath(value, label)

    if (!normalized.ok) {
      return normalized
    }

    normalizedValues.push(normalized.value)
  }

  return ok(dedupeNormalizedPaths(normalizedValues))
}

export const loadGardenSourceConfig = async (
  source: GardenSourceScopeResolution,
): Promise<Result<LoadedGardenSourceConfig, DomainError>> => {
  let fileContents: string
  try {
    fileContents = await readFile(source.configRef, 'utf8')
  } catch {
    return err({
      message: `_garden.yml was not found at ${source.configRef}`,
      type: 'not_found',
    })
  }

  const parsed = parseGardenYamlConfig(fileContents)

  if (!parsed.ok) {
    return parsed
  }

  const normalizedRoots = normalizePathList(parsed.value.public.roots, 'public.roots entry')

  if (!normalizedRoots.ok) {
    return normalizedRoots
  }

  if (normalizedRoots.value.some((root) => isGardenReservedRoot(root))) {
    return err({
      message: 'public.roots must not include _meta, attachments, public, or system paths',
      type: 'validation',
    })
  }

  const normalizedExclude = normalizePathList(
    parsed.value.public.exclude ?? [],
    'public.exclude entry',
  )

  if (!normalizedExclude.ok) {
    return normalizedExclude
  }

  return ok({
    config: {
      description: parsed.value.description,
      home: parsed.value.home,
      image: parsed.value.image,
      listing: {
        defaultPageSize: parsed.value.listing?.default_page_size ?? DEFAULT_PAGE_SIZE,
      },
      navigation: parsed.value.navigation ?? [],
      noindex: parsed.value.noindex,
      public: {
        exclude: normalizedExclude.value,
        roots: normalizedRoots.value,
      },
      schema: parsed.value.schema,
      sections: parsed.value.sections ?? {},
      theme: parsed.value.theme,
      title: parsed.value.title,
      twitter: parsed.value.twitter,
    },
    source: fileContents,
  })
}
