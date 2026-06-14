import type { z } from 'zod'

export const toZodErrorMessage = (error: z.ZodError): string =>
  error.issues.map((issue) => issue.message).join('; ')
