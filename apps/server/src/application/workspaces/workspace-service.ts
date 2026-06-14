import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  createWorkspaceRepository,
  type WorkspaceRecord,
} from '../../domain/agents/workspace-repository'
import type { RepositoryDatabase } from '../../domain/database-port'
import type { DomainError } from '../../shared/errors'
import type { AccountId, RunId, WorkSessionId, WorkspaceId } from '../../shared/ids'
import { asWorkspaceId } from '../../shared/ids'
import { err, ok, type Result } from '../../shared/result'
import type { TenantScope } from '../../shared/scope'

interface WorkspaceServiceDeps {
  createId: <TPrefix extends string>(prefix: TPrefix) => `${TPrefix}_${string}`
  fileStorageRoot: string
}

export interface WorkspaceLayout {
  agentsRef: string
  attachmentsRef: string
  runRef: string
  sessionRef: string
  vaultRef: string
  workspace: WorkspaceRecord
}

export interface WorkspaceResolution {
  created: boolean
  workspace: WorkspaceRecord
}

const ensureDirectory = (path: string): void => {
  mkdirSync(path, { recursive: true })
}

const toWorkspaceBaseRoot = (fileStorageRoot: string): string =>
  resolve(fileStorageRoot, '..', 'workspaces')

const toWorkspaceRootRef = (baseRoot: string, tenantId: string, accountId: string): string =>
  join(baseRoot, `ten_${tenantId}`, `acc_${accountId}`)

const toAgentsRef = (workspace: WorkspaceRecord): string => join(workspace.rootRef, 'agents')

const toVaultRef = (workspace: WorkspaceRecord): string => join(workspace.rootRef, 'vault')

const toAttachmentsRef = (workspace: WorkspaceRecord): string =>
  join(toVaultRef(workspace), 'attachments')

const toSessionRef = (workspace: WorkspaceRecord, sessionId: WorkSessionId): string =>
  join(workspace.rootRef, 'sessions', sessionId)

const toRunRef = (workspace: WorkspaceRecord, runId: RunId): string =>
  join(workspace.rootRef, 'runs', runId)

const ensureWorkspaceDirectories = (workspace: WorkspaceRecord): void => {
  ensureDirectory(workspace.rootRef)
  ensureDirectory(toAgentsRef(workspace))
  ensureDirectory(toVaultRef(workspace))
}

export const createWorkspaceService = (db: RepositoryDatabase, deps: WorkspaceServiceDeps) => {
  const workspaceRepository = createWorkspaceRepository(db)
  const baseRoot = toWorkspaceBaseRoot(deps.fileStorageRoot)

  const ensureAccountWorkspace = (
    scope: TenantScope,
    input: {
      accountId?: AccountId
      nowIso: string
    },
  ): Result<WorkspaceRecord, DomainError> => {
    const resolvedWorkspace = ensureAccountWorkspaceResolution(scope, input)

    if (!resolvedWorkspace.ok) {
      return resolvedWorkspace
    }

    return ok(resolvedWorkspace.value.workspace)
  }

  const ensureAccountWorkspaceResolution = (
    scope: TenantScope,
    input: {
      accountId?: AccountId
      nowIso: string
    },
  ): Result<WorkspaceResolution, DomainError> => {
    const accountId = input.accountId ?? scope.accountId
    const existingWorkspace = workspaceRepository.getByAccountAndKind(scope, {
      accountId,
      kind: 'account_root',
    })

    if (existingWorkspace.ok) {
      if (existingWorkspace.value.status !== 'active') {
        return err({
          message: `workspace ${existingWorkspace.value.id} is not active`,
          type: 'conflict',
        })
      }

      ensureWorkspaceDirectories(existingWorkspace.value)
      return ok({
        created: false,
        workspace: existingWorkspace.value,
      })
    }

    if (existingWorkspace.error.type !== 'not_found') {
      return existingWorkspace
    }

    const createdWorkspace = workspaceRepository.create(scope, {
      accountId,
      createdAt: input.nowIso,
      id: asWorkspaceId(deps.createId('wsp')),
      kind: 'account_root',
      label: `${scope.tenantId}/${accountId}`,
      rootRef: toWorkspaceRootRef(baseRoot, scope.tenantId, accountId),
      status: 'active',
      updatedAt: input.nowIso,
    })

    if (!createdWorkspace.ok) {
      return createdWorkspace
    }

    ensureWorkspaceDirectories(createdWorkspace.value)
    return ok({
      created: true,
      workspace: createdWorkspace.value,
    })
  }

  const requireWritableWorkspace = (
    scope: TenantScope,
    input: {
      nowIso: string
      ownerAccountId?: AccountId | null
      workspaceId?: WorkspaceId | null
    },
  ): Result<WorkspaceRecord, DomainError> => {
    const resolvedWorkspace = requireWritableWorkspaceResolution(scope, input)

    if (!resolvedWorkspace.ok) {
      return resolvedWorkspace
    }

    return ok(resolvedWorkspace.value.workspace)
  }

  const requireWritableWorkspaceResolution = (
    scope: TenantScope,
    input: {
      nowIso: string
      ownerAccountId?: AccountId | null
      workspaceId?: WorkspaceId | null
    },
  ): Result<WorkspaceResolution, DomainError> => {
    if (input.ownerAccountId && input.ownerAccountId !== scope.accountId) {
      return err({
        message: `account ${scope.accountId} cannot write into workspace owned by ${input.ownerAccountId}`,
        type: 'permission',
      })
    }

    if (input.workspaceId) {
      const workspace = workspaceRepository.getById(scope, input.workspaceId)

      if (!workspace.ok) {
        return workspace
      }

      if (workspace.value.accountId !== scope.accountId) {
        return err({
          message: `workspace ${input.workspaceId} is not writable by account ${scope.accountId}`,
          type: 'permission',
        })
      }

      if (workspace.value.status !== 'active') {
        return err({
          message: `workspace ${input.workspaceId} is not active`,
          type: 'conflict',
        })
      }

      ensureWorkspaceDirectories(workspace.value)
      return ok({
        created: false,
        workspace: workspace.value,
      })
    }

    return ensureAccountWorkspaceResolution(scope, {
      accountId: input.ownerAccountId ?? scope.accountId,
      nowIso: input.nowIso,
    })
  }

  const ensureAgentsRef = (workspace: WorkspaceRecord): string => {
    const agentsRef = toAgentsRef(workspace)
    ensureDirectory(agentsRef)
    return agentsRef
  }

  const ensureVaultRef = (workspace: WorkspaceRecord): string => {
    const vaultRef = toVaultRef(workspace)
    ensureDirectory(vaultRef)
    return vaultRef
  }

  const ensureAttachmentsRef = (workspace: WorkspaceRecord): string => {
    const attachmentsRef = toAttachmentsRef(workspace)
    ensureDirectory(attachmentsRef)
    return attachmentsRef
  }

  const ensureSessionRef = (workspace: WorkspaceRecord, sessionId: WorkSessionId): string =>
    toSessionRef(workspace, sessionId)

  const ensureRunRef = (workspace: WorkspaceRecord, runId: RunId): string =>
    toRunRef(workspace, runId)

  const buildLayout = (
    workspace: WorkspaceRecord,
    sessionId: WorkSessionId,
    runId: RunId,
  ): WorkspaceLayout => ({
    agentsRef: ensureAgentsRef(workspace),
    attachmentsRef: ensureAttachmentsRef(workspace),
    runRef: ensureRunRef(workspace, runId),
    sessionRef: ensureSessionRef(workspace, sessionId),
    vaultRef: ensureVaultRef(workspace),
    workspace,
  })

  return {
    buildLayout,
    ensureAccountWorkspace,
    ensureAccountWorkspaceResolution,
    ensureAgentsRef,
    ensureAttachmentsRef,
    ensureVaultRef,
    ensureRunRef,
    ensureSessionRef,
    requireWritableWorkspace,
    requireWritableWorkspaceResolution,
  }
}
