import { DomainErrorException } from './errors'

export type Brand<TValue, TName extends string> = TValue & { readonly __brand: TName }

export type RequestId = Brand<string, 'RequestId'>
export type TraceId = Brand<string, 'TraceId'>
export type AccountId = Brand<string, 'AccountId'>
export type ApiKeyId = Brand<string, 'ApiKeyId'>
export type AuthSessionId = Brand<string, 'AuthSessionId'>
export type TenantId = Brand<string, 'TenantId'>
export type WorkSessionId = Brand<string, 'WorkSessionId'>
export type SessionThreadId = Brand<string, 'SessionThreadId'>
export type SessionMessageId = Brand<string, 'SessionMessageId'>
export type AgentId = Brand<string, 'AgentId'>
export type AgentRevisionId = Brand<string, 'AgentRevisionId'>
export type AgentSubagentLinkId = Brand<string, 'AgentSubagentLinkId'>
export type AccountAgentDefaultId = Brand<string, 'AccountAgentDefaultId'>
export type ToolProfileId = Brand<string, 'ToolProfileId'>
export type WorkspaceId = Brand<string, 'WorkspaceId'>
export type GardenSiteId = Brand<string, 'GardenSiteId'>
export type GardenBuildId = Brand<string, 'GardenBuildId'>
export type GardenDeploymentId = Brand<string, 'GardenDeploymentId'>
export type RunId = Brand<string, 'RunId'>
export type JobId = Brand<string, 'JobId'>
export type JobDependencyId = Brand<string, 'JobDependencyId'>
export type SandboxExecutionId = Brand<string, 'SandboxExecutionId'>
export type SandboxExecutionFileId = Brand<string, 'SandboxExecutionFileId'>
export type SandboxExecutionPackageId = Brand<string, 'SandboxExecutionPackageId'>
export type SandboxWritebackOperationId = Brand<string, 'SandboxWritebackOperationId'>
export type KernelSessionId = Brand<string, 'KernelSessionId'>
export type KernelSessionArtifactId = Brand<string, 'KernelSessionArtifactId'>
export type UploadId = Brand<string, 'UploadId'>
export type FileId = Brand<string, 'FileId'>
export type ItemId = Brand<string, 'ItemId'>
export type EventId = Brand<string, 'EventId'>
export type AgentScheduledTaskId = Brand<string, 'AgentScheduledTaskId'>
export type AgentScheduledTaskRunId = Brand<string, 'AgentScheduledTaskRunId'>

const prefixedIdSuffixPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/
const requestScopedIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

const normalizeIdInput = (value: string, label: string): string => {
  const normalized = value.trim()

  if (!normalized) {
    throw new DomainErrorException({
      message: `${label} must not be empty`,
      type: 'validation',
    })
  }

  return normalized
}

const createLooseIdCaster =
  <TName extends string>(label: string) =>
  (value: string): Brand<string, TName> => {
    const normalized = normalizeIdInput(value, label)

    if (!requestScopedIdPattern.test(normalized)) {
      throw new DomainErrorException({
        message: `${label} contains invalid characters`,
        type: 'validation',
      })
    }

    return normalized as Brand<string, TName>
  }

const createPrefixedIdCaster =
  <TName extends string>(prefix: string, label: string) =>
  (value: string): Brand<string, TName> => {
    const normalized = normalizeIdInput(value, label)

    if (!normalized.startsWith(`${prefix}_`)) {
      throw new DomainErrorException({
        message: `${label} must start with "${prefix}_"`,
        type: 'validation',
      })
    }

    const suffix = normalized.slice(prefix.length + 1)

    if (!prefixedIdSuffixPattern.test(suffix)) {
      throw new DomainErrorException({
        message: `${label} has an invalid identifier suffix`,
        type: 'validation',
      })
    }

    return normalized as Brand<string, TName>
  }

export const asRequestId = createLooseIdCaster<'RequestId'>('request id')
export const asTraceId = createLooseIdCaster<'TraceId'>('trace id')
export const asAccountId = createPrefixedIdCaster<'AccountId'>('acc', 'account id')
export const asApiKeyId = createPrefixedIdCaster<'ApiKeyId'>('key', 'api key id')
export const asAuthSessionId = createPrefixedIdCaster<'AuthSessionId'>('aus', 'auth session id')
export const asTenantId = createPrefixedIdCaster<'TenantId'>('ten', 'tenant id')
export const asWorkSessionId = createPrefixedIdCaster<'WorkSessionId'>('ses', 'work session id')
export const asSessionThreadId = createPrefixedIdCaster<'SessionThreadId'>(
  'thr',
  'session thread id',
)
export const asSessionMessageId = createPrefixedIdCaster<'SessionMessageId'>(
  'msg',
  'session message id',
)
export const asAgentId = createPrefixedIdCaster<'AgentId'>('agt', 'agent id')
export const asAgentRevisionId = createPrefixedIdCaster<'AgentRevisionId'>(
  'agr',
  'agent revision id',
)
export const asAgentSubagentLinkId = createPrefixedIdCaster<'AgentSubagentLinkId'>(
  'asl',
  'agent subagent link id',
)
export const asAccountAgentDefaultId = createPrefixedIdCaster<'AccountAgentDefaultId'>(
  'aad',
  'account agent default id',
)
export const asToolProfileId = createPrefixedIdCaster<'ToolProfileId'>('tpf', 'tool profile id')
export const asWorkspaceId = createPrefixedIdCaster<'WorkspaceId'>('wsp', 'workspace id')
export const asGardenSiteId = createPrefixedIdCaster<'GardenSiteId'>('gst', 'garden site id')
export const asGardenBuildId = createPrefixedIdCaster<'GardenBuildId'>('gbd', 'garden build id')
export const asGardenDeploymentId = createPrefixedIdCaster<'GardenDeploymentId'>(
  'gdp',
  'garden deployment id',
)
export const asRunId = createPrefixedIdCaster<'RunId'>('run', 'run id')
export const asJobId = createPrefixedIdCaster<'JobId'>('job', 'job id')
export const asJobDependencyId = createPrefixedIdCaster<'JobDependencyId'>(
  'jdp',
  'job dependency id',
)
export const asSandboxExecutionId = createPrefixedIdCaster<'SandboxExecutionId'>(
  'sbx',
  'sandbox execution id',
)
export const asSandboxExecutionFileId = createPrefixedIdCaster<'SandboxExecutionFileId'>(
  'sbf',
  'sandbox execution file id',
)
export const asSandboxExecutionPackageId = createPrefixedIdCaster<'SandboxExecutionPackageId'>(
  'sbp',
  'sandbox execution package id',
)
export const asSandboxWritebackOperationId = createPrefixedIdCaster<'SandboxWritebackOperationId'>(
  'sbw',
  'sandbox writeback operation id',
)
export const asKernelSessionId = createPrefixedIdCaster<'KernelSessionId'>(
  'kse',
  'kernel session id',
)
export const asKernelSessionArtifactId = createPrefixedIdCaster<'KernelSessionArtifactId'>(
  'ksa',
  'kernel session artifact id',
)
export const asUploadId = createPrefixedIdCaster<'UploadId'>('upl', 'upload id')
export const asFileId = createPrefixedIdCaster<'FileId'>('fil', 'file id')
export const asItemId = createPrefixedIdCaster<'ItemId'>('itm', 'item id')
export const asEventId = createPrefixedIdCaster<'EventId'>('evt', 'event id')
export const asAgentScheduledTaskId = createPrefixedIdCaster<'AgentScheduledTaskId'>(
  'tsk',
  'agent scheduled task id',
)
export const asAgentScheduledTaskRunId = createPrefixedIdCaster<'AgentScheduledTaskRunId'>(
  'tsr',
  'agent scheduled task run id',
)

export const createPrefixedId = <TPrefix extends string>(prefix: TPrefix): `${TPrefix}_${string}` =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`
