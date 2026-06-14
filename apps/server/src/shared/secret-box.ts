import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export interface EncryptedSecret {
  algorithm: 'aes-256-gcm'
  ciphertext: string
  iv: string
  tag: string
  version: 1
}

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const ENCRYPTION_IV_BYTES = 12

const deriveKey = (secret: string): Buffer => createHash('sha256').update(secret, 'utf8').digest()

export const isEncryptedSecret = (value: unknown): value is EncryptedSecret =>
  typeof value === 'object' &&
  value !== null &&
  'algorithm' in value &&
  value.algorithm === ENCRYPTION_ALGORITHM &&
  'ciphertext' in value &&
  typeof value.ciphertext === 'string' &&
  'iv' in value &&
  typeof value.iv === 'string' &&
  'tag' in value &&
  typeof value.tag === 'string' &&
  'version' in value &&
  value.version === 1

export const createSecretBox = (secret: string) => {
  const key = deriveKey(secret)

  return {
    decryptString: (value: EncryptedSecret): string => {
      const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(value.iv, 'base64'))

      decipher.setAuthTag(Buffer.from(value.tag, 'base64'))

      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ])

      return plaintext.toString('utf8')
    },
    encryptString: (value: string): EncryptedSecret => {
      const iv = randomBytes(ENCRYPTION_IV_BYTES)
      const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(value, 'utf8')), cipher.final()])

      return {
        algorithm: ENCRYPTION_ALGORITHM,
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        version: 1,
      }
    },
  }
}
