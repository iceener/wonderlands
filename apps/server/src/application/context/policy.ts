import type { ContextArtifact } from './contracts'

export type ContextPolicyValidationMode = 'legacy-shadow' | 'strict'

export type ContextPolicyReasonCode =
  | 'expired'
  | 'missing_dependency'
  | 'secret_provider_visibility'
  | 'undeclared_metadata'
  | 'unsafe_account_field'
  | 'unsafe_credential_field'
  | 'unsafe_data_url'
  | 'unsafe_encrypted_payload'
  | 'unsafe_file_body'

export interface ContextPolicyReason {
  readonly code: ContextPolicyReasonCode
  readonly dependencyId?: string
  readonly path?: string
}

export type ContextPolicyDecision =
  | {
      readonly artifactId: string
      readonly outcome: 'allow'
      readonly reasons: readonly []
    }
  | {
      readonly artifactId: string
      readonly outcome: 'reject'
      readonly reasons: readonly ContextPolicyReason[]
    }

export interface EvaluateContextArtifactPolicyOptions {
  /** Candidate IDs are supplied by the caller so dependency checks never depend on selection order. */
  readonly candidateIds: ReadonlySet<string> | readonly string[]
  /** An ISO timestamp from the assembly snapshot. Policy code never reads the process clock. */
  readonly now: string
  readonly validationMode?: ContextPolicyValidationMode
}

export interface EvaluateContextArtifactsPolicyOptions {
  /** An ISO timestamp from the assembly snapshot. Policy code never reads the process clock. */
  readonly now: string
  readonly validationMode?: ContextPolicyValidationMode
}

type UnsafeFindingCode = Extract<
  ContextPolicyReasonCode,
  | 'unsafe_account_field'
  | 'unsafe_credential_field'
  | 'unsafe_data_url'
  | 'unsafe_encrypted_payload'
  | 'unsafe_file_body'
>

interface ScanOptions {
  readonly allowModelReasoningEncryption: boolean
  readonly rejectManifestUnsafeContent: boolean
}

const exactCredentialKeys = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'codeverifier',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'encryptionkey',
  'idtoken',
  'oauthaccesstoken',
  'oauthtoken',
  'passphrase',
  'password',
  'privatekey',
  'proxyauthorization',
  'refreshtoken',
  'secret',
  'sessioncookie',
  'sessiontoken',
  'setcookie',
  'signingkey',
  'storagekey',
  'xapikey',
])

const credentialKeySuffixes = [
  'accesstoken',
  'apikey',
  'apisecret',
  'authorization',
  'authorizationheader',
  'authheader',
  'authtoken',
  'clientsecret',
  'codeverifier',
  'cookieheader',
  'cookieheaders',
  'cookies',
  'encryptionkey',
  'idtoken',
  'oauthaccesstoken',
  'oauthtoken',
  'password',
  'passwordhash',
  'privatekey',
  'refreshtoken',
  'secretkey',
  'sessioncookie',
  'sessiontoken',
  'signingkey',
  'storagekey',
]

const exactAccountKeys = new Set([
  'accountemail',
  'accountid',
  'accountname',
  'actoraccountid',
  'authoraccountid',
  'tenantmember',
  'tenantmembers',
  'tenantmembership',
  'tenantmemberships',
])

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

const isCredentialKey = (normalizedKey: string): boolean =>
  exactCredentialKeys.has(normalizedKey) ||
  credentialKeySuffixes.some((suffix) => normalizedKey.endsWith(suffix))

const isAccountKey = (normalizedKey: string): boolean =>
  exactAccountKeys.has(normalizedKey) ||
  ['accountdisplayname', 'accountemail', 'accountid', 'accountname', 'tenantmembership'].some(
    (suffix) => normalizedKey.endsWith(suffix),
  )

const isBinaryValue = (value: object): boolean =>
  value instanceof ArrayBuffer || ArrayBuffer.isView(value)

const scanStructuredValue = (
  value: unknown,
  rootPath: string,
  options: ScanOptions,
): readonly ContextPolicyReason[] => {
  const reasons: ContextPolicyReason[] = []
  const findingKeys = new Set<string>()
  const visited = new WeakSet<object>()

  const add = (code: UnsafeFindingCode, path: string): void => {
    const findingKey = `${code}\u0000${path}`
    if (!findingKeys.has(findingKey)) {
      findingKeys.add(findingKey)
      reasons.push(Object.freeze({ code, path }))
    }
  }

  const visit = (current: unknown, path: string): void => {
    if (typeof current === 'string') {
      if (
        options.rejectManifestUnsafeContent &&
        current.trimStart().toLowerCase().startsWith('data:')
      ) {
        add('unsafe_data_url', path)
      }
      return
    }

    if (typeof current !== 'object' || current === null || visited.has(current)) {
      return
    }

    if (options.rejectManifestUnsafeContent && isBinaryValue(current)) {
      add('unsafe_file_body', path)
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
        add('unsafe_credential_field', entryPath)
      }

      if (isAccountKey(normalizedKey)) {
        add('unsafe_account_field', entryPath)
      }

      if (
        normalizedKey === 'encryptedcontent' &&
        !(options.allowModelReasoningEncryption && record.type === 'reasoning')
      ) {
        add('unsafe_encrypted_payload', entryPath)
      }

      if (options.rejectManifestUnsafeContent && manifestFileBodyKeys.has(normalizedKey)) {
        add('unsafe_file_body', entryPath)
      }

      visit(entry, entryPath)
    }
  }

  visit(value, rootPath)
  return Object.freeze(reasons)
}

const parseTimestamp = (value: string, field: string): number => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Context policy requires a valid ${field} timestamp`)
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Context policy requires a valid ${field} timestamp`)
  }

  return timestamp
}

const toCandidateIdSet = (
  candidateIds: ReadonlySet<string> | readonly string[],
): ReadonlySet<string> => {
  const ids = candidateIds instanceof Set ? candidateIds : new Set(candidateIds)

  for (const id of ids) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Context policy candidate IDs must be non-empty strings')
    }
  }

  return ids
}

const scanArtifactPayload = (artifact: ContextArtifact): readonly ContextPolicyReason[] => {
  if (artifact.payload.kind === 'messages') {
    // Message text, image/file URLs, and serialized call arguments/results are model data. Their
    // strings are deliberately not content-scanned. Structural credential/account fields are.
    return scanStructuredValue(artifact.payload, '$.payload', {
      allowModelReasoningEncryption: artifact.visibility === 'model',
      rejectManifestUnsafeContent: false,
    })
  }

  // These payload families become request controls or request metadata and are manifest-adjacent;
  // unlike message content they may not carry raw file bodies, data URLs, or encrypted payloads.
  return scanStructuredValue(artifact.payload, '$.payload', {
    allowModelReasoningEncryption: false,
    rejectManifestUnsafeContent: true,
  })
}

/**
 * Applies privacy, freshness, declaration, and dependency policy to one typed candidate.
 * Expected policy drops are returned as reasons. Invalid timestamps and malformed candidate sets
 * are programmer/data invariants and throw.
 */
export const evaluateContextArtifactPolicy = (
  artifact: ContextArtifact,
  options: EvaluateContextArtifactPolicyOptions,
): ContextPolicyDecision => {
  if (typeof artifact.id !== 'string' || artifact.id.trim().length === 0) {
    throw new Error('Context policy artifacts must have a non-empty id')
  }
  if (!Array.isArray(artifact.dependencies)) {
    throw new Error(`Context artifact "${artifact.id}" dependencies must be an array`)
  }
  if (!['model', 'request'].includes(artifact.visibility)) {
    throw new Error(`Context artifact "${artifact.id}" has an invalid visibility`)
  }
  if (!['public', 'private', 'restricted', 'secret'].includes(artifact.sensitivity)) {
    throw new Error(`Context artifact "${artifact.id}" has an invalid sensitivity`)
  }

  const validationMode = options.validationMode ?? 'strict'
  const now = parseTimestamp(options.now, 'now')
  const candidateIds = toCandidateIdSet(options.candidateIds)
  const reasons: ContextPolicyReason[] = []

  if (validationMode === 'strict' && artifact.metadataStatus !== 'declared') {
    reasons.push(Object.freeze({ code: 'undeclared_metadata' }))
  }

  if (artifact.sensitivity === 'secret') {
    reasons.push(Object.freeze({ code: 'secret_provider_visibility' }))
  }

  if (artifact.expiresAt !== null) {
    const expiresAt = parseTimestamp(artifact.expiresAt, `expiresAt for artifact "${artifact.id}"`)
    if (expiresAt <= now) {
      reasons.push(Object.freeze({ code: 'expired' }))
    }
  }

  for (const dependencyId of artifact.dependencies) {
    if (typeof dependencyId !== 'string' || dependencyId.trim().length === 0) {
      throw new Error(`Context artifact "${artifact.id}" has an invalid dependency id`)
    }
    if (!candidateIds.has(dependencyId)) {
      reasons.push(Object.freeze({ code: 'missing_dependency', dependencyId }))
    }
  }

  reasons.push(
    ...scanStructuredValue(artifact.provenance, '$.provenance', {
      allowModelReasoningEncryption: false,
      rejectManifestUnsafeContent: true,
    }),
    ...scanStructuredValue(artifact.transformation, '$.transformation', {
      allowModelReasoningEncryption: false,
      rejectManifestUnsafeContent: true,
    }),
    ...scanArtifactPayload(artifact),
  )

  if (reasons.length === 0) {
    const noReasons = Object.freeze([]) as readonly []
    return Object.freeze({ artifactId: artifact.id, outcome: 'allow', reasons: noReasons })
  }

  return Object.freeze({
    artifactId: artifact.id,
    outcome: 'reject',
    reasons: Object.freeze(reasons),
  })
}

/** Evaluates a complete candidate collection with dependency membership fixed up front. */
export const evaluateContextArtifactsPolicy = (
  artifacts: readonly ContextArtifact[],
  options: EvaluateContextArtifactsPolicyOptions,
): readonly ContextPolicyDecision[] => {
  const candidateIds = new Set<string>()

  for (const artifact of artifacts) {
    if (candidateIds.has(artifact.id)) {
      throw new Error(`Duplicate context policy candidate id "${artifact.id}"`)
    }
    candidateIds.add(artifact.id)
  }

  return Object.freeze(
    artifacts.map((artifact) =>
      evaluateContextArtifactPolicy(artifact, {
        ...options,
        candidateIds,
      }),
    ),
  )
}
