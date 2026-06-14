import { createHash, randomBytes } from 'node:crypto'

export const createAuthSessionSecret = (): string => `ats_${randomBytes(24).toString('hex')}`

export const hashAuthSessionSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex')
