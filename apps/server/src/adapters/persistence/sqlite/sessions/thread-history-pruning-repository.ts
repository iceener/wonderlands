import { and, eq, inArray, or, sql } from 'drizzle-orm'

import {
  contextSummaries,
  domainEvents,
  eventOutbox,
  eventPayloadSidecars,
  fileLinks,
  files,
  items,
  jobDependencies,
  jobs,
  kernelSessionArtifacts,
  kernelSessions,
  memoryRecordSources,
  memoryRecords,
  runClaims,
  runDependencies,
  runs,
  sandboxExecutionFiles,
  sandboxExecutionPackages,
  sandboxExecutions,
  sandboxWritebackOperations,
  sessionMessages,
  sessionThreads,
  toolExecutions,
  uploads,
  usageLedger,
  workSessions,
} from '../../../../db/schema'
import type {
  PruneThreadHistoryInput,
  PruneThreadHistoryOutput,
  ThreadHistoryPruningRepository,
} from '../../../../domain/sessions/thread-history-pruning-repository'
import type { DomainError } from '../../../../shared/errors'
import { err, ok, type Result } from '../../../../shared/result'
import { createFileDeletionPlanRepository } from '../files/file-deletion-plan-repository'
import type { RepositoryDatabase } from '../repository-database'

const jsonStringAt = (
  path:
    | '$.callId'
    | '$.childRunId'
    | '$.fileId'
    | '$.messageId'
    | '$.parentRunId'
    | '$.rootRunId'
    | '$.runId'
    | '$.summaryId'
    | '$.threadId'
    | '$.uploadId'
    | '$.waitId'
    | '$.waitTargetRunId'
    | '$.jobId',
) => sql<string | null>`json_extract(${domainEvents.payload}, ${path})`

const uniqueStrings = (values: ReadonlyArray<string | null | undefined>): string[] => [
  ...new Set(
    values.filter((value): value is string => typeof value === 'string' && value.length > 0),
  ),
]

const blocksPermanentDelete = (status: typeof runs.$inferSelect.status): boolean =>
  status === 'running' || status === 'cancelling' || status === 'waiting'

const sortIdsForDelete = <TRow extends { id: string }>(
  rows: TRow[],
  getParentId: (row: TRow) => string | null | undefined,
): string[] => {
  const rowIds = new Set(rows.map((row) => row.id))
  const childrenByParent = new Map<string, string[]>()

  for (const row of rows) {
    const parentId = getParentId(row)

    if (!parentId || !rowIds.has(parentId)) {
      continue
    }

    const children = childrenByParent.get(parentId) ?? []
    children.push(row.id)
    childrenByParent.set(parentId, children)
  }

  const visited = new Set<string>()
  const ordered: string[] = []

  const visit = (id: string) => {
    if (visited.has(id)) {
      return
    }

    visited.add(id)

    for (const childId of childrenByParent.get(id) ?? []) {
      visit(childId)
    }

    ordered.push(id)
  }

  for (const row of rows) {
    const parentId = getParentId(row)

    if (!parentId || !rowIds.has(parentId)) {
      visit(row.id)
    }
  }

  for (const row of rows) {
    visit(row.id)
  }

  return ordered
}

const pruneThreadHistory = (
  db: RepositoryDatabase,
  input: PruneThreadHistoryInput,
): Result<PruneThreadHistoryOutput, DomainError> => {
  const threadIds = uniqueStrings(input.threadIds ?? [])
  const explicitMessageIds = uniqueStrings(input.messageIds ?? [])
  const rootRunIds = uniqueStrings(input.rootRunIds ?? [])
  const preserveWorkItemIds = new Set(uniqueStrings(input.preserveWorkItemIds ?? []))

  try {
    const sessionRunRows =
      rootRunIds.length > 0
        ? db
            .select()
            .from(runs)
            .where(and(eq(runs.tenantId, input.tenantId), eq(runs.sessionId, input.sessionId)))
            .all()
        : []
    const runRows =
      rootRunIds.length === 0
        ? []
        : sessionRunRows.filter((row) => rootRunIds.includes(row.rootRunId))
    const blockedRun = runRows.find((row) => blocksPermanentDelete(row.status))

    if (blockedRun) {
      return err({
        message: `history cannot be pruned while run ${blockedRun.id} is ${blockedRun.status}`,
        type: 'conflict',
      })
    }

    const runIds = uniqueStrings(runRows.map((row) => row.id))
    const runDeleteOrder = sortIdsForDelete(runRows, (row) => row.parentRunId)

    const sessionThreadRows =
      threadIds.length > 0
        ? db
            .select()
            .from(sessionThreads)
            .where(
              and(
                eq(sessionThreads.tenantId, input.tenantId),
                eq(sessionThreads.sessionId, input.sessionId),
              ),
            )
            .all()
        : []
    const threadDeleteOrder = sortIdsForDelete(
      sessionThreadRows.filter((row) => threadIds.includes(row.id)),
      (row) => row.parentThreadId,
    )

    const jobRows =
      runIds.length === 0 && threadIds.length === 0
        ? []
        : db
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.tenantId, input.tenantId),
                eq(jobs.sessionId, input.sessionId),
                or(
                  threadIds.length > 0 ? inArray(jobs.threadId, threadIds) : undefined,
                  runIds.length > 0 ? inArray(jobs.currentRunId, runIds) : undefined,
                ),
              ),
            )
            .all()
            .filter((row) => !preserveWorkItemIds.has(row.id))
    const jobIds = uniqueStrings(jobRows.map((row) => row.id))
    const jobDeleteOrder = sortIdsForDelete(jobRows, (row) => row.parentJobId)

    const messageRows =
      threadIds.length === 0 && explicitMessageIds.length === 0
        ? []
        : db
            .select()
            .from(sessionMessages)
            .where(
              and(
                eq(sessionMessages.tenantId, input.tenantId),
                or(
                  threadIds.length > 0 ? inArray(sessionMessages.threadId, threadIds) : undefined,
                  explicitMessageIds.length > 0
                    ? inArray(sessionMessages.id, explicitMessageIds)
                    : undefined,
                ),
              ),
            )
            .all()
    const messageIds = uniqueStrings(messageRows.map((row) => row.id))

    const toolExecutionRows =
      runIds.length === 0
        ? []
        : db
            .select()
            .from(toolExecutions)
            .where(
              and(
                eq(toolExecutions.tenantId, input.tenantId),
                inArray(toolExecutions.runId, runIds),
              ),
            )
            .all()
    const toolExecutionIds = uniqueStrings(toolExecutionRows.map((row) => row.id))

    const runDependencyRows =
      runIds.length === 0
        ? []
        : db
            .select()
            .from(runDependencies)
            .where(
              and(
                eq(runDependencies.tenantId, input.tenantId),
                or(
                  inArray(runDependencies.runId, runIds),
                  inArray(runDependencies.targetRunId, runIds),
                ),
              ),
            )
            .all()
    const waitIds = uniqueStrings(runDependencyRows.map((row) => row.id))

    const summaryRows =
      runIds.length === 0
        ? []
        : db
            .select()
            .from(contextSummaries)
            .where(
              and(
                eq(contextSummaries.tenantId, input.tenantId),
                inArray(contextSummaries.runId, runIds),
              ),
            )
            .all()
    const summaryIds = uniqueStrings(summaryRows.map((row) => row.id))

    const memoryRows =
      runIds.length === 0 && threadIds.length === 0
        ? []
        : db
            .select()
            .from(memoryRecords)
            .where(
              and(
                eq(memoryRecords.tenantId, input.tenantId),
                or(
                  threadIds.length > 0 ? inArray(memoryRecords.threadId, threadIds) : undefined,
                  runIds.length > 0 ? inArray(memoryRecords.ownerRunId, runIds) : undefined,
                  runIds.length > 0 ? inArray(memoryRecords.rootRunId, runIds) : undefined,
                ),
              ),
            )
            .all()
    const memoryRecordIds = uniqueStrings(memoryRows.map((row) => row.id))

    const fileDeletionPlan = createFileDeletionPlanRepository(db).selectPlan({
      messageIds,
      runIds,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      threadIds,
      toolExecutionIds,
    })

    const eventRows =
      threadIds.length === 0 &&
      messageIds.length === 0 &&
      runIds.length === 0 &&
      jobIds.length === 0 &&
      toolExecutionIds.length === 0 &&
      waitIds.length === 0 &&
      summaryIds.length === 0 &&
      fileDeletionPlan.fileIdsToDelete.length === 0 &&
      fileDeletionPlan.uploadIdsToDelete.length === 0
        ? []
        : db
            .select({
              id: domainEvents.id,
            })
            .from(domainEvents)
            .where(
              and(
                eq(domainEvents.tenantId, input.tenantId),
                or(
                  threadIds.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'session_thread'),
                        inArray(domainEvents.aggregateId, threadIds),
                      )
                    : undefined,
                  messageIds.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'session_message'),
                        inArray(domainEvents.aggregateId, messageIds),
                      )
                    : undefined,
                  runIds.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'run'),
                        inArray(domainEvents.aggregateId, runIds),
                      )
                    : undefined,
                  jobIds.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'job'),
                        inArray(domainEvents.aggregateId, jobIds),
                      )
                    : undefined,
                  toolExecutionIds.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'tool_execution'),
                        inArray(domainEvents.aggregateId, toolExecutionIds),
                      )
                    : undefined,
                  waitIds.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'wait_entry'),
                        inArray(domainEvents.aggregateId, waitIds),
                      )
                    : undefined,
                  fileDeletionPlan.fileIdsToDelete.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'file'),
                        inArray(domainEvents.aggregateId, fileDeletionPlan.fileIdsToDelete),
                      )
                    : undefined,
                  fileDeletionPlan.uploadIdsToDelete.length > 0
                    ? and(
                        eq(domainEvents.aggregateType, 'upload'),
                        inArray(domainEvents.aggregateId, fileDeletionPlan.uploadIdsToDelete),
                      )
                    : undefined,
                  threadIds.length > 0 ? inArray(jsonStringAt('$.threadId'), threadIds) : undefined,
                  messageIds.length > 0
                    ? inArray(jsonStringAt('$.messageId'), messageIds)
                    : undefined,
                  runIds.length > 0 ? inArray(jsonStringAt('$.runId'), runIds) : undefined,
                  runIds.length > 0 ? inArray(jsonStringAt('$.parentRunId'), runIds) : undefined,
                  runIds.length > 0 ? inArray(jsonStringAt('$.childRunId'), runIds) : undefined,
                  runIds.length > 0 ? inArray(jsonStringAt('$.rootRunId'), runIds) : undefined,
                  runIds.length > 0
                    ? inArray(jsonStringAt('$.waitTargetRunId'), runIds)
                    : undefined,
                  toolExecutionIds.length > 0
                    ? inArray(jsonStringAt('$.callId'), toolExecutionIds)
                    : undefined,
                  waitIds.length > 0 ? inArray(jsonStringAt('$.waitId'), waitIds) : undefined,
                  jobIds.length > 0 ? inArray(jsonStringAt('$.jobId'), jobIds) : undefined,
                  summaryIds.length > 0
                    ? inArray(jsonStringAt('$.summaryId'), summaryIds)
                    : undefined,
                  fileDeletionPlan.fileIdsToDelete.length > 0
                    ? inArray(jsonStringAt('$.fileId'), fileDeletionPlan.fileIdsToDelete)
                    : undefined,
                  fileDeletionPlan.uploadIdsToDelete.length > 0
                    ? inArray(jsonStringAt('$.uploadId'), fileDeletionPlan.uploadIdsToDelete)
                    : undefined,
                ),
              ),
            )
            .all()
    const eventIds = uniqueStrings(eventRows.map((row) => row.id))

    if (eventIds.length > 0) {
      db.delete(eventOutbox)
        .where(
          and(eq(eventOutbox.tenantId, input.tenantId), inArray(eventOutbox.eventId, eventIds)),
        )
        .run()

      db.delete(eventPayloadSidecars)
        .where(inArray(eventPayloadSidecars.eventId, eventIds))
        .run()

      db.delete(domainEvents)
        .where(and(eq(domainEvents.tenantId, input.tenantId), inArray(domainEvents.id, eventIds)))
        .run()
    }

    if (
      threadIds.length > 0 ||
      runIds.length > 0 ||
      toolExecutionIds.length > 0 ||
      summaryIds.length > 0
    ) {
      db.delete(usageLedger)
        .where(
          and(
            eq(usageLedger.tenantId, input.tenantId),
            or(
              threadIds.length > 0 ? inArray(usageLedger.threadId, threadIds) : undefined,
              runIds.length > 0 ? inArray(usageLedger.runId, runIds) : undefined,
              toolExecutionIds.length > 0
                ? inArray(usageLedger.toolExecutionId, toolExecutionIds)
                : undefined,
              summaryIds.length > 0 ? inArray(usageLedger.summaryId, summaryIds) : undefined,
            ),
          ),
        )
        .run()
    }

    if (fileDeletionPlan.fileLinkIdsToDelete.length > 0) {
      db.delete(fileLinks)
        .where(
          and(
            eq(fileLinks.tenantId, input.tenantId),
            inArray(fileLinks.id, fileDeletionPlan.fileLinkIdsToDelete),
          ),
        )
        .run()
    }

    if (memoryRecordIds.length > 0 || runIds.length > 0 || summaryIds.length > 0) {
      db.delete(memoryRecordSources)
        .where(
          and(
            eq(memoryRecordSources.tenantId, input.tenantId),
            or(
              memoryRecordIds.length > 0
                ? inArray(memoryRecordSources.recordId, memoryRecordIds)
                : undefined,
              memoryRecordIds.length > 0
                ? inArray(memoryRecordSources.sourceRecordId, memoryRecordIds)
                : undefined,
              runIds.length > 0 ? inArray(memoryRecordSources.sourceRunId, runIds) : undefined,
              summaryIds.length > 0
                ? inArray(memoryRecordSources.sourceSummaryId, summaryIds)
                : undefined,
            ),
          ),
        )
        .run()
    }

    if (memoryRecordIds.length > 0) {
      db.delete(memoryRecords)
        .where(
          and(
            eq(memoryRecords.tenantId, input.tenantId),
            inArray(memoryRecords.id, memoryRecordIds),
          ),
        )
        .run()
    }

    if (runIds.length > 0) {
      db.delete(runClaims)
        .where(and(eq(runClaims.tenantId, input.tenantId), inArray(runClaims.runId, runIds)))
        .run()
    }

    if (waitIds.length > 0) {
      db.delete(runDependencies)
        .where(
          and(eq(runDependencies.tenantId, input.tenantId), inArray(runDependencies.id, waitIds)),
        )
        .run()
    }

    if (runIds.length > 0) {
      db.delete(items)
        .where(and(eq(items.tenantId, input.tenantId), inArray(items.runId, runIds)))
        .run()
    }

    if (jobIds.length > 0) {
      db.delete(jobDependencies)
        .where(
          and(
            eq(jobDependencies.tenantId, input.tenantId),
            or(
              inArray(jobDependencies.fromJobId, jobIds),
              inArray(jobDependencies.toJobId, jobIds),
            ),
          ),
        )
        .run()
    }

    if (messageIds.length > 0) {
      db.delete(sessionMessages)
        .where(
          and(
            eq(sessionMessages.tenantId, input.tenantId),
            inArray(sessionMessages.id, messageIds),
          ),
        )
        .run()
    }

    if (summaryIds.length > 0) {
      db.delete(contextSummaries)
        .where(
          and(
            eq(contextSummaries.tenantId, input.tenantId),
            inArray(contextSummaries.id, summaryIds),
          ),
        )
        .run()
    }

    // Delete sandbox and kernel tables that FK to runs, jobs, tool_executions, and session_threads
    const sandboxExecutionRows =
      runIds.length === 0 &&
      threadIds.length === 0 &&
      jobIds.length === 0 &&
      toolExecutionIds.length === 0
        ? []
        : db
            .select({ id: sandboxExecutions.id })
            .from(sandboxExecutions)
            .where(
              and(
                eq(sandboxExecutions.tenantId, input.tenantId),
                or(
                  runIds.length > 0 ? inArray(sandboxExecutions.runId, runIds) : undefined,
                  threadIds.length > 0 ? inArray(sandboxExecutions.threadId, threadIds) : undefined,
                  jobIds.length > 0 ? inArray(sandboxExecutions.jobId, jobIds) : undefined,
                  toolExecutionIds.length > 0
                    ? inArray(sandboxExecutions.toolExecutionId, toolExecutionIds)
                    : undefined,
                ),
              ),
            )
            .all()
    const sandboxExecutionIds = uniqueStrings(sandboxExecutionRows.map((row) => row.id))

    if (sandboxExecutionIds.length > 0) {
      db.delete(sandboxWritebackOperations)
        .where(
          and(
            eq(sandboxWritebackOperations.tenantId, input.tenantId),
            inArray(sandboxWritebackOperations.sandboxExecutionId, sandboxExecutionIds),
          ),
        )
        .run()

      db.delete(sandboxExecutionFiles)
        .where(
          and(
            eq(sandboxExecutionFiles.tenantId, input.tenantId),
            inArray(sandboxExecutionFiles.sandboxExecutionId, sandboxExecutionIds),
          ),
        )
        .run()

      db.delete(sandboxExecutionPackages)
        .where(
          and(
            eq(sandboxExecutionPackages.tenantId, input.tenantId),
            inArray(sandboxExecutionPackages.sandboxExecutionId, sandboxExecutionIds),
          ),
        )
        .run()

      db.delete(sandboxExecutions)
        .where(
          and(
            eq(sandboxExecutions.tenantId, input.tenantId),
            inArray(sandboxExecutions.id, sandboxExecutionIds),
          ),
        )
        .run()
    }

    const kernelSessionRows =
      runIds.length === 0 && threadIds.length === 0 && toolExecutionIds.length === 0
        ? []
        : db
            .select({ id: kernelSessions.id })
            .from(kernelSessions)
            .where(
              and(
                eq(kernelSessions.tenantId, input.tenantId),
                or(
                  runIds.length > 0 ? inArray(kernelSessions.runId, runIds) : undefined,
                  threadIds.length > 0 ? inArray(kernelSessions.threadId, threadIds) : undefined,
                  toolExecutionIds.length > 0
                    ? inArray(kernelSessions.toolExecutionId, toolExecutionIds)
                    : undefined,
                ),
              ),
            )
            .all()
    const kernelSessionIds = uniqueStrings(kernelSessionRows.map((row) => row.id))

    if (kernelSessionIds.length > 0) {
      db.delete(kernelSessionArtifacts)
        .where(
          and(
            eq(kernelSessionArtifacts.tenantId, input.tenantId),
            inArray(kernelSessionArtifacts.kernelSessionId, kernelSessionIds),
          ),
        )
        .run()

      db.delete(kernelSessions)
        .where(
          and(
            eq(kernelSessions.tenantId, input.tenantId),
            inArray(kernelSessions.id, kernelSessionIds),
          ),
        )
        .run()
    }

    if (toolExecutionIds.length > 0) {
      db.delete(toolExecutions)
        .where(
          and(
            eq(toolExecutions.tenantId, input.tenantId),
            inArray(toolExecutions.id, toolExecutionIds),
          ),
        )
        .run()
    }

    if (fileDeletionPlan.uploadIdsToDelete.length > 0) {
      db.delete(uploads)
        .where(
          and(
            eq(uploads.tenantId, input.tenantId),
            inArray(uploads.id, fileDeletionPlan.uploadIdsToDelete),
          ),
        )
        .run()
    }

    if (fileDeletionPlan.fileIdsToDelete.length > 0) {
      db.delete(files)
        .where(
          and(
            eq(files.tenantId, input.tenantId),
            inArray(files.id, fileDeletionPlan.fileIdsToDelete),
          ),
        )
        .run()
    }

    const sessionRow = db
      .select({ rootRunId: workSessions.rootRunId })
      .from(workSessions)
      .where(and(eq(workSessions.id, input.sessionId), eq(workSessions.tenantId, input.tenantId)))
      .get()

    if (runIds.length > 0 && sessionRow?.rootRunId && runIds.includes(sessionRow.rootRunId)) {
      db.update(workSessions)
        .set({
          rootRunId: null,
        })
        .where(and(eq(workSessions.id, input.sessionId), eq(workSessions.tenantId, input.tenantId)))
        .run()
    }

    for (const runId of runDeleteOrder) {
      db.delete(runs)
        .where(and(eq(runs.tenantId, input.tenantId), eq(runs.id, runId)))
        .run()
    }

    for (const jobId of jobDeleteOrder) {
      db.delete(jobs)
        .where(and(eq(jobs.tenantId, input.tenantId), eq(jobs.id, jobId)))
        .run()
    }

    for (const threadId of threadDeleteOrder) {
      db.delete(sessionThreads)
        .where(and(eq(sessionThreads.tenantId, input.tenantId), eq(sessionThreads.id, threadId)))
        .run()
    }

    return ok({
      blobStorageKeys: fileDeletionPlan.blobStorageKeys,
      deletedMessageIds: messageIds,
      deletedRunIds: runIds,
      deletedWorkItemIds: jobIds,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown thread history prune failure'

    return err({
      message: `failed to prune thread history: ${message}`,
      type: 'conflict',
    })
  }
}

export const createThreadHistoryPruningRepository = (
  db: RepositoryDatabase,
): ThreadHistoryPruningRepository => ({
  prune: (input: PruneThreadHistoryInput): Result<PruneThreadHistoryOutput, DomainError> =>
    pruneThreadHistory(db, input),
})
