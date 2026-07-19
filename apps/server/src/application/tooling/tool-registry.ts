import type { AppConfig } from '../../app/config'
import type { AppServices } from '../../app/runtime'
import type { AppDatabase } from '../../db/client'
import type { RunRecord } from '../../domain/runtime/run-repository'
import type { ToolDomain, ToolWaitDescriptor } from '../../domain/tooling/tool-vocabulary'
import type { DomainError } from '../../shared/errors'
import type { RequestId, TraceId } from '../../shared/ids'
import type { Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

export type { ToolDomain } from '../../domain/tooling/tool-vocabulary'

export type AttachmentRefResolutionPolicy =
  | 'file_id_only'
  | 'metadata_only'
  | 'markdown_only'
  | 'none'
  | 'path_only'
  | 'path_inline'
  | 'smart_default'
  | 'text_only'
  | 'url_only'

export type ToolOutcome =
  | { kind: 'immediate'; output: unknown }
  | { kind: 'waiting'; wait: ToolWaitDescriptor }

export interface ToolContext {
  abortSignal?: AbortSignal
  config: AppConfig
  createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  db: AppDatabase
  mcpCodeModeApprovedRuntimeNames?: readonly string[]
  nowIso: () => string
  requestId: RequestId
  run: RunRecord
  sandboxDeleteWritebackApproved?: boolean
  services: AppServices
  tenantScope: TenantScope
  toolCallId: string | null
  traceId: TraceId
}

export interface ToolSpec<TArgs = unknown> {
  attachmentRefResolutionPolicy?: AttachmentRefResolutionPolicy
  attachmentRefTargetKeys?: string[]
  description?: string
  domain: ToolDomain
  execute: (context: ToolContext, args: TArgs) => Promise<Result<ToolOutcome, DomainError>>
  inputSchema: Record<string, unknown>
  isAvailable?: (context: ToolContext) => boolean
  name: string
  strict?: boolean
  validateArgs?: (args: unknown) => Result<TArgs, DomainError>
}

export interface ToolRegistry {
  get: (name: string) => ToolSpec | null
  list: (context: ToolContext) => ToolSpec[]
  register: (tool: ToolSpec) => void
  unregister: (name: string) => void
}

export const createToolRegistry = (initialTools: ToolSpec[] = []): ToolRegistry => {
  const tools = new Map<string, ToolSpec>()

  for (const tool of initialTools) {
    tools.set(tool.name, tool)
  }

  return {
    get: (name) => tools.get(name) ?? null,
    list: (context) => [...tools.values()].filter((tool) => tool.isAvailable?.(context) ?? true),
    register: (tool) => {
      tools.set(tool.name, tool)
    },
    unregister: (name) => {
      tools.delete(name)
    },
  }
}
