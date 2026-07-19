export type ContextSecuritySurface = 'manifest' | 'provider_context'

export type ContextSecurityFindingKind =
  | 'account_field'
  | 'credential_field'
  | 'data_url'
  | 'encrypted_payload'
  | 'file_body'

export interface ContextSecurityFinding {
  key: string | null
  kind: ContextSecurityFindingKind
  path: string
}

const exactCredentialKeys = new Set([
  'accesstoken',
  'authorization',
  'clientsecret',
  'codeverifier',
  'cookie',
  'cookies',
  'idtoken',
  'oauthaccesstoken',
  'oauthtoken',
  'password',
  'passphrase',
  'proxyauthorization',
  'refreshtoken',
  'setcookie',
  'storagekey',
  'xapikey',
])

const exactAccountKeys = new Set(['accountemail', 'accountid', 'actoraccountid', 'authoraccountid'])
const manifestFileBodyKeys = new Set([
  'base64',
  'blob',
  'body',
  'dataurl',
  'filebody',
  'rawbytes',
  'textcontent',
])

const normalizeKey = (key: string): string => key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()

const appendPath = (path: string, key: string): string =>
  /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`

const sensitiveCredentialSuffixes = [
  'accesstoken',
  'apikey',
  'authorization',
  'authorizationheader',
  'clientsecret',
  'codeverifier',
  'idtoken',
  'oauthtoken',
  'password',
  'passwordhash',
  'refreshtoken',
  'storagekey',
]

const isCredentialKey = (normalizedKey: string): boolean =>
  exactCredentialKeys.has(normalizedKey) ||
  sensitiveCredentialSuffixes.some((suffix) => normalizedKey.endsWith(suffix)) ||
  normalizedKey.endsWith('cookieheader') ||
  normalizedKey.endsWith('cookieheaders') ||
  normalizedKey.endsWith('sessioncookie')

const isAccountKey = (normalizedKey: string): boolean =>
  exactAccountKeys.has(normalizedKey) || normalizedKey.endsWith('accountid')

const isReasoningReplayEncryption = (
  parent: Record<string, unknown>,
  normalizedKey: string,
  surface: ContextSecuritySurface,
): boolean =>
  surface === 'provider_context' &&
  normalizedKey === 'encryptedcontent' &&
  parent.type === 'reasoning'

/**
 * Recursively characterizes structural privacy violations at context export boundaries.
 * It intentionally inspects field paths rather than arbitrary text: user/model content may
 * legitimately discuss credentials, while credential-bearing object fields must not cross.
 */
export const scanContextSecurity = (
  value: unknown,
  surface: ContextSecuritySurface,
): ContextSecurityFinding[] => {
  const findings: ContextSecurityFinding[] = []
  const visited = new WeakSet<object>()

  const visit = (current: unknown, path: string): void => {
    if (typeof current === 'string') {
      if (surface === 'manifest' && current.trimStart().toLowerCase().startsWith('data:')) {
        findings.push({
          key: null,
          kind: 'data_url',
          path,
        })
      }
      return
    }

    if (typeof current !== 'object' || current === null || visited.has(current)) {
      return
    }

    visited.add(current)

    if (Array.isArray(current)) {
      current.forEach((entry, index) => {
        visit(entry, `${path}[${index}]`)
      })
      return
    }

    const record = current as Record<string, unknown>

    for (const [key, entry] of Object.entries(record)) {
      const entryPath = appendPath(path, key)
      const normalizedKey = normalizeKey(key)

      if (isCredentialKey(normalizedKey)) {
        findings.push({
          key,
          kind: 'credential_field',
          path: entryPath,
        })
      }

      if (isAccountKey(normalizedKey)) {
        findings.push({
          key,
          kind: 'account_field',
          path: entryPath,
        })
      }

      if (
        normalizedKey === 'encryptedcontent' &&
        !isReasoningReplayEncryption(record, normalizedKey, surface)
      ) {
        findings.push({
          key,
          kind: 'encrypted_payload',
          path: entryPath,
        })
      }

      if (surface === 'manifest' && manifestFileBodyKeys.has(normalizedKey)) {
        findings.push({
          key,
          kind: 'file_body',
          path: entryPath,
        })
      }

      visit(entry, entryPath)
    }
  }

  visit(value, '$')
  return findings
}
