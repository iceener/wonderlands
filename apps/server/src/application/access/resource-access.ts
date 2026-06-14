import { and, eq } from 'drizzle-orm'

import { fileLinks } from '../../db/schema'
import type { RepositoryDatabase } from '../../domain/database-port'
import { createFileRepository, type FileRecord } from '../../domain/files/file-repository'
import { createRunRepository, type RunRecord } from '../../domain/runtime/run-repository'
import { createToolExecutionRepository } from '../../domain/runtime/tool-execution-repository'
import { createSessionMessageRepository } from '../../domain/sessions/session-message-repository'
import {
  createSessionThreadRepository,
  type SessionThreadRecord,
} from '../../domain/sessions/session-thread-repository'
import {
  createWorkSessionRepository,
  type WorkSessionRecord,
} from '../../domain/sessions/work-session-repository'
import type { DomainError } from '../../shared/errors'
import {
  asRunId,
  asSessionMessageId,
  asSessionThreadId,
  asWorkSessionId,
  type FileId,
  type RunId,
  type SessionThreadId,
  type WorkSessionId,
} from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantRole, TenantScope } from '../../shared/scope'

export interface AuthorizedThreadAccess {
  session: WorkSessionRecord
  thread: SessionThreadRecord
}

export interface AuthorizedRunAccess {
  run: RunRecord
  session: WorkSessionRecord
}

export interface AuthorizeEventStreamInput {
  runId?: RunId | null
  sessionId?: WorkSessionId | null
  threadId?: SessionThreadId | null
}

const tenantResourceOverrideRoles = new Set<TenantRole>(['owner', 'admin', 'service'])

const toPermissionDenied = <TValue>(
  scope: TenantScope,
  resourceType: string,
  resourceId?: string,
): Result<TValue, DomainError> =>
  err({
    message: resourceId
      ? `account ${scope.accountId} cannot access ${resourceType} ${resourceId}`
      : `account ${scope.accountId} cannot access ${resourceType}`,
    type: 'permission',
  })

const canAccessSessionOwnerResource = (
  scope: TenantScope,
  ownerAccountId: WorkSessionRecord['createdByAccountId'],
): boolean =>
  tenantResourceOverrideRoles.has(scope.role) ||
  (ownerAccountId !== null && ownerAccountId === scope.accountId)

const isRecoverableLinkLookupError = (error: DomainError): boolean =>
  error.type === 'not_found' || error.type === 'permission'

export const hasTenantResourceOverride = (scope: TenantScope): boolean =>
  tenantResourceOverrideRoles.has(scope.role)

export const createResourceAccessService = (db: RepositoryDatabase) => {
  const fileRepository = createFileRepository(db)
  const runRepository = createRunRepository(db)
  const sessionMessageRepository = createSessionMessageRepository(db)
  const sessionThreadRepository = createSessionThreadRepository(db)
  const toolExecutionRepository = createToolExecutionRepository(db)
  const workSessionRepository = createWorkSessionRepository(db)

  const requireSessionAccess = (
    scope: TenantScope,
    sessionId: WorkSessionId,
  ): Result<WorkSessionRecord, DomainError> => {
    const session = workSessionRepository.getById(scope, sessionId)

    if (!session.ok) {
      return session
    }

    if (canAccessSessionOwnerResource(scope, session.value.createdByAccountId)) {
      return session
    }

    return toPermissionDenied(scope, 'session', sessionId)
  }

  const requireThreadAccess = (
    scope: TenantScope,
    threadId: SessionThreadId,
  ): Result<AuthorizedThreadAccess, DomainError> => {
    const thread = sessionThreadRepository.getById(scope, threadId)

    if (!thread.ok) {
      return thread
    }

    const session = requireSessionAccess(scope, thread.value.sessionId)

    if (!session.ok) {
      return session
    }

    return ok({
      session: session.value,
      thread: thread.value,
    })
  }

  const authorizeThreadWrite = (
    scope: TenantScope,
    threadId: SessionThreadId,
  ): Result<AuthorizedThreadAccess, DomainError> => requireThreadAccess(scope, threadId)

  const requireRunAccess = (
    scope: TenantScope,
    runId: RunId,
  ): Result<AuthorizedRunAccess, DomainError> => {
    const run = runRepository.getById(scope, runId)

    if (!run.ok) {
      return run
    }

    const session = requireSessionAccess(scope, run.value.sessionId)

    if (!session.ok) {
      return session
    }

    return ok({
      run: run.value,
      session: session.value,
    })
  }

  const hasAccessibleFileLink = (
    scope: TenantScope,
    fileId: FileId,
  ): Result<boolean, DomainError> => {
    try {
      const links = db
        .select()
        .from(fileLinks)
        .where(and(eq(fileLinks.fileId, fileId), eq(fileLinks.tenantId, scope.tenantId)))
        .all()

      for (const link of links) {
        switch (link.linkType) {
          case 'session': {
            const session = requireSessionAccess(scope, asWorkSessionId(link.targetId))

            if (session.ok) {
              return ok(true)
            }

            if (!isRecoverableLinkLookupError(session.error)) {
              return session
            }

            break
          }
          case 'thread': {
            const thread = requireThreadAccess(scope, asSessionThreadId(link.targetId))

            if (thread.ok) {
              return ok(true)
            }

            if (!isRecoverableLinkLookupError(thread.error)) {
              return thread
            }

            break
          }
          case 'message': {
            const message = sessionMessageRepository.getById(
              scope,
              asSessionMessageId(link.targetId),
            )

            if (!message.ok) {
              if (!isRecoverableLinkLookupError(message.error)) {
                return message
              }

              break
            }

            const session = requireSessionAccess(scope, message.value.sessionId)

            if (session.ok) {
              return ok(true)
            }

            if (!isRecoverableLinkLookupError(session.error)) {
              return session
            }

            break
          }
          case 'run': {
            const run = requireRunAccess(scope, asRunId(link.targetId))

            if (run.ok) {
              return ok(true)
            }

            if (!isRecoverableLinkLookupError(run.error)) {
              return run
            }

            break
          }
          case 'tool_execution': {
            const toolExecution = toolExecutionRepository.getById(scope, link.targetId)

            if (!toolExecution.ok) {
              if (!isRecoverableLinkLookupError(toolExecution.error)) {
                return toolExecution
              }

              break
            }

            const run = requireRunAccess(scope, toolExecution.value.runId)

            if (run.ok) {
              return ok(true)
            }

            if (!isRecoverableLinkLookupError(run.error)) {
              return run
            }

            break
          }
        }
      }

      return ok(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown file link access failure'

      return err({
        message: `failed to resolve access links for file ${fileId}: ${message}`,
        type: 'conflict',
      })
    }
  }

  const requireFileAccess = (
    scope: TenantScope,
    fileId: FileId,
  ): Result<FileRecord, DomainError> => {
    const file = fileRepository.getById(scope, fileId)

    if (!file.ok) {
      return file
    }

    if (hasTenantResourceOverride(scope)) {
      return file
    }

    if (file.value.accessScope === 'account_library') {
      if (file.value.createdByAccountId === scope.accountId) {
        return file
      }

      return toPermissionDenied(scope, 'file', fileId)
    }

    if (file.value.createdByRunId) {
      const run = requireRunAccess(scope, file.value.createdByRunId)

      if (run.ok) {
        return file
      }

      if (!isRecoverableLinkLookupError(run.error)) {
        return run
      }
    }

    const linked = hasAccessibleFileLink(scope, fileId)

    if (!linked.ok) {
      return linked
    }

    if (linked.value) {
      return file
    }

    return toPermissionDenied(scope, 'file', fileId)
  }

  const authorizeEventStream = (
    scope: TenantScope,
    input: AuthorizeEventStreamInput,
  ): Result<null, DomainError> => {
    const hasFilters = Boolean(input.runId || input.sessionId || input.threadId)

    if (!hasFilters && !hasTenantResourceOverride(scope)) {
      return toPermissionDenied(scope, 'tenant-wide event stream')
    }

    if (input.sessionId) {
      const session = requireSessionAccess(scope, input.sessionId)

      if (!session.ok) {
        return session
      }
    }

    if (input.threadId) {
      const thread = requireThreadAccess(scope, input.threadId)

      if (!thread.ok) {
        return thread
      }
    }

    if (input.runId) {
      const run = requireRunAccess(scope, input.runId)

      if (!run.ok) {
        return run
      }
    }

    return ok(null)
  }

  return {
    authorizeEventStream,
    authorizeThreadWrite,
    requireFileAccess,
    requireRunAccess,
    requireSessionAccess,
    requireThreadAccess,
  }
}
