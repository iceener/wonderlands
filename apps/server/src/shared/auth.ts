import type { ApiKeyId, AuthSessionId } from './ids'

export const authMethodValues = ['api_key', 'auth_session'] as const
export const authSessionStatusValues = ['active', 'revoked', 'expired'] as const

export type AuthMethod = (typeof authMethodValues)[number]
export type AuthSessionStatus = (typeof authSessionStatusValues)[number]

export type RequestAuthContext =
  | {
      apiKeyId: ApiKeyId
      method: 'api_key'
    }
  | {
      authSessionId: AuthSessionId
      expiresAt: string
      method: 'auth_session'
    }
