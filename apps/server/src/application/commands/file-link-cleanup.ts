import type { AppTransaction } from '../../db/transaction'
import type { FileDeletionPlan } from '../../domain/files/file-deletion-plan-repository'
import type { FileLinkRecord } from '../../domain/files/file-link-repository'
import { createFileDeletionPlanRepository } from '../persistence/repositories'

export type { FileDeletionPlan } from '../../domain/files/file-deletion-plan-repository'

export const buildFileDeletionPlanFromDirectLinks = (
  tx: AppTransaction,
  input: {
    directLinkRows: FileLinkRecord[]
    sessionId: string
    tenantId: string
  },
): FileDeletionPlan => createFileDeletionPlanRepository(tx).buildFromDirectLinks(input)

export const selectFileDeletionPlan = (
  tx: AppTransaction,
  input: {
    messageIds: string[]
    runIds: string[]
    sessionId: string
    tenantId: string
    threadIds: string[]
    toolExecutionIds: string[]
  },
): FileDeletionPlan => createFileDeletionPlanRepository(tx).selectPlan(input)
