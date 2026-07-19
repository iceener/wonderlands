import { z } from 'zod'
import type { DomainError } from '../../shared/errors'
import { err, ok, type Result } from '../../shared/result'

const gardenSiteSlugPattern = /^[a-z0-9][a-z0-9_-]*$/

const gardenSiteSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    gardenSiteSlugPattern,
    'must be a lowercase slug using letters, numbers, underscores, or hyphens',
  )

const createGardenSiteInputSchema = z.object({
  buildMode: z.enum(['manual', 'debounced_scan']).optional(),
  deployMode: z.enum(['api_hosted', 'github_pages']).optional(),
  isDefault: z.boolean().optional(),
  name: z.string().trim().min(1).max(200),
  protectedAccessMode: z.enum(['none', 'site_password']).optional(),
  protectedSecretRef: z.string().trim().min(1).max(500).nullable().optional(),
  protectedSessionTtlSeconds: z.number().int().positive().max(31_536_000).optional(),
  slug: gardenSiteSlugSchema,
  sourceScopePath: z.string().trim().min(1).max(500).optional(),
  status: z.enum(['draft', 'active', 'disabled', 'archived']).optional(),
})

const updateGardenSiteInputSchema = z
  .object({
    buildMode: z.enum(['manual', 'debounced_scan']).optional(),
    deployMode: z.enum(['api_hosted', 'github_pages']).optional(),
    isDefault: z.boolean().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    protectedAccessMode: z.enum(['none', 'site_password']).optional(),
    protectedSecretRef: z.string().trim().min(1).max(500).nullable().optional(),
    protectedSessionTtlSeconds: z.number().int().positive().max(31_536_000).optional(),
    slug: gardenSiteSlugSchema.optional(),
    sourceScopePath: z.string().trim().min(1).max(500).optional(),
    status: z.enum(['draft', 'active', 'disabled', 'archived']).optional(),
  })
  .refine(
    (value) =>
      value.buildMode !== undefined ||
      value.deployMode !== undefined ||
      value.isDefault !== undefined ||
      value.name !== undefined ||
      value.protectedAccessMode !== undefined ||
      value.protectedSecretRef !== undefined ||
      value.protectedSessionTtlSeconds !== undefined ||
      value.slug !== undefined ||
      value.sourceScopePath !== undefined ||
      value.status !== undefined,
    {
      message: 'At least one garden site field must be provided.',
    },
  )

const requestGardenBuildInputSchema = z.object({
  triggerKind: z.enum(['manual', 'republish']).optional(),
})

export type CreateGardenSiteInput = z.infer<typeof createGardenSiteInputSchema>
export type UpdateGardenSiteInput = z.infer<typeof updateGardenSiteInputSchema>
export type RequestGardenBuildInput = z.infer<typeof requestGardenBuildInputSchema>

const formatZodError = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('; ')

const parseWithSchema = <TValue>(
  schema: z.ZodType<TValue>,
  input: unknown,
): Result<TValue, DomainError> => {
  const parsed = schema.safeParse(input)

  if (!parsed.success) {
    return err({
      message: formatZodError(parsed.error),
      type: 'validation',
    })
  }

  return ok(parsed.data)
}

export const parseCreateGardenSiteInput = (
  input: unknown,
): Result<CreateGardenSiteInput, DomainError> => parseWithSchema(createGardenSiteInputSchema, input)

export const parseUpdateGardenSiteInput = (
  input: unknown,
): Result<UpdateGardenSiteInput, DomainError> => parseWithSchema(updateGardenSiteInputSchema, input)

export const parseRequestGardenBuildInput = (
  input: unknown,
): Result<RequestGardenBuildInput, DomainError> =>
  parseWithSchema(requestGardenBuildInputSchema, input)
