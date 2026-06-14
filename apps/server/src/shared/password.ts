import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const passwordHashPrefix = 'scrypt_v1'
const passwordKeyLength = 64

const toBuffer = (value: string): Buffer => Buffer.from(value, 'hex')

export const normalizeAuthEmail = (value: string): string => value.trim().toLowerCase()

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, passwordKeyLength).toString('hex')

  return `${passwordHashPrefix}$${salt}$${hash}`
}

export const verifyPassword = (password: string, encodedHash: string): boolean => {
  const [scheme, salt, expectedHash] = encodedHash.split('$')

  if (scheme !== passwordHashPrefix || !salt || !expectedHash) {
    return false
  }

  const candidate = scryptSync(password, salt, passwordKeyLength)
  const expected = toBuffer(expectedHash)

  if (candidate.byteLength !== expected.byteLength) {
    return false
  }

  return timingSafeEqual(candidate, expected)
}
