import { createHash } from 'node:crypto'

const bearerTokenPattern = /^Bearer\s+(.+)$/i

export const hashApiKeySecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex')

export const parseBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader) {
    return null
  }

  const match = authorizationHeader.match(bearerTokenPattern)

  if (!match) {
    return null
  }

  const token = match[1]?.trim()

  return token ? token : null
}
