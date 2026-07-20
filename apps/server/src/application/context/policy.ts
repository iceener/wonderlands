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
  readonly allowJsonSchemaNames: boolean
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const jsonSchemaNameMapKeys = new Set(['$defs', 'definitions', 'patternProperties', 'properties'])

const isModelReasoningRecordPath = (path: string): boolean =>
  /^\$\.payload\.messages\[\d+\]\.content\[\d+\]$/.test(path)

const scanStructuredValue = (
  value: unknown,
  rootPath: string,
  options: ScanOptions,
): readonly ContextPolicyReason[] => {
  const reasons: ContextPolicyReason[] = []
  const findingKeys = new Set<string>()
  const ancestors = new WeakSet<object>()

  const add = (code: UnsafeFindingCode, path: string): void => {
    const findingKey = `${code}\u0000${path}`
    if (!findingKeys.has(findingKey)) {
      findingKeys.add(findingKey)
      reasons.push(Object.freeze({ code, path }))
    }
  }

  const visit = (current: unknown, path: string, keysAreJsonSchemaNames = false): void => {
    if (typeof current === 'string') {
      if (
        options.rejectManifestUnsafeContent &&
        current.trimStart().toLowerCase().startsWith('data:')
      ) {
        add('unsafe_data_url', path)
      }
      return
    }

    if (typeof current !== 'object' || current === null || ancestors.has(current)) {
      return
    }

    if (options.rejectManifestUnsafeContent && isBinaryValue(current)) {
      add('unsafe_file_body', path)
      return
    }

    ancestors.add(current)

    if (Array.isArray(current)) {
      current.forEach((entry, index) => {
        visit(entry, `${path}[${index}]`)
      })
      ancestors.delete(current)
      return
    }

    const record = current as Record<string, unknown>

    for (const [key, entry] of Object.entries(record)) {
      const entryPath = appendPath(path, key)
      const normalizedKey = normalizeKey(key)

      if (!keysAreJsonSchemaNames && isCredentialKey(normalizedKey)) {
        add('unsafe_credential_field', entryPath)
      }

      if (!keysAreJsonSchemaNames && isAccountKey(normalizedKey)) {
        add('unsafe_account_field', entryPath)
      }

      if (
        !keysAreJsonSchemaNames &&
        normalizedKey === 'encryptedcontent' &&
        !(
          options.allowModelReasoningEncryption &&
          record.type === 'reasoning' &&
          isModelReasoningRecordPath(path)
        )
      ) {
        add('unsafe_encrypted_payload', entryPath)
      }

      if (
        !keysAreJsonSchemaNames &&
        options.rejectManifestUnsafeContent &&
        manifestFileBodyKeys.has(normalizedKey)
      ) {
        add('unsafe_file_body', entryPath)
      }

      visit(entry, entryPath, options.allowJsonSchemaNames && jsonSchemaNameMapKeys.has(key))
    }

    ancestors.delete(current)
  }

  visit(value, rootPath)
  return Object.freeze(reasons)
}

const timestampPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

const parseTimestamp = (value: string, field: string): number => {
  const match = typeof value === 'string' ? timestampPattern.exec(value) : null
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    match?.slice(1).map((part) => (part === undefined ? 0 : Number(part))) ?? []
  const daysInMonth = [31, isLeapYear(year ?? 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const timestamp = match ? Date.parse(value) : Number.NaN

  if (
    !match ||
    !Number.isFinite(timestamp) ||
    (month ?? 0) < 1 ||
    (month ?? 0) > 12 ||
    (day ?? 0) < 1 ||
    (day ?? 0) > (daysInMonth[(month ?? 1) - 1] ?? 0) ||
    (hour ?? 0) > 23 ||
    (minute ?? 0) > 59 ||
    (second ?? 0) > 59 ||
    (offsetHour ?? 0) > 23 ||
    (offsetMinute ?? 0) > 59
  ) {
    throw new Error(`Context policy requires a valid ${field} timestamp`)
  }

  return timestamp
}

const toCandidateIdSet = (
  candidateIds: ReadonlySet<string> | readonly string[],
): ReadonlySet<string> => {
  if (!(candidateIds instanceof Set) && !Array.isArray(candidateIds)) {
    throw new Error('Context policy candidate IDs must be a set or array')
  }

  const ids = candidateIds instanceof Set ? candidateIds : new Set(candidateIds)

  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || id !== id.trim()) {
      throw new Error('Context policy candidate IDs must be trimmed, non-empty strings')
    }
  }

  return ids
}

const assertArtifactPayload = (artifact: ContextArtifact): void => {
  const payload = artifact.payload as unknown

  if (!isRecord(payload) || typeof payload.kind !== 'string') {
    throw new Error(`Context artifact "${artifact.id}" has an invalid payload`)
  }

  switch (payload.kind) {
    case 'messages':
      if (!Array.isArray(payload.messages)) {
        throw new Error(`Context artifact "${artifact.id}" messages must be an array`)
      }
      return
    case 'tools':
      if (!Array.isArray(payload.tools)) {
        throw new Error(`Context artifact "${artifact.id}" tools must be an array`)
      }
      return
    case 'native_tools':
      if (
        !Array.isArray(payload.tools) ||
        payload.tools.some((tool) => typeof tool !== 'string' || tool.length === 0)
      ) {
        throw new Error(`Context artifact "${artifact.id}" native tools must be non-empty strings`)
      }
      return
    case 'request_options':
      if (!isRecord(payload.options)) {
        throw new Error(`Context artifact "${artifact.id}" request options must be an object`)
      }
      return
    case 'metadata':
      if (
        !isRecord(payload.metadata) ||
        Object.values(payload.metadata).some((entry) => typeof entry !== 'string')
      ) {
        throw new Error(`Context artifact "${artifact.id}" metadata must contain string values`)
      }
      return
    default:
      throw new Error(`Context artifact "${artifact.id}" has an unsupported payload kind`)
  }
}

const scanArtifactPayload = (artifact: ContextArtifact): readonly ContextPolicyReason[] => {
  if (artifact.payload.kind === 'messages') {
    // Message text, image/file URLs, and serialized call arguments/results are model data. Their
    // strings are deliberately not content-scanned. Structural credential/account fields are.
    return scanStructuredValue(artifact.payload, '$.payload', {
      allowJsonSchemaNames: false,
      allowModelReasoningEncryption: artifact.visibility === 'model',
      rejectManifestUnsafeContent: false,
    })
  }

  // JSON Schema property names describe tool inputs; they are not credential/file values. All
  // other request-control structure remains subject to the forbidden-key and raw-body checks.
  return scanStructuredValue(artifact.payload, '$.payload', {
    allowJsonSchemaNames: artifact.payload.kind === 'tools',
    allowModelReasoningEncryption: false,
    rejectManifestUnsafeContent: true,
  })
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const toStableReasons = (
  reasons: readonly ContextPolicyReason[],
): readonly ContextPolicyReason[] => {
  const uniqueReasons = new Map<string, ContextPolicyReason>()

  for (const reason of reasons) {
    const key = JSON.stringify([reason.code, reason.dependencyId ?? '', reason.path ?? ''])
    uniqueReasons.set(key, reason)
  }

  return Object.freeze(
    [...uniqueReasons.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, reason]) => Object.freeze({ ...reason })),
  )
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
  if (!['legacy-shadow', 'strict'].includes(validationMode)) {
    throw new Error('Context policy has an invalid validation mode')
  }
  assertArtifactPayload(artifact)
  const now = parseTimestamp(options.now, 'now')
  parseTimestamp(artifact.capturedAt, `capturedAt for artifact "${artifact.id}"`)
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
    if (
      typeof dependencyId !== 'string' ||
      dependencyId.length === 0 ||
      dependencyId !== dependencyId.trim()
    ) {
      throw new Error(`Context artifact "${artifact.id}" has an invalid dependency id`)
    }
    if (!candidateIds.has(dependencyId)) {
      reasons.push(Object.freeze({ code: 'missing_dependency', dependencyId }))
    }
  }

  reasons.push(
    ...scanStructuredValue(artifact.provenance, '$.provenance', {
      allowJsonSchemaNames: false,
      allowModelReasoningEncryption: false,
      rejectManifestUnsafeContent: true,
    }),
    ...scanStructuredValue(artifact.transformation, '$.transformation', {
      allowJsonSchemaNames: false,
      allowModelReasoningEncryption: false,
      rejectManifestUnsafeContent: true,
    }),
    ...scanArtifactPayload(artifact),
  )

  const stableReasons = toStableReasons(reasons)

  if (stableReasons.length === 0) {
    const noReasons = Object.freeze([]) as readonly []
    return Object.freeze({ artifactId: artifact.id, outcome: 'allow', reasons: noReasons })
  }

  return Object.freeze({
    artifactId: artifact.id,
    outcome: 'reject',
    reasons: stableReasons,
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
