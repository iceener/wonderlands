import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { verifyPassword } from '../../shared/password'

const gardenPasswordHashPrefix = 'scrypt_v1$'

const toStableSecretKey = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest()

const toCookiePayload = (input: { buildId: string; expiresAt: number; siteId: string }): string =>
  `${input.siteId}:${input.buildId}:${input.expiresAt}`

const signCookiePayload = (input: {
  buildId: string
  expiresAt: number
  secretMaterial: string
  siteId: string
}): string =>
  createHmac('sha256', toStableSecretKey(input.secretMaterial))
    .update(
      toCookiePayload({
        buildId: input.buildId,
        expiresAt: input.expiresAt,
        siteId: input.siteId,
      }),
    )
    .digest('hex')

const secureCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')

  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

export const createGardenUnlockCookieValue = (input: {
  buildId: string
  expiresAt: number
  secretMaterial: string
  siteId: string
}): string =>
  `${input.expiresAt}.${signCookiePayload({
    buildId: input.buildId,
    expiresAt: input.expiresAt,
    secretMaterial: input.secretMaterial,
    siteId: input.siteId,
  })}`

export const verifyGardenUnlockCookieValue = (input: {
  buildId: string
  cookieValue: string
  nowMs: number
  secretMaterial: string
  siteId: string
}): boolean => {
  const [expiresAtRaw, signature] = input.cookieValue.split('.', 2)
  const expiresAt = Number.parseInt(expiresAtRaw ?? '', 10)

  if (!Number.isInteger(expiresAt) || expiresAt <= input.nowMs || !signature) {
    return false
  }

  const expectedSignature = signCookiePayload({
    buildId: input.buildId,
    expiresAt,
    secretMaterial: input.secretMaterial,
    siteId: input.siteId,
  })

  return secureCompare(signature, expectedSignature)
}

export const verifyGardenProtectedPassword = (
  candidate: string,
  secretMaterial: string,
): boolean => {
  if (secretMaterial.startsWith(gardenPasswordHashPrefix)) {
    return verifyPassword(candidate, secretMaterial)
  }

  return secureCompare(candidate, secretMaterial)
}
